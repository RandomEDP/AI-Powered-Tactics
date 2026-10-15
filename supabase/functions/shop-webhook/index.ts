// Stripe tells the shop an order has been paid (0033_shop.sql). Deployed with verify_jwt = false, because Stripe can't
// sign in: instead every POST must carry Stripe's signature, made with STRIPE_WEBHOOK_SECRET (whsec_…), or it's ignored.
// In Stripe: Developers, Webhooks, add an endpoint at <project>/functions/v1/shop-webhook for the events
// checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.expired.
// A GET is where Stripe's payment page sends people afterwards (?done=1 paid, ?done=0 went back): a line of plain text
// saying to go back to Gaffer. (Supabase serves function pages as plain text, so it's words, not a web page.)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const TOLERANCE = 300; // seconds: an older signed message is turned away, so a copied one can't be replayed later

/// Whether Stripe really sent this body: the Stripe-Signature header is "t=<time>,v1=<hex HMAC-SHA256 of 't.body'>".
export async function signedByStripe(body: string, header: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number((parts.find((p) => p[0] === "t") || [])[1]), sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!secret || !t || !sigs.length || Math.abs(now - t) > TOLERANCE) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + body)));
  const want = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === want.length && [...s].reduce((d, c, i) => d | (c.charCodeAt(0) ^ want.charCodeAt(i)), 0) === 0);
}

const text = (s: string, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    const done = new URL(req.url).searchParams.get("done") === "1";
    return text(done ? "Thanks, your Gaffer order is paid. Go back to Gaffer to see it under Shop, Your orders." : "No payment was taken. Go back to Gaffer to change the order or try again.");
  }
  const body = await req.text();
  if (!(await signedByStripe(body, req.headers.get("Stripe-Signature") || "", Deno.env.get("STRIPE_WEBHOOK_SECRET") || ""))) return text("Not from Stripe.", 400);
  const ev = JSON.parse(body), s = ev?.data?.object || {}, id = s.metadata?.order || s.client_reference_id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return text("ok"); // (not one of the shop's)
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if ((ev.type === "checkout.session.completed" && s.payment_status === "paid") || ev.type === "checkout.session.async_payment_succeeded") {
    const ship = s.collected_information?.shipping_details || s.shipping_details || null;
    await db.from("shop_orders").update({
      status: "paid", paid_at: new Date().toISOString(), live: !!s.livemode, email: s.customer_details?.email || null,
      ship: ship ? { name: ship.name || null, address: ship.address || null, phone: s.customer_details?.phone || null } : null,
    }).eq("id", id).eq("status", "awaiting_payment");
  } else if (ev.type === "checkout.session.expired") {
    await db.from("shop_orders").update({ status: "cancelled" }).eq("id", id).eq("status", "awaiting_payment");
  }
  return text("ok");
});
