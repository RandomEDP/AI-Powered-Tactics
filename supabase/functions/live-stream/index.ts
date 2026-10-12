// Streams a game live from the team's GoPro (or anything else that can send RTMPS) through Cloudflare Stream, for
// everyone following the team to watch in the app. Each team has one camera link, made the first time it's asked for and
// kept by Cloudflare, so the gaffer pastes it into GoPro Quik once. The link only takes a stream while a gaffer has the
// team live, so a link that gets out can't be used to put something else in front of the team.
// Called by a gaffer's app with { code, action }:
//   link     the camera link to paste into GoPro Quik: { url, server, key, on }
//   start    { gid } go live for this game: the link starts taking the stream, and the team can see a stream is on
//   status   { on, on_air, first }: is the camera getting through? `first` is true once per stream, for the one caller
//            that should then tell the team
//   stop     the stream is over: the link stops taking it (Cloudflare keeps the recording for 30 days)
//   renew    a new camera link, for when the old one has got out; the old one stops working at once
// Everyone else reads whether a stream is on, and where it plays from, through the database function team_stream.
// Needs these secrets (Edge Functions > Secrets):
//   CLOUDFLARE_ACCOUNT_ID     the Cloudflare account's ID
//   CLOUDFLARE_STREAM_TOKEN   a Cloudflare API token with the Stream: Edit permission on that account
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const ACTIONS = ["link", "start", "status", "stop", "renew"];
const API = "https://api.cloudflare.com/client/v4/accounts";
const FRESH = 4 * 3600000; // a stream nobody ended is taken as over after four hours (as team_stream does)
const KEEP_DAYS = 30;      // how long Cloudflare keeps each recording

// A problem to put in front of the gaffer, in words they can act on.
class Said extends Error {
  status: number;
  constructor(words: string, status = 502) { super(words); this.status = status; }
}

