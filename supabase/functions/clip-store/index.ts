// Highlight clips are kept in Cloudflare R2 (free to watch however often; the Supabase free plan's 1 GB filled up).
// The app's video files go straight from the gaffer's phone to R2, through short-lived upload links made here, so the R2
// key never leaves the server. Everyone plays them from the bucket's public address (config.js clipsUrl).
// Called by a team's gaffers with { code, action, ... }:
//   upload { paths: [key] }            -> { urls: [link] }  links to PUT each file to, for an hour
//   remove { paths: [key] }            -> { removed }       deletes them (a game's highlights deleted, to cut again)
//   adopt  { game_id, seq }            -> { moved }         moves one clip (both copies) from Supabase storage to R2
//   check                              -> { ok }            is R2 taking files? (else 503 with R2's own reason)
// Every key must be in the team's own folder ("<team id>/..."). A player who has joined the squad as themselves may also
// upload and remove their own reel, in their own folder ("<team id>/players/<their pid>/..."), and nothing else.
// Anyone signed in, with { own: true, action, paths } and no team: upload (or remove) their own short clips, for posting
// (0049), in their own folder ("users/<their account>/<name>.mp4"), two files a call at most. These only ever go to R2.
// Secrets (Edge Functions > Secrets):
//   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (and R2_HOST only if the bucket's S3 address
//   isn't <account>.r2.cloudflarestorage.com or the EU one)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const hmac = async (key: ArrayBuffer | Uint8Array, s: string) =>
  await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), enc.encode(s));
// S3's own way of escaping a path or query value
const esc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/// A presigned S3 (AWS Signature Version 4) link: anyone holding it can do `method` to that one object until it expires.
export async function presign(o: { method: string; host: string; path: string; access: string; secret: string; region: string; at: Date; expires: number }) {
  const stamp = o.at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"), day = stamp.slice(0, 8);
  const scope = `${day}/${o.region}/s3/aws4_request`;
  const query: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"], ["X-Amz-Credential", `${o.access}/${scope}`], ["X-Amz-Date", stamp],
    ["X-Amz-Expires", String(o.expires)], ["X-Amz-SignedHeaders", "host"],
  ];
  const canonicalQuery = query.map(([k, v]) => `${esc(k)}=${esc(v)}`).sort().join("&");
  const canonicalPath = o.path.split("/").map(esc).join("/");
  const request = [o.method, canonicalPath, canonicalQuery, `host:${o.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, await sha256(request)].join("\n");
  let key: ArrayBuffer = await hmac(enc.encode("AWS4" + o.secret), day);
  for (const part of [o.region, "s3", "aws4_request"]) key = await hmac(key, part);
  return `https://${o.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${hex(await hmac(key, toSign))}`;
}

// R2's own reason for saying no, from its XML answer ("403 SignatureDoesNotMatch")
const r2Said = (status: number, body: string) => `${status} ${(body.match(/<Code>([^<]+)<\/Code>/) || [])[1] || body.slice(0, 120)}`;
const env = (k: string) => (Deno.env.get(k) || "").trim(); // (a secret pasted with a space or a new line on the end still works)

