// The shop (0033_shop.sql): the cage phone mount and team kits, paid for through Stripe Checkout (Apple Pay or card).
// Physical goods can't go through Apple's in-app purchase (App Store guideline 3.1.3(e)), so this never touches StoreKit.
// The prices are worked out here from the catalogue below, never taken from the phone.
// Called by anyone signed in:
//   { action: "checkout", code?, item: "mount", qty }                       -> { url, order }  (Stripe's payment page)
//   { action: "checkout", code?, item: "kit", design: {...}, shirts: [...] } -> { url, order }
//   { action: "orders" }  -> { orders: [...] }  this account's orders, newest first; any still waiting are checked with Stripe
// Errors come back as { error, reason } in plain words, reason one of: not_configured, live_off, bad_order, stripe.
// Secrets (Edge Functions > Secrets): STRIPE_SECRET_KEY (sk_test_… while testing). A live key (sk_live_…) is refused
// unless SHOP_LIVE is "yes", so nobody is charged until Ethan switches it on. SHOP_RETURN_URL is optional: where Stripe
// sends people after paying (else the shop-webhook function's short "go back to Gaffer" page).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Prices in pence. Keep in step with SHOP in index.html (tests/shop.test.mjs checks).
export const CATALOGUE = {
  mount: { name: "Gaffer cage phone mount", price: 1299, max: 10 },
  kit: { name: "Gaffer team kit shirt", price: 1499, sponsored: 999, min: 8, max: 30 },
  postage: 399,
};
export const SIZES = ["YS", "YM", "YL", "S", "M", "L", "XL", "XXL"];
export const PATTERNS = ["plain", "stripes", "hoops", "halves", "sash"];

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const no = (status: number, reason: string, error: string) => json({ error, reason }, status);
const hex = (s: unknown) => /^#[0-9a-f]{6}$/i.test(String(s || ""));

