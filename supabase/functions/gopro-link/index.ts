// A GoPro share link (gopro.com/v/<id>, made with Share in GoPro Quik or on the GoPro website) turned into the videos in
// it, each with an address the phone downloads it from (Ethan, October 2026: "I have a GoPro premium all my footage goes
// there ... I can paste a GoPro share link and you download it from there"). Anyone with such a link can watch and
// download what's in it without signing in to GoPro, so nothing of Ethan's GoPro account is needed or kept.
// Only the small lists go through here: the video itself goes straight from GoPro's own servers to the gaffer's phone,
// which needs the file anyway to cut the highlights on (so none of it passes through Supabase or R2).
// Called by a team's gaffers with { code, link, res? } -> { title, videos: [{ id, name, captured, duration, width, height,
// quality, size, url }] }, newest first. `url` works for about an hour; the phone starts its download straight away.
// GoPro's addresses (api.gopro.com, as its own share page uses them; checked October 2026):
//   /collections/<share id>/media   what's in the share (the older short ids, gopro.com/v/AbC123)
//   /media/items/<share id>         what's in the share for the newer ids, which look like 26a90bf2-007d-4321-...
//                                   (each item's video is under `medium`; Ethan's links were these, October 2026)
//   /media/<id>/download            each video's versions ("source" the original, "high_res_proxy_mp4" 1080p, "mp4_low")
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const API = "https://api.gopro.com";
const ask = (path: string, kind: string) => fetch(API + path, { headers: { Accept: `application/vnd.gopro.jk.${kind}+json; version=2.0.0`, Origin: "https://gopro.com", Referer: "https://gopro.com/" } });
const GOPRO = /^([a-z0-9-]+\.)*(gopro\.com|gopro\.app\.link)$/i;
const MAX = 10; // (a share of a whole season is cut down to the newest few)

/// The share's id from whatever was pasted: the link itself, a link inside a message ("Check out my video
/// https://gopro.com/v/AbC123"), or the id on its own. Null if it isn't a GoPro share link.
export function shareId(pasted: string): string | null {
  const s = String(pasted || "").trim();
  const m = s.match(/gopro\.com\/v\/([A-Za-z0-9-]{6,64})/i);
  if (m) return m[1];
  return /^[A-Za-z0-9]{10,20}$/.test(s) || isUuid(s) ? s : null;
}

/// The newer kind of share id (how GoPro's own share page tells them apart).
export const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/// What's in the share: GoPro's own share page asks /media/items/ for the newer ids and /collections/ for the older.
/// Each is tried the other way too if GoPro says it can't find it, in case GoPro moves the older ones across.
async function shared(id: string): Promise<{ status: number; media: Array<Record<string, unknown>> }> {
  const items = async () => {
    const res = await ask(`/media/items/${id}?page=1&per_page=200`, "media");
    if (!res.ok) return { status: res.status, media: [] };
    const got = await res.json();
    return { status: 200, media: (got?.items || []).map((i: Record<string, unknown>) => i?.medium || i).filter(Boolean) };
  };
  const collection = async () => {
    const res = await ask(`/collections/${id}/media`, "media");
    if (!res.ok) return { status: res.status, media: [] };
    return { status: 200, media: (await res.json())?._embedded?.media || [] };
  };
  const [first, second] = isUuid(id) ? [items, collection] : [collection, items];
  const a = await first();
  if (a.status !== 404) return a;
  const b = await second();
  return b.status === 404 ? a : b;
}