/// Is R2 there and taking files? A tiny file is put in the team's folder first, so a refusal is found out before any video
/// is fetched from the old storage (each failed move used to download both copies of a clip, which Supabase counts), and
/// so the phone is told to use the old storage straight away. A bucket made in the EU jurisdiction lives at
/// <account>.eu.r2.cloudflarestorage.com, so that's tried when the usual address says there's no such bucket.
/// The answer is kept for this instance for 10 minutes.
let ready: { at: number; ok: boolean; host?: string; error?: string; reason?: string } | null = null;
export function resetR2() { ready = null; }
async function r2Ready(teamId: string) {
  const account = env("CLOUDFLARE_ACCOUNT_ID"), access = env("R2_ACCESS_KEY_ID"), secret = env("R2_SECRET_ACCESS_KEY"), bucket = env("R2_BUCKET");
  const linkAt = (host: string) => (method: string, key: string, expires = 3600) => presign({ method, host, path: `/${bucket}/${key}`, access, secret, region: "auto", at: new Date(), expires });
  if (!account || !access || !secret || !bucket) return { ok: false, error: "Clip storage isn't set up on Gaffer's server yet.", reason: "not_configured" } as const;
  if (!ready || Date.now() - ready.at > 600000) {
    let said = "";
    ready = null;
    for (const host of [env("R2_HOST") || `${account}.r2.cloudflarestorage.com`, `${account}.eu.r2.cloudflarestorage.com`]) {
      try {
        const res = await fetch(await linkAt(host)("PUT", `${teamId}/.probe`, 300), { method: "PUT", body: "ok", headers: { "Content-Type": "text/plain" } });
        if (res.ok) { ready = { at: Date.now(), ok: true, host }; break; }
        said = r2Said(res.status, await res.text());
      } catch (e) { said = String((e as Error)?.message || e); }
      if (!/NoSuchBucket/.test(said)) break;
    }
    if (!ready) {
      console.error("R2 refused a test file:", said);
      ready = { at: Date.now(), ok: false, error: `Cloudflare R2 refused a test file (${said}). The clips stay in the old storage until it's fixed.`, reason: "r2_refused" };
    }
  }
  return ready.ok ? { ok: true, host: ready.host!, link: linkAt(ready.host!) } as const : { ok: false, error: ready.error!, reason: ready.reason! } as const;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    if (input.own === true) { // your own short clips, in your own folder, not in any team
      const own = `users/${who.user.id}/`;
      const keys: unknown[] = Array.isArray(input.paths) ? input.paths : [];
      if ((input.action !== "upload" && input.action !== "remove") || !keys.length || keys.length > 2 ||
          !keys.every((k) => typeof k === "string" && k.startsWith(own) && !k.includes("..") && /^[A-Za-z0-9_-]{1,80}\.mp4$/.test(k.slice(own.length))))
        return json({ error: "Those files aren't in your own folder." }, 403);
      const r2 = await r2Ready(own.slice(0, -1));
      if (!r2.ok) return json({ error: r2.error, reason: r2.reason }, 503);
      if (input.action === "upload") return json({ urls: await Promise.all((keys as string[]).map((k) => r2.link("PUT", k))) });
      let removed = 0;
      for (const k of keys as string[]) { const res = await fetch(await r2.link("DELETE", k, 300), { method: "DELETE" }); if (res.ok || res.status === 404) removed++; }
      return json({ removed });
    }
    const { data: team } = await db.from("teams").select("id").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team." }, 404);
    const { data: gaffer } = await db.from("team_members").select("user_id").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
    if (!gaffer) { // a player: only their own reel's folder
      const { data: me } = await db.from("players").select("pid").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
      const own = me ? `${team.id}/players/${me.pid}/` : "";
      const asked: unknown[] = Array.isArray(input.paths) ? input.paths : [];
      if (!own || (input.action !== "upload" && input.action !== "remove") || !asked.length || !asked.every((k) => typeof k === "string" && k.startsWith(own)))
        return json({ error: "Only a gaffer can change the team's highlights." }, 403);
    }

    const r2 = await r2Ready(team.id);
    // (an upload R2 refuses is answered as "not set up", so every build of the app puts the files in the old storage
    // straight away instead of trying R2 first)
    if (!r2.ok) return json({ error: r2.error, reason: input.action === "upload" ? "not_configured" : r2.reason, r2: r2.reason }, 503);
    const link = r2.link;
    const ours = (k: unknown) => typeof k === "string" && k.startsWith(team.id + "/") && !k.includes("..") && k.length < 300;
    const keys: string[] = Array.isArray(input.paths) ? input.paths.slice(0, 100) : [];
    if (input.action === "check") return json({ ok: true, host: r2.host });
    if (input.action !== "adopt" && (!keys.length || !keys.every(ours))) return json({ error: "Those files aren't in this team's folder." }, 400);

    if (input.action === "upload") return json({ urls: await Promise.all(keys.map((k) => link("PUT", k))) });

    if (input.action === "remove") {
      let removed = 0;
      for (const k of keys) { const res = await fetch(await link("DELETE", k, 300), { method: "DELETE" }); if (res.ok || res.status === 404) removed++; }
      return json({ removed });
    }

    if (input.action === "adopt") { // one clip, both its copies, from Supabase storage to R2; then the row says so, and the old files go
      const { data: clip } = await db.from("clips").select("game_id,seq,path,vpath,store").eq("team_id", team.id).eq("game_id", String(input.game_id || "")).eq("seq", Number(input.seq)).maybeSingle();
      if (!clip) return json({ error: "No such clip." }, 404);
      if (clip.store === "r2") return json({ moved: 0 });
      const files = [clip.path, clip.vpath].filter(ours) as string[];
      for (const k of files) {
        const from = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/clips/${k.split("/").map(encodeURIComponent).join("/")}`);
        if (!from.ok) return json({ error: `Couldn't read ${k} from the old storage (${from.status}).` }, 502);
        const body = await from.arrayBuffer();
        const to = await fetch(await link("PUT", k), { method: "PUT", body, headers: { "Content-Type": "video/mp4" } });
        if (!to.ok) { const said = r2Said(to.status, await to.text()); console.error("R2 refused", k, said); return json({ error: `R2 wouldn't take ${k} (${said}).`, reason: "r2_refused" }, 502); }
      }
      await db.from("clips").update({ store: "r2" }).eq("team_id", team.id).eq("game_id", clip.game_id).eq("seq", clip.seq);
      await db.storage.from("clips").remove(files); // (only once the copies are safely in R2 and the row points there)
      return json({ moved: files.length });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