/// The order as it will be made and charged, or a plain-English reason it can't be.
export function priceOrder(input: Record<string, any>): { error: string } | { item: string; lines: { name: string; each: number; qty: number }[]; design: Record<string, unknown> | null; shirts: unknown[] | null; total: number; postage: number } {
  if (input.item === "mount") {
    const qty = Math.floor(Number(input.qty));
    if (!(qty >= 1 && qty <= CATALOGUE.mount.max)) return { error: `Pick between 1 and ${CATALOGUE.mount.max} mounts.` };
    const total = qty * CATALOGUE.mount.price + CATALOGUE.postage;
    return { item: "mount", lines: [{ name: CATALOGUE.mount.name, each: CATALOGUE.mount.price, qty }], design: null, shirts: null, total, postage: CATALOGUE.postage };
  }
  if (input.item === "kit") {
    const d = input.design || {}, k = CATALOGUE.kit;
    if (!hex(d.color) || !hex(d.color2)) return { error: "Pick the kit's colours." };
    if (!PATTERNS.includes(d.pattern)) return { error: "Pick a pattern for the kit." };
    const badge = d.badge == null ? null : String(d.badge);
    if (badge && (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(badge) || badge.length > 200000)) return { error: "That badge picture can't be used. Try a smaller PNG or JPEG." };
    const shirts = Array.isArray(input.shirts) ? input.shirts : [];
    if (shirts.length < k.min) return { error: `A kit order is at least ${k.min} shirts, so the printer will make it.` };
    if (shirts.length > k.max) return { error: `A kit order is at most ${k.max} shirts.` };
    const clean = [];
    for (const s of shirts) {
      const name = String(s?.name ?? "").trim().toUpperCase(), num = s?.num == null || s.num === "" ? null : Number(s.num);
      if (!/^[\p{L}' .-]{0,12}$/u.test(name)) return { error: `"${name.slice(0, 20)}" can't go on a shirt: up to 12 letters, spaces, dots, dashes or apostrophes.` };
      if (num != null && !(Number.isInteger(num) && num >= 0 && num <= 99)) return { error: "Shirt numbers go from 0 to 99." };
      if (!SIZES.includes(s?.size)) return { error: "Pick a size for every shirt." };
      clean.push({ name, num, size: s.size });
    }
    const each = d.sponsor ? k.sponsored : k.price;
    return {
      item: "kit", lines: [{ name: k.name + (d.sponsor ? " (Gaffer sponsor)" : ""), each, qty: clean.length }],
      design: { color: d.color.toLowerCase(), color2: d.color2.toLowerCase(), pattern: d.pattern, sponsor: !!d.sponsor, badge },
      shirts: clean, total: each * clean.length + CATALOGUE.postage, postage: CATALOGUE.postage,
    };
  }
  return { error: "That isn't something the shop sells." };
}

/// A call to Stripe's API (form-encoded, as Stripe wants it).
async function stripe(key: string, method: string, path: string, form?: Record<string, string | number>) {
  const res = await fetch("https://api.stripe.com/v1/" + path, {
    method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(Object.entries(form).map(([k, v]) => [k, String(v)])).toString() : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Stripe said ${res.status}`);
  return body;
}

/// What Stripe's finished payment page tells us, as the order row wants it.
export function paidFrom(session: Record<string, any>) {
  const ship = session.collected_information?.shipping_details || session.shipping_details || null;
  return {
    status: "paid", paid_at: new Date().toISOString(), live: !!session.livemode,
    email: session.customer_details?.email || null,
    ship: ship ? { name: ship.name || null, address: ship.address || null, phone: session.customer_details?.phone || null } : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    const key = Deno.env.get("STRIPE_SECRET_KEY") || "";

    if (input.action === "orders") {
      const { data: rows } = await db.from("shop_orders").select("id, item, lines, design, shirts, total_pence, status, stripe_session, live, created_at, paid_at").eq("user_id", who.user.id);
      const list = (rows || []).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 30);
      for (const o of list) { // (one the webhook hasn't reached yet: ask Stripe, so coming back from paying shows it paid)
        if (o.status !== "awaiting_payment" || !o.stripe_session || !key) continue;
        try {
          const s = await stripe(key, "GET", "checkout/sessions/" + encodeURIComponent(o.stripe_session));
          if (s.payment_status === "paid") { const p = paidFrom(s); await db.from("shop_orders").update(p).eq("id", o.id); Object.assign(o, p); }
          else if (s.status === "expired") { await db.from("shop_orders").update({ status: "cancelled" }).eq("id", o.id); o.status = "cancelled"; }
        } catch (_) { /* (left as it is; checked again next time) */ }
      }
      return json({ orders: list.map((o: any) => ({ id: o.id, item: o.item, lines: o.lines, total: o.total_pence, status: o.status, live: !!o.live, at: o.created_at, paid_at: o.paid_at || null,
        sponsor: !!o.design?.sponsor, shirts: Array.isArray(o.shirts) ? o.shirts.length : 0 })) });
    }
    if (input.action !== "checkout") return json({ error: "Nothing to do." }, 400);

    const order = priceOrder(input);
    if ("error" in order) return no(400, "bad_order", order.error);
    if (!key) return no(503, "not_configured", "Paying in the shop isn't set up on Gaffer's server yet. Nothing has been charged.");
    if (key.startsWith("sk_live_") && Deno.env.get("SHOP_LIVE") !== "yes") return no(503, "live_off", "The shop isn't taking real payments yet. Nothing has been charged.");

    let team: string | null = null;
    if (input.code) { const { data: t } = await db.from("teams").select("id").eq("code", String(input.code).toUpperCase().trim()).maybeSingle(); team = t?.id || null; }
    const { data: row, error } = await db.from("shop_orders").insert({
      user_id: who.user.id, team_id: team, item: order.item, lines: order.lines, design: order.design, shirts: order.shirts,
      total_pence: order.total, postage_pence: order.postage, status: "awaiting_payment",
    }).select("id").single();
    if (error || !row) return json({ error: "Couldn't save the order. Try again in a moment." }, 500);

    const back = (Deno.env.get("SHOP_RETURN_URL") || (Deno.env.get("SUPABASE_URL") + "/functions/v1/shop-webhook")).replace(/\/+$/, "");
    const form: Record<string, string | number> = {
      mode: "payment", client_reference_id: row.id, "metadata[order]": row.id, "payment_intent_data[metadata][order]": row.id,
      success_url: back + "?done=1", cancel_url: back + "?done=0",
      "shipping_address_collection[allowed_countries][0]": "GB", "phone_number_collection[enabled]": "true",
      "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
      "shipping_options[0][shipping_rate_data][display_name]": "Royal Mail tracked",
      "shipping_options[0][shipping_rate_data][fixed_amount][amount]": order.postage,
      "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "gbp",
    };
    if (who.user.email) form.customer_email = who.user.email;
    order.lines.forEach((l, i) => {
      form[`line_items[${i}][quantity]`] = l.qty;
      form[`line_items[${i}][price_data][currency]`] = "gbp";
      form[`line_items[${i}][price_data][unit_amount]`] = l.each;
      form[`line_items[${i}][price_data][product_data][name]`] = l.name;
    });
    let s;
    try { s = await stripe(key, "POST", "checkout/sessions", form); }
    catch (e) {
      await db.from("shop_orders").update({ status: "cancelled" }).eq("id", row.id);
      return no(502, "stripe", "Stripe couldn't start the payment: " + String((e as Error)?.message || e));
    }
    await db.from("shop_orders").update({ stripe_session: s.id, live: !!s.livemode }).eq("id", row.id);
    return json({ url: s.url, order: row.id });
  } catch (e) {
    return json({ error: "Something went wrong in the shop. Try again in a moment.", detail: String((e as Error)?.message || e) }, 500);
  }
});
