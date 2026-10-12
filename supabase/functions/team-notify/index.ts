// Sends a notification to the phones of a team's signed-in players and gaffers.
// Called by a gaffer's app with { code, kind, title, body, fixture? }:
//   kickoff, goal, poll, highlights  go to everyone on the team except the sender
//   nudge                      goes only to players who haven't answered the poll named by `fixture`
// A player who has just claimed their profile calls it with { code, kind: "claimed" }, which tells the gaffers.
// Anyone in the team's chat calls it with { code, kind: "chat", message: <id> } after posting; everyone else in the team is told.
// A gaffer who has just sent, answered or agreed a challenge calls it with { code, kind: "challenge", challenge: <id> }:
// the other team's gaffers are told, and once it is agreed everyone in both teams is.
// Someone who has just asked to join the team (their name wasn't in the squad) calls it with { code, kind: "join" }, which
// tells the gaffers, once per request.
// Anyone in the team (a gaffer or a player) whose phone sees the team's live stream getting through calls it with
// { code, kind: "live" }: the server checks with Cloudflare that the picture really is getting through, then tells
// everyone else, once per stream however many phones ask.
// The wording of those five is written here, not by the caller.
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

const KINDS = ["kickoff", "poll", "highlights", "nudge", "claimed", "chat", "goal", "challenge", "join", "live"];
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const kind = KINDS.includes(input.kind) ? input.kind : "kickoff";
    let title = clean(input.title, 80), text = clean(input.body, 180);
    if (!["claimed", "chat", "challenge", "join", "live"].includes(kind) && (!title || !text)) return json({ error: "Nothing to send" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first" }, 401);

    const { data: team } = await db.from("teams").select("id,code,name,short").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team" }, 404);
    const { data: gaffers } = await db.from("team_members").select("user_id").eq("team_id", team.id);
    const isGaffer = (gaffers || []).some((g) => g.user_id === who.user.id);

    const p8 = Deno.env.get("APNS_KEY_P8"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APPLE_TEAM_ID");
    let jwt = "";
    // Sends one notification to every phone those people have signed up, and forgets phones Apple says are gone.
    const send = async (people: string[], code: string, as: string, heading: string, words: string) => {
      const users = [...new Set(people)].filter((u) => u && u !== who.user.id);
      if (!users.length) return 0;
      const { data: phones } = await db.from("push_tokens").select("token").in("user_id", users);
      if (!phones?.length) return 0;
      if (!jwt) jwt = await apnsJwt(p8!, keyId!, teamId!);
      // a referee's whistle (bundled with the app; phones on an older version without it get the usual sound), except for chat
      const payload = JSON.stringify({ aps: { alert: { title: heading, body: words }, sound: as === "chat" ? "default" : "whistle.wav" }, code, kind: as });
      let sent = 0; const dead: string[] = [];
      await Promise.all(phones.map(async (p) => {
        const res = await fetch(`https://api.push.apple.com/3/device/${p.token}`, { method: "POST", body: payload,
          headers: { authorization: `bearer ${jwt}`, "apns-topic": BUNDLE, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600) } });
        if (res.ok) sent++; else if (res.status === 410 || res.status === 400) { const r = await res.json().catch(() => ({})); if (res.status === 410 || r.reason === "BadDeviceToken") dead.push(p.token); }
      }));
      if (dead.length) await db.from("push_tokens").delete().in("token", dead);
      return sent;
    };
    const everyone = async (id: string) => {
      const [{ data: ps }, { data: gs }] = await Promise.all([
        db.from("players").select("user_id").eq("team_id", id).not("user_id", "is", null),
        db.from("team_members").select("user_id").eq("team_id", id)]);
      return [...(ps || []), ...(gs || [])].map((r) => r.user_id as string);
    };

    if (kind === "challenge") {
      if (!isGaffer) return json({ error: "Only a gaffer can do that" }, 403);
      const { data: c } = await db.from("challenges").select("id,from_team,to_team,kind,terms,status,rounds,updated_at").eq("id", String(input.challenge || "")).maybeSingle();
      if (!c || (c.from_team !== team.id && c.to_team !== team.id)) return json({ error: "No such challenge" }, 404);
      if (Date.now() - new Date(c.updated_at).getTime() > 300000) return json({ sent: 0, reason: "old" });
      const { data: other } = await db.from("teams").select("id,code,name").eq("id", c.from_team === team.id ? c.to_team : c.from_team).maybeSingle();
      if (!other) return json({ error: "No such team" }, 404);
      if (!p8 || !keyId || !teamId) return json({ sent: 0, reason: "not_configured" });
      const when = new Date(Number(c.terms?.ko_at || 0)).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
      const game = c.kind === "elo" ? "an Elo match" : "a friendly";
      const mine = clean(team.name, 50), theirs = clean(other.name, 50);
      if (c.status === "accepted") { // it's on: a poll is waiting in both teams
        const place = clean(c.terms?.location, 60);
        const words = `${when}${place ? ` at ${place}` : ""}. Say if you're in.`;
        const sent = await send(await everyone(team.id), team.code, "poll", `${mine} v ${theirs} is on`, words)
          + await send(await everyone(other.id), other.code, "poll", `${theirs} v ${mine} is on`, words);
        return json({ sent });
      }
      const { data: theirGaffers } = await db.from("team_members").select("user_id").eq("team_id", other.id);
      const to = (theirGaffers || []).map((g) => g.user_id as string);
      const heading = c.status === "declined" ? `${mine} turned the game down` : c.status === "cancelled" ? `${mine} called the game off`
        : c.rounds > 0 ? `${mine} suggested changes` : `${mine} want ${game}`;
      const words = c.status === "proposed" ? `${when}. Open Gaffer to answer.` : `That was ${game} on ${when}.`;
      return json({ sent: await send(to, other.code, "challenge", heading, words) });
    }

    if (kind === "join") { // from someone not in the team yet: only if they really have a request waiting, and only once for it
      const { data: ask } = await db.from("join_requests").select("id,name,status,notified_at").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
      if (!ask || ask.status !== "pending") return json({ error: "No request waiting" }, 404);
      if (ask.notified_at) return json({ sent: 0, reason: "already" });
      await db.from("join_requests").update({ notified_at: new Date().toISOString() }).eq("id", ask.id);
      if (!p8 || !keyId || !teamId) return json({ sent: 0, reason: "not_configured" });
      const to = (gaffers || []).map((g) => g.user_id as string);
      return json({ sent: await send(to, team.code, "join", clean(team.name, 80), `${clean(ask.name, 40)} wants to join the squad. Open Gaffer to let them in or turn them down.`) });
    }

    if (kind === "live") {
      const { data: me } = await db.from("players").select("pid").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
      if (!isGaffer && !me) return json({ error: "Only someone in the team can do that" }, 403);
      const { data: st } = await db.from("team_streams").select("hls,started_at,on_air_at,notified_at").eq("team_id", team.id).maybeSingle();
      if (!st?.started_at || Date.now() - new Date(st.started_at).getTime() > 4 * 3600000) return json({ sent: 0, reason: "not_live" });
      if (st.notified_at) return json({ sent: 0, reason: "already" });
      let live = false;
      try { // Cloudflare's own word that the picture is getting through
        const res = await fetch(String(st.hls).replace(/\/manifest\/.*$/, "/lifecycle"));
        live = res.ok && (await res.json()).live === true;
      } catch (_e) { live = false; }
      if (!live) return json({ sent: 0, reason: "not_live" });
      const at = new Date().toISOString(); // only the first phone to get here sends it
      const { data: got } = await db.from("team_streams").update({ notified_at: at, on_air_at: st.on_air_at || at, updated_at: at })
        .eq("team_id", team.id).is("notified_at", null).not("started_at", "is", null).select("team_id");
      if (!got || !got.length) return json({ sent: 0, reason: "already" });
      if (!p8 || !keyId || !teamId) return json({ sent: 0, reason: "not_configured" });
      const { data: lm } = await db.from("live_matches").select("state").eq("team_id", team.id).maybeSingle();
      const opp = clean((lm?.state as { opp?: string } | null)?.opp, 50), us = clean(team.short || team.name, 50);
      const people = await everyone(team.id);
      return json({ sent: await send(people, team.code, "live", `${us}${opp ? ` v ${opp}` : ""} is live`, "Tap to watch the game."), people: new Set(people.filter((u) => u && u !== who.user.id)).size });
    }

    let claimed: { name: string } | null = null;
    if (kind === "claimed") {
      const { data: mine } = await db.from("players").select("name").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
      if (!mine) return json({ error: "You haven't claimed a player on this team" }, 403);
      claimed = mine; title = clean(team.name, 80); text = `${clean(mine.name, 40)} has claimed their profile.`;
    } else if (kind === "chat") {
      const { data: msg } = await db.from("messages").select("name,body,play_name,play,user_id,created_at").eq("id", String(input.message || "")).eq("team_id", team.id).maybeSingle();
      if (!msg || msg.user_id !== who.user.id) return json({ error: "No such message" }, 404);
      if (Date.now() - new Date(msg.created_at).getTime() > 120000) return json({ sent: 0, reason: "old" });
      title = clean(team.name, 80);
      text = clean(`${msg.name || "Someone"}: ${msg.body || (msg.play ? `sent a play${msg.play_name ? `, ${msg.play_name}` : ""}` : "")}`, 180);
    } else if (!isGaffer) return json({ error: "Only a gaffer can notify the team" }, 403);

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
    const people = [...new Set(users)].filter((u) => u && u !== who.user.id).length;
    return json({ sent: await send(users, team.code, kind, title, text), people });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
