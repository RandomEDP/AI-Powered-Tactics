// Sends a notification to the phones of a team's signed-in players and gaffers.
// Called by a gaffer's app with { code, kind, title, body, fixture? }:
//   kickoff, poll, highlights  go to everyone on the team except the sender
//   nudge                      goes only to players who haven't answered the poll named by `fixture`
// A player who has just claimed their profile calls it with { code, kind: "claimed" }, which tells the gaffers.
// The wording of that one is written here, not by the caller.
// Needs these secrets (Edge Functions > Secrets):
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

const KINDS = ["kickoff", "poll", "highlights", "nudge", "claimed"];
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const kind = KINDS.includes(input.kind) ? input.kind : "kickoff";
    let title = clean(input.title, 80), text = clean(input.body, 180);
    if (kind !== "claimed" && (!title || !text)) return json({ error: "Nothing to send" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first" }, 401);

    const { data: team } = await db.from("teams").select("id,code,name").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team" }, 404);
    const { data: gaffers } = await db.from("team_members").select("user_id").eq("team_id", team.id);
    const isGaffer = (gaffers || []).some((g) => g.user_id === who.user.id);
    let claimed: { name: string } | null = null;
    if (kind === "claimed") {
      const { data: mine } = await db.from("players").select("name").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
      if (!mine) return json({ error: "You haven't claimed a player on this team" }, 403);
      claimed = mine; title = clean(team.name, 80); text = `${clean(mine.name, 40)} has claimed their profile.`;
    } else if (!isGaffer) return json({ error: "Only a gaffer can notify the team" }, 403);

    const p8 = Deno.env.get("APNS_KEY_P8"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APPLE_TEAM_ID");
    if (!p8 || !keyId || !teamId) return json({ sent: 0, reason: "not_configured" });

    const { data: players } = await db.from("players").select("pid,user_id").eq("team_id", team.id).not("user_id", "is", null);
    let users: string[];
    if (kind === "nudge") {
      const { data: fixture } = await db.from("fixtures").select("id").eq("id", String(input.fixture || "")).eq("team_id", team.id).maybeSingle();
      if (!fixture) return json({ error: "No such poll" }, 404);
      const { data: votes } = await db.from("fixture_votes").select("pid").eq("fixture_id", fixture.id);
      const answered = new Set((votes || []).map((v) => v.pid));
      users = (players || []).filter((p) => !answered.has(p.pid)).map((p) => p.user_id);
    } else if (claimed) {
      users = (gaffers || []).map((g) => g.user_id);
    } else {
      users = [...(players || []), ...(gaffers || [])].map((r) => r.user_id);
    }
    users = [...new Set(users)].filter((u) => u && u !== who.user.id);
    if (!users.length) return json({ sent: 0, people: 0 });
    const { data: phones } = await db.from("push_tokens").select("token").in("user_id", users);
    if (!phones?.length) return json({ sent: 0, people: users.length });

    const jwt = await apnsJwt(p8, keyId, teamId);
    const payload = JSON.stringify({ aps: { alert: { title, body: text }, sound: "default" }, code: team.code, kind });
    let sent = 0; const dead: string[] = [];
    await Promise.all(phones.map(async (p) => {
      const res = await fetch(`https://api.push.apple.com/3/device/${p.token}`, { method: "POST", body: payload,
        headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600) } });
      if (res.ok) sent++; else if (res.status === 410 || res.status === 400) { const r = await res.json().catch(() => ({})); if (res.status === 410 || r.reason === "BadDeviceToken") dead.push(p.token); }
    }));
    if (dead.length) await db.from("push_tokens").delete().in("token", dead);
    return json({ sent, people: users.length });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
