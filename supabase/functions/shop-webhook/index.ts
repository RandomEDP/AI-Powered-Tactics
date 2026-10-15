// Stripe tells the shop an order has been paid (0033_shop.sql). Deployed with verify_jwt = false, because Stripe can't
// sign in: instead every POST must carry Stripe's signature, made with STRIPE_WEBHOOK_SECRET (whsec_…), or it's ignored.
// In Stripe: Developers, Webhooks, add an endpoint at <project>/functions/v1/shop-webhook for the events
// checkout.session.completed, checkout.session.async_payment_succeeded and checkout.session.expired.
// Once an order is paid it is emailed out, exactly once (emailed_at), through Resend: a kit to the supplier (the shirts,
// names, numbers, sizes, colours, the mock-up and the badge, and the customer's address to post it to), copied to Ethan;
// a phone mount to Ethan to print and post. If sending fails the webhook answers 500, so Stripe tries again later.
// Secrets for the emails: RESEND_API_KEY, SHOP_FROM (a sender on a domain verified in Resend), SUPPLIER_EMAIL, ORDERS_EMAIL.
// Without them orders are still marked paid; they just aren't emailed (Ethan sees them in shop_orders).
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
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const PATTERN: Record<string, string> = { plain: "Plain", stripes: "Vertical stripes", hoops: "Hoops (horizontal stripes)", halves: "Halves (left and right)", sash: "Diagonal sash" };
export const ref = (id: string) => "GAF-" + String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
const pounds = (p: number) => "£" + (p / 100).toFixed(2);
const b64 = (s: string) => btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join(""));

/// The kit as a picture for the supplier: the same drawing as the app's preview (kitSvg in index.html).
export function kitSvg(d: Record<string, any>, back: boolean, row?: { name?: string; num?: number | null }) {
  const n = parseInt(String(d.color).slice(1), 16), ink = 0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255) > 160 ? "#111111" : "#ffffff";
  const plain = d.pattern === "plain" || d.color2 === d.color, edge = ink === "#ffffff" ? (plain ? "rgba(0,0,0,.45)" : "rgba(0,0,0,.85)") : (plain ? "rgba(255,255,255,.6)" : "rgba(255,255,255,.9)");
  const body = "M62 12 L82 6 Q100 20 118 6 L138 12 L188 42 L170 80 L150 68 L150 212 L50 212 L50 68 L30 80 L12 42 Z", c2 = esc(d.color2);
  let pat = "";
  if (d.pattern === "stripes") for (let x = 58; x < 150; x += 24) pat += `<rect x="${x}" y="0" width="12" height="220" fill="${c2}"/>`;
  else if (d.pattern === "hoops") for (let y = 40; y < 220; y += 30) pat += `<rect x="0" y="${y}" width="200" height="15" fill="${c2}"/>`;
  else if (d.pattern === "halves") pat = `<rect x="${back ? 0 : 100}" y="0" width="100" height="220" fill="${c2}"/>`;
  else if (d.pattern === "sash") pat = `<polygon points="${back ? "40,0 80,0 200,190 200,230 160,230" : "160,0 120,0 0,190 0,230 40,230"}" fill="${c2}"/>`;
  const t = (s: string, y: number, size: number, more = "") => `<text x="100" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="800" fill="${ink}" stroke="${edge}" stroke-width="${plain ? 1.2 : 3}" stroke-linejoin="round" paint-order="stroke"${more}>${esc(s)}</text>`;
  let on = "";
  if (!back) { if (d.badge) on += `<image href="${esc(d.badge)}" x="114" y="40" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>`; if (d.sponsor) on += t("GAFFER", 116, 22, ' letter-spacing="2"'); }
  else if (row) { if (row.name) on += t(row.name, 60, 15, row.name.length > 8 ? ' textLength="88" lengthAdjust="spacingAndGlyphs"' : ""); if (row.num != null) on += t(String(row.num), 150, 70); }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220" width="600" height="660"><defs><clipPath id="c"><path d="${body}"/></clipPath></defs>` +
    `<g clip-path="url(#c)"><rect width="200" height="220" fill="${esc(d.color)}"/>${pat}<polygon points="12,42 22,36 40,74 30,80" fill="${c2}"/><polygon points="188,42 178,36 160,74 170,80" fill="${c2}"/></g>` +
    `<path d="${body}" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/><path d="M82 6 Q100 ${back ? 12 : 22} 118 6" fill="none" stroke="${c2}" stroke-width="5"/>${on}</svg>`;
}