/// A short link (Quik's gopro.app.link) followed to the gopro.com/v/ link it stands for, only ever through GoPro's own
/// addresses.
async function follow(pasted: string): Promise<string | null> {
  let url = (String(pasted).match(/https?:\/\/[^\s"'<>]+/) || [])[0];
  for (let hop = 0; url && hop < 4; hop++) {
    let host = "";
    try { host = new URL(url).hostname; } catch { return null; }
    if (!GOPRO.test(host)) return null;
    const id = shareId(url);
    if (id) return id;
    const res = await fetch(url, { redirect: "manual" });
    const next = res.headers.get("location");
    if (!next) { const page = await res.text(); return shareId(page); }
    url = new URL(next, url).href;
  }
  return null;
}

/// Which version of a video to download. The 1080p one GoPro makes of every upload is plenty for highlights (each clip
/// is made smaller again before it's uploaded) and far smaller than a 4K or 5.3K original (a half of 5.3K is over 10 GB);
/// the original is used when there's no 1080p one, or the original is no bigger than 1080p anyway.
/// `res` "4k" (the Gaffer tier's 4K highlights): the original up to 4K (a 5.3K one is still too big, so it's the 1080p copy).
export function pickVersion(variations: Array<Record<string, unknown>>, res?: string) {
  const ok = (variations || []).filter((v) => v && v.available !== false && typeof v.url === "string" && (v.type || "mp4") === "mp4");
  const by = (label: string) => ok.find((v) => v.label === label);
  const source = by("source"), proxy = by("high_res_proxy_mp4");
  const [long, short] = res === "4k" ? [3840, 2160] : [1920, 1080];
  const w = Number(source?.width || 0), h = Number(source?.height || 0);
  if (source && (!proxy || Math.max(w, h) <= long && Math.min(w, h) <= short)) return source;
  return proxy || source || ok.filter((v) => v.label !== "mp4_low")[0] || null;
}

const said = (error: string, reason: string, status = 400) => json({ error, reason }, status);

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
    if (!gaffer) return json({ error: "Only a gaffer can cut the team's highlights." }, 403);

    const pasted = String(input.link || "").slice(0, 2000);
    const id = shareId(pasted) || await follow(pasted).catch(() => null);
    if (!id) return said("That isn't a GoPro share link. In GoPro Quik, open the video, tap Share, then Copy link, and paste that here. It looks like gopro.com/v/ followed by letters and numbers.", "not_gopro");

    const list = await shared(id);
    if (list.status === 403 || list.status === 401)
      return said("GoPro says only people signed in to it can open that link. In GoPro Quik, share the video again with a link anyone can open, and paste that.", "not_shared", 404);
    if (list.status === 404)
      return said("GoPro says that link isn't shared any more, or it was copied wrong. Make a new share link in GoPro Quik and paste that.", "not_shared", 404);
    if (list.status !== 200) return said(`GoPro didn't answer properly (${list.status}). Try again in a minute.`, "gopro_down", 502);
    const media: Array<Record<string, unknown>> = list.media.filter((m: Record<string, unknown>) => m && m.id && (m.type === "Video" || m.type === "MultiClipEdit" || m.play_as === "video"));
    if (!media.length) return said("There's no video in that share, only photos. Share the match video itself from GoPro Quik.", "no_video", 404);
    media.sort((a, b) => String(b.captured_at || "").localeCompare(String(a.captured_at || "")));

    const videos = [];
    for (const m of media.slice(0, MAX)) {
      const res = await ask(`/media/${m.id}/download`, "media");
      if (!res.ok) continue;
      const got = await res.json();
      const v = pickVersion(got?._embedded?.variations || [], input.res === "4k" ? "4k" : undefined);
      if (!v) continue;
      let size = v.label === "source" && Number(m.file_size) ? Number(m.file_size) : 0;
      if (!size && typeof v.head === "string") { // (how big the 1080p version is, so the phone can check it has room)
        try { const h = await fetch(v.head, { method: "HEAD" }); size = Number(h.headers.get("content-length")) || 0; } catch { /* not known */ }
      }
      videos.push({
        id: String(m.id), name: String(got.filename || m.filename || "GoPro video"), captured: m.captured_at || null,
        duration: Number(m.source_duration) ? Number(m.source_duration) / 1000 : null,
        width: Number(v.width) || null, height: Number(v.height) || null, quality: String(v.quality || v.label || ""), size, url: v.url,
      });
    }
    if (!videos.length) return said("GoPro hasn't finished getting that video ready yet. Wait until it plays in GoPro Quik, then try again.", "not_ready", 409);
    return json({ title: media.length === 1 ? videos[0].name : `${media.length} videos`, videos, more: Math.max(0, media.length - MAX) });
  } catch (e) {
    console.error("gopro-link:", e);
    return said("Couldn't read that GoPro link just now. Check your signal and try again.", "failed", 500);
  }
});
