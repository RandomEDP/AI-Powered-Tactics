// Highlight clips are kept in Cloudflare R2 (free to watch however often; the Supabase free plan's 1 GB filled up).
// The app's video files go straight from the gaffer's phone to R2, through short-lived upload links made here, so the R2
// key never leaves the server. Everyone plays them from the bucket's public address (config.js clipsUrl).
// Called by a team's gaffers with { code, action, ... }:
//   upload { paths: [key] }            -> { urls: [link] }  links to PUT each file to, for an hour
//   remove { paths: [key] }            -> { removed }       deletes them (a game's highlights deleted, to cut again)
//   adopt  { game_id, seq }            -> { moved }         moves one clip (both copies) from Supabase storage to R2
// Every key must be in the team's own folder ("<team id>/..."). Secrets (Edge Functions > Secrets):
//   CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." }, 401);
    const { data: team } = await db.from("teams").select("id").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team." }, 404);
    const { data: gaffer } = await db.from("team_members").select("user_id").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
    if (!gaffer) return json({ error: "Only a gaffer can change the team's highlights." }, 403);

    const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID"), access = Deno.env.get("R2_ACCESS_KEY_ID"), secret = Deno.env.get("R2_SECRET_ACCESS_KEY"), bucket = Deno.env.get("R2_BUCKET");
    if (!account || !access || !secret || !bucket) return json({ error: "Clip storage isn't set up on Gaffer's server yet.", reason: "not_configured" }, 503);
    const host = `${account}.r2.cloudflarestorage.com`;
    const link = (method: string, key: string, expires = 3600) => presign({ method, host, path: `/${bucket}/${key}`, access, secret, region: "auto", at: new Date(), expires });
    const ours = (k: unknown) => typeof k === "string" && k.startsWith(team.id + "/") && !k.includes("..") && k.length < 300;
    const keys: string[] = Array.isArray(input.paths) ? input.paths.slice(0, 100) : [];
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
        if (!to.ok) return json({ error: `R2 wouldn't take ${k} (${to.status}): ${(await to.text()).slice(0, 200)}` }, 502);
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
