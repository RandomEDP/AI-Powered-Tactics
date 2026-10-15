// The team pass (0032_team_pass.sql): someone on a team has chipped into the team's pot in the iPhone app (69p, £1.49,
// £2.49, or the whole £4.99 month), through Apple; each full £4.99 in the pot gives the team 30 days. Before it counts, this asks Apple itself about the purchase (App Store Server API, "Get Transaction
// Info"), so a made-up or refunded purchase never pays for anything, and each purchase counts once, for one team.
// Called by anyone signed in, with { code, action: "claim", transaction_id }:
//   -> { added, until, pot, months, kind, pence }   until: when the team's pass runs out (ms, null before the pot first
//      fills); pot: pence towards the next month; months: how many months this purchase started; added false if it was
//      counted already
// Errors come back as { error, reason } in plain words, reason one of: not_configured, unknown, not_yours, refunded,
// wrong_app, wrong_product, xcode.
// Secrets (Edge Functions > Secrets), from App Store Connect, Users and Access, Integrations, In-App Purchase:
//   IAP_KEY_ID, IAP_ISSUER_ID, IAP_KEY_P8 (the whole .p8 file's text)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUNDLE = "com.randomedp.aipoweredtactics";
// What each product puts in the team's pot, in pence of the UK price (the same whichever country it was bought in).
export const GOAL = 499;
export const PRODUCTS: Record<string, { kind: string; pence: number }> = {
  [BUNDLE + ".team.month"]: { kind: "month", pence: 499 },
  [BUNDLE + ".team.chip069"]: { kind: "chip069", pence: 69 },
  [BUNDLE + ".team.chip149"]: { kind: "chip149", pence: 149 },
  [BUNDLE + ".team.chip249"]: { kind: "chip249", pence: 249 },
};
const APPLE = ["https://api.storekit.itunes.apple.com", "https://api.storekit-sandbox.itunes.apple.com"]; // live first, then TestFlight's

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const no = (status: number, reason: string, error: string) => json({ error, reason }, status);
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)));

/// The App Store Server API's token: ES256, signed with the In-App Purchase key, good for ten minutes.
export async function appleJwt(p8: string, keyId: string, issuer: string, now = Math.floor(Date.now() / 1000)) {
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1", bid: BUNDLE }));
  return head + "." + b64url(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head)));
}

/// Apple's own record of a purchase, or null if Apple has never heard of it. It comes straight from Apple over HTTPS,
/// so its signed payload is read as it is.
async function fromApple(jwt: string, tx: string): Promise<Record<string, any> | null> {
  for (const base of APPLE) {
    const res = await fetch(`${base}/inApps/v1/transactions/${encodeURIComponent(tx)}`, { headers: { Authorization: "Bearer " + jwt } });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`Apple said ${res.status}`);
    const signed = String((await res.json()).signedTransactionInfo || "");
    return JSON.parse(unb64url(signed.split(".")[1] || ""));
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    if (input.action !== "claim") return json({ error: "Nothing to do." }, 400);
    const { data: team } = await db.from("teams").select("id").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team." }, 404);
    const tx = String(input.transaction_id || "");
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(tx)) return no(400, "unknown", "That purchase couldn't be found.");
    if (input.environment === "Xcode") return no(400, "xcode", "That was a test purchase made in Xcode, which Apple can't check. Try it in a TestFlight build.");

    const keyId = Deno.env.get("IAP_KEY_ID"), issuer = Deno.env.get("IAP_ISSUER_ID"), p8 = Deno.env.get("IAP_KEY_P8");
    if (!keyId || !issuer || !p8) return no(503, "not_configured", "Paying isn't set up on Gaffer's server yet. Nothing has been lost: it will count once it is.");
    const t = await fromApple(await appleJwt(p8, keyId, issuer), tx);
    if (!t) return no(404, "unknown", "Apple doesn't know that purchase.");
    if (t.bundleId !== BUNDLE) return no(400, "wrong_app", "That purchase wasn't made in Gaffer.");
    const product = PRODUCTS[t.productId];
    if (!product) return no(400, "wrong_product", "That purchase isn't a team pass.");
    // The app puts the buyer's account id on every purchase, so nobody can claim a purchase someone else made.
    if (String(t.appAccountToken || "").toLowerCase() !== who.user.id.toLowerCase()) return no(403, "not_yours", "That purchase was made by another account.");
    if (t.revocationDate) return no(400, "refunded", "Apple refunded that purchase, so it doesn't count.");

    const { data, error } = await db.rpc("pass_credit", { p_team: team.id, p_user: who.user.id, p_tx: String(t.transactionId || tx), p_product: product.kind, p_pence: product.pence, p_env: t.environment === "Sandbox" ? "Sandbox" : "Production" });
    if (error) return json({ error: /another team/.test(error.message) ? "That purchase already paid for another team." : "Couldn't save it. Try again in a moment." }, /another team/.test(error.message) ? 409 : 500);
    return json(Object.assign({ kind: product.kind, pence: product.pence }, data));
  } catch (e) {
    return json({ error: "Couldn't reach Apple to check the purchase. Try again in a moment.", detail: String((e as Error)?.message || e) }, 502);
  }
});
