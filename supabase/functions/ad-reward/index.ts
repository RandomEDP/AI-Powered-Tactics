// Rewarded ads: Google's AdMob calls this when someone has watched an ad all the way through (server-side verification).
// It's how an unlock is granted without taking the phone's word for it: the call is signed with Google's key, checked
// here against the keys Google publishes, and only then is the ticket the ad was loaded with granted (public.ad_grant,
// which only the server can call). See supabase/migrations/0032_rewarded_ads.sql.
//
// Google calls it with a GET and no Supabase sign-in, so it's deployed with verify_jwt = false:
//   supabase functions deploy ad-reward --no-verify-jwt --project-ref kvefpqigpqprxfelesrb
// Its address goes in AdMob: Apps > Gaffer > Ad units > the rewarded unit > Server-side verification > Callback URL:
//   https://kvefpqigpqprxfelesrb.supabase.co/functions/v1/ad-reward
// Optional secret ADMOB_AD_UNITS: the rewarded ad unit ids (comma-separated) it accepts; anything else is turned away.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

export const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
let keys: { at: number; byId: Record<string, CryptoKey> } | null = null;

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/// Google's public keys, kept for a day (fetched again at once for a key id we haven't seen, as Google rotates them).
async function keyFor(id: string): Promise<CryptoKey | null> {
  if (!keys || Date.now() - keys.at > 86400000 || !keys.byId[id]) {
    const res = await fetch(KEYS_URL);
    if (!res.ok) throw new Error("Couldn't fetch Google's keys: " + res.status);
    const list: { keyId: number | string; base64: string }[] = (await res.json()).keys || [];
    const byId: Record<string, CryptoKey> = {};
    for (const k of list) byId[String(k.keyId)] = await crypto.subtle.importKey("spki", b64(k.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    keys = { at: Date.now(), byId };
  }
  return keys.byId[id] || null;
}

/// Google signs with ECDSA in DER; WebCrypto checks the plain 64-byte form (r and s, 32 bytes each).
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("not DER");
  let i = 2; if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);
  const out = new Uint8Array(64);
  for (let n = 0; n < 2; n++) {
    if (der[i] !== 0x02) throw new Error("not DER");
    const len = der[i + 1]; let v = der.slice(i + 2, i + 2 + len); i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("not DER");
    out.set(v, n * 32 + (32 - v.length));
  }
  return out;
}

/// True when `url` (the whole address Google called) carries Google's good signature. What's signed is the query up to
/// "&signature=" (signature and key_id are always last).
export async function verify(url: string): Promise<boolean> {
  const query = url.split("?").slice(1).join("?"), cut = query.indexOf("&signature=");
  if (cut < 0) return false;
  const p = new URLSearchParams(query), sig = p.get("signature") || "", id = p.get("key_id") || "";
  if (!sig || !id) return false;
  const key = await keyFor(id);
  if (!key) return false;
  try {
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64(sig)), new TextEncoder().encode(query.slice(0, cut)));
  } catch (_) { return false; }
}

Deno.serve(async (req: Request) => {
  try {
    const url = new URL(req.url), p = url.searchParams;
    // AdMob's "Verify URL" button calls with no ad behind it; it only needs a 200
    if (!p.get("signature")) return new Response("ok", { status: 200 });
    if (!(await verify(req.url))) return new Response("bad signature", { status: 403 });
    const units = (Deno.env.get("ADMOB_AD_UNITS") || "").split(",").map((s) => s.trim()).filter(Boolean);
    const unit = p.get("ad_unit") || "";
    if (units.length && !units.some((u) => u === unit || u.endsWith("/" + unit))) return new Response("not our ad unit", { status: 403 });
    const ticket = p.get("custom_data") || "", user = p.get("user_id") || "", tx = p.get("transaction_id") || null;
    if (!ticket) return new Response("ok", { status: 200 }); // (a real ad, but not one the app asked for: nothing to grant)
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await db.rpc("ad_grant", { p_ticket: ticket, p_user: user, p_tx: tx });
    if (error) throw new Error(error.message);
    // Google retries anything but a 200, so only a fault on our side gets anything else
    return new Response(JSON.stringify({ result: data }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ad-reward", e);
    return new Response("error", { status: 500 });
  }
});
