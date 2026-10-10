// Sends "Game started. Watch along." to the phones of everyone on a team, when a gaffer kicks off.
// Called by the gaffer's app with { code, opp }. Needs these secrets (Edge Functions > Secrets):
//   APNS_KEY_P8   the contents of an Apple Push Notifications key (.p8)
//   APNS_KEY_ID   that key's ID
//   APPLE_TEAM_ID the Apple developer team ID
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const BUNDLE = "com.randomedp.aipoweredtactics";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function apnsJwt(p8: string, keyId: string, teamId: string) {
  const der = Uint8Array.from(atob(p8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId })) + "." + b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return head + "." + b64url(sig);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { code, opp } = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first" }, 401);

    const { data: team } = await db.from("teams").select("id,code,name,short").eq("code", String(code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team" }, 404);
    const { data: gaffers } = await db.from("team_members").select("user_id").eq("team_id", team.id);
    if (!(gaffers || []).some((g) => g.user_id === who.user.id)) return json({ error: "Only a gaffer can announce a game" }, 403);

    const p8 = Deno.env.get("APNS_KEY_P8"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APPLE_TEAM_ID");
    if (!p8 || !keyId || !teamId) return json({ sent: 0, reason: "not_configured" });

    const { data: players } = await db.from("players").select("user_id").eq("team_id", team.id).not("user_id", "is", null);
    const users = [...new Set([...(players || []), ...(gaffers || [])].map((r) => r.user_id))].filter((u) => u && u !== who.user.id);
    if (!users.length) return json({ sent: 0 });
    const { data: phones } = await db.from("push_tokens").select("token").in("user_id", users);
    if (!phones?.length) return json({ sent: 0 });

    const jwt = await apnsJwt(p8, keyId, teamId);
    const name = team.short || team.name, title = String(opp || "").trim() ? `${name} v ${String(opp).trim().slice(0, 60)}` : name;
    const body = JSON.stringify({ aps: { alert: { title, body: "Game started. Watch along." }, sound: "default" }, code: team.code });
    let sent = 0; const dead: string[] = [];
    await Promise.all(phones.map(async (p) => {
      const res = await fetch(`https://api.push.apple.com/3/device/${p.token}`, { method: "POST", body,
        headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600) } });
      if (res.ok) sent++; else if (res.status === 410 || res.status === 400) { const r = await res.json().catch(() => ({})); if (res.status === 410 || r.reason === "BadDeviceToken") dead.push(p.token); }
    }));
    if (dead.length) await db.from("push_tokens").delete().in("token", dead);
    return json({ sent });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