type Input = { uid: string; enabled?: boolean; status?: string | null; rtmps?: { url?: string; streamKey?: string }; playback?: { hls?: string } };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const action = ACTIONS.includes(body.action) ? body.action : "";
    if (!action) return json({ error: "Nothing to do" }, 400);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first" }, 401);
    const { data: team } = await db.from("teams").select("id,code,name").eq("code", String(body.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team" }, 404);
    const { data: gaffers } = await db.from("team_members").select("user_id").eq("team_id", team.id);
    if (!(gaffers || []).some((g) => g.user_id === who.user.id)) return json({ error: "Only a gaffer can stream the team's games" }, 403);

    const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), key = Deno.env.get("CLOUDFLARE_STREAM_TOKEN");
    if (!account || !key) return json({ error: "Live streaming isn't set up on Gaffer's server yet.", reason: "not_configured" }, 503);

    // Cloudflare's live inputs API. Null for one it doesn't have (any more).
    const cf = async (path: string, method = "GET", send?: unknown): Promise<Input | null> => {
      const res = await fetch(`${API}/${account}/stream/live_inputs${path}`, { method, body: send ? JSON.stringify(send) : undefined,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.success !== false) return out.result || null;
      if (res.status === 404) return null;
      const said = ((out.errors || []) as { message?: string }[]).map((e) => e.message).filter(Boolean).join("; ");
      console.log(`Cloudflare ${method} live_inputs${path}: ${res.status} ${said}`);
      if (res.status === 401 || res.status === 403) throw new Said("Cloudflare turned down Gaffer's streaming key. It needs the Stream: Edit permission on the account.");
      throw new Said(`Cloudflare couldn't do that just now${said ? ` (${clean(said, 120)})` : ""}. Try again in a minute.`);
    };
    // Everything about the link, sent in full each time so an update never loses the recording settings.
    const settings = (on: boolean) => ({ meta: { name: `${clean(team.name, 60)} (Gaffer)`, team: team.id }, enabled: on, deleteRecordingAfterDays: KEEP_DAYS,
      recording: { mode: "automatic", requireSignedURLs: false, allowedOrigins: [], hideLiveViewerCount: false, timeoutSeconds: 0 } });
    const link = (li: Input) => {
      const server = String(li.rtmps?.url || ""), streamKey = String(li.rtmps?.streamKey || "");
      if (!server || !streamKey) throw new Said("Cloudflare didn't send the camera link. Try again in a minute.");
      return { url: server.replace(/\/?$/, "/") + streamKey, server, key: streamKey };
    };
    const now = () => new Date().toISOString();

    const { data: row } = await db.from("team_streams").select("input_uid,hls,gid,started_at,on_air_at").eq("team_id", team.id).maybeSingle();
    const on = !!row?.started_at && Date.now() - new Date(row.started_at).getTime() < FRESH;
    const make = async (): Promise<Input> => { // a new camera link for the team, off until a gaffer goes live
      const li = await cf("", "POST", settings(false));
      const hls = String(li?.playback?.hls || "");
      if (!li?.uid || !/^https:\/\/[a-z0-9.-]+\.cloudflarestream\.com\//.test(hls)) throw new Said("Cloudflare made the camera link but didn't say where it plays from. Try again.");
      const { error } = await db.from("team_streams").upsert({ team_id: team.id, input_uid: li.uid, hls, gid: null, started_at: null, on_air_at: null, updated_at: now() });
      if (error) throw new Error(error.message);
      return li;
    };
    const current = async () => (row ? await cf(`/${row.input_uid}`) : null) || await make();

    if (action === "link") return json({ ...link(await current()), on });

    if (action === "start") {
      const gid = clean(body.gid, 64) || null, li = await current();
      if (li.enabled !== true) await cf(`/${li.uid}`, "PUT", settings(true));
      const same = on && row && row.input_uid === li.uid && row.gid === gid; // pressed again for the same game: it's already on
      if (!same) await db.from("team_streams").update({ gid, started_at: now(), on_air_at: null, updated_at: now() }).eq("team_id", team.id);
      const { data: s } = await db.from("team_streams").select("hls").eq("team_id", team.id).maybeSingle();
      return json({ ...link(li), on: true, hls: s?.hls || null });
    }

    if (action === "status") {
      if (!row || !on) return json({ on: false, on_air: false, first: false });
      let live = false;
      try { // Cloudflare's public check on whether the link is taking a stream right now
        const res = await fetch(row.hls.replace(/\/manifest\/.*$/, "/lifecycle"));
        live = res.ok && (await res.json()).live === true;
      } catch (_e) {
        const li = await cf(`/${row.input_uid}`);
        live = !!li && ["connected", "reconnected"].includes(String(li.status || ""));
      }
      let first = false;
      if (live && !row.on_air_at) { // only one caller gets to say "we're live", however many gaffers are checking
        const { data: got } = await db.from("team_streams").update({ on_air_at: now(), updated_at: now() }).eq("team_id", team.id).is("on_air_at", null).not("started_at", "is", null).select("team_id");
        first = !!got && got.length > 0;
      }
      return json({ on: true, on_air: live, first });
    }

    if (action === "stop") {
      if (row) {
        if (await cf(`/${row.input_uid}`)) await cf(`/${row.input_uid}`, "PUT", settings(false));
        await db.from("team_streams").update({ gid: null, started_at: null, on_air_at: null, updated_at: now() }).eq("team_id", team.id);
      }
      return json({ on: false });
    }

    // renew
    if (on) return json({ error: "End the stream first, then make a new link." }, 409);
    const fresh = await make();
    if (row && row.input_uid !== fresh.uid && await cf(`/${row.input_uid}`)) await cf(`/${row.input_uid}`, "PUT", settings(false)); // the old link takes nothing from now on
    return json({ ...link(fresh), on: false });
  } catch (e) {
    if (e instanceof Said) return json({ error: e.message }, e.status);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