/// The emails for a paid order: [{ to, subject, html, text, attachments }]. Plain words a supplier can work from.
export function orderEmails(o: Record<string, any>, env: { supplier?: string; orders?: string }) {
  const r = ref(o.id), a = o.ship?.address || {}, who = o.ship?.name || "";
  const addr = [who, a.line1, a.line2, a.city, a.state, a.postal_code, a.country === "GB" ? "United Kingdom" : a.country].filter(Boolean);
  const addrText = addr.join("\n") + (o.ship?.phone ? "\nPhone: " + o.ship.phone : "");
  const addrHtml = addr.map(esc).join("<br>") + (o.ship?.phone ? "<br>Phone: " + esc(o.ship.phone) : "");
  const paid = `Paid: ${pounds(o.total_pence)} (including ${pounds(o.postage_pence || 0)} postage)${o.live ? "" : " — TEST ORDER, nobody was charged"}.`;
  const out: { to: string[]; subject: string; html: string; text: string; attachments?: { filename: string; content: string }[] }[] = [];
  if (o.item === "kit") {
    const d = o.design || {}, shirts: { name: string; num: number | null; size: string }[] = o.shirts || [];
    const sizes = Object.entries(shirts.reduce((m: Record<string, number>, s) => (m[s.size] = (m[s.size] || 0) + 1, m), {})).map(([k, v]) => `${v} × ${k}`).join(", ");
    const spec = [
      `Main colour: ${d.color}`, `Second colour (pattern, collar and cuffs): ${d.color2}`, `Pattern: ${PATTERN[d.pattern] || d.pattern}`,
      `Chest: ${d.sponsor ? 'the word "GAFFER" in capitals across the chest, as in the mock-up' : "plain, nothing on the chest"}`,
      `Badge: ${d.badge ? "the attached picture (badge), on the left chest" : "none"}`,
      `Names and numbers on the back, in capitals, in a colour that stands out from the shirt (as in the mock-up)`,
    ];
    const rows = shirts.map((s, i) => `${i + 1}. ${s.name || "(no name)"}  ${s.num ?? "(no number)"}  size ${s.size}`);
    const files = [{ filename: `${r}-front.svg`, content: b64(kitSvg(d, false)) }, { filename: `${r}-back.svg`, content: b64(kitSvg(d, true, shirts[0])) }];
    if (d.badge) { const m = String(d.badge).match(/^data:image\/(png|jpeg);base64,(.+)$/); if (m) files.push({ filename: `${r}-badge.${m[1] === "jpeg" ? "jpg" : "png"}`, content: m[2] }); }
    const subject = `Kit order ${r}: ${shirts.length} shirts`;
    const text = [`Hello,`, ``, `Please make and post this kit order (${r}). The mock-up${d.badge ? " and the badge are" : " is"} attached.`, ``, ...spec, ``, `Shirts (${shirts.length}: ${sizes}):`, ...rows, ``, `Please post them to:`, addrText, ``, `Reply to this email with the tracking number once they're posted. Thank you!`, ``, `Gaffer`].join("\n");
    const html = `<p>Hello,</p><p>Please make and post this kit order (<b>${r}</b>). The mock-up${d.badge ? " and the badge are" : " is"} attached.</p><ul>${spec.map((x) => "<li>" + esc(x) + "</li>").join("")}</ul>` +
      `<p><b>Shirts (${shirts.length}: ${esc(sizes)})</b></p><table cellpadding="4" style="border-collapse:collapse"><tr><th align="left">#</th><th align="left">Name</th><th align="left">Number</th><th align="left">Size</th></tr>` +
      shirts.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name || "(no name)")}</td><td>${esc(s.num ?? "(no number)")}</td><td>${esc(s.size)}</td></tr>`).join("") + `</table>` +
      `<p><b>Please post them to:</b><br>${addrHtml}</p><p>Reply to this email with the tracking number once they're posted. Thank you!</p><p>Gaffer</p>`;
    if (env.supplier) out.push({ to: [env.supplier], subject, html, text, attachments: files });
    if (env.orders) out.push({ to: [env.orders], subject: (env.supplier ? "Sent to the supplier: " : "No supplier set, make it yourself: ") + subject, html: `<p>${esc(paid)}${o.email ? " Customer's email: " + esc(o.email) + "." : ""}</p><hr>` + html, text: paid + (o.email ? " Customer's email: " + o.email + "." : "") + "\n\n" + text, attachments: files });
  } else {
    const qty = o.lines?.[0]?.qty || 1, subject = `Mount order ${r}: ${qty} to print`;
    const text = [`Print ${qty} cage phone mount${qty === 1 ? "" : "s"}, add the rope and carabiner${qty === 1 ? "" : "s"}, and post to:`, addrText, ``, paid, o.email ? "Customer's email: " + o.email : ""].join("\n");
    if (env.orders) out.push({ to: [env.orders], subject, text, html: `<p>Print <b>${qty}</b> cage phone mount${qty === 1 ? "" : "s"}, add the rope and carabiner${qty === 1 ? "" : "s"}, and post to:</p><p>${addrHtml}</p><p>${esc(paid)}${o.email ? "<br>Customer's email: " + esc(o.email) : ""}</p>` });
  }
  return out;
}

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
    // Email it out, once: whoever sets emailed_at first sends; if sending fails it's cleared so Stripe's retry sends it.
    const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("SHOP_FROM"), env = { supplier: Deno.env.get("SUPPLIER_EMAIL"), orders: Deno.env.get("ORDERS_EMAIL") };
    if (key && from && (env.supplier || env.orders)) {
      const { data: got } = await db.from("shop_orders").update({ emailed_at: new Date().toISOString() }).eq("id", id).eq("status", "paid").is("emailed_at", null).select("*");
      const o = got && got[0];
      if (o) {
        try {
          for (const m of orderEmails(o, env)) {
            const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
              body: JSON.stringify(Object.assign({ from, reply_to: env.orders || undefined }, m)) });
            if (!res.ok) throw new Error(`Resend said ${res.status}: ${await res.text()}`);
          }
        } catch (e) {
          await db.from("shop_orders").update({ emailed_at: null }).eq("id", id);
          return text("Couldn't email the order: " + String((e as Error)?.message || e), 500);
        }
      }
    }
  } else if (ev.type === "checkout.session.expired") {
    await db.from("shop_orders").update({ status: "cancelled" }).eq("id", id).eq("status", "awaiting_payment");
  }
  return text("ok");
});
