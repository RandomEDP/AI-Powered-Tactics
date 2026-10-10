// Turns commentary lines into speech for a highlight reel, using Google Cloud Text-to-Speech (Chirp 3 HD voices).
// Called by a gaffer's app with { code, lines: [text, ...], voice? }; answers { audio: [base64 MP3 or null, ...] } in the same order.
// Each team has a monthly allowance of characters, kept in public.voice_usage, so the bill can't run away.
// Needs this secret (Edge Functions > Secrets):
//   GOOGLE_TTS_KEY   an API key for a Google Cloud project with the Cloud Text-to-Speech API switched on
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const VOICES = ["en-GB-Chirp3-HD-Charon", "en-GB-Chirp3-HD-Fenrir", "en-GB-Chirp3-HD-Puck", "en-GB-Chirp3-HD-Orus", "en-GB-Chirp3-HD-Kore", "en-GB-Chirp3-HD-Leda"];
const MONTHLY = 40000; // characters per team per month: roughly forty reels
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 240);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const input = await req.json();
    const lines: string[] = (Array.isArray(input.lines) ? input.lines : []).slice(0, 24).map(clean);
    const chars = lines.reduce((n, l) => n + l.length, 0);
    if (!chars) return json({ error: "Nothing to say." });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." });
    const { data: team } = await db.from("teams").select("id").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team." });
    const { data: gaffer } = await db.from("team_members").select("user_id").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
    if (!gaffer) return json({ error: "Only a gaffer can add commentary." });

    const key = Deno.env.get("GOOGLE_TTS_KEY");
    if (!key) return json({ error: "The voice service hasn't been set up yet." });

    const month = new Date().toISOString().slice(0, 7);
    const { data: used, error: usageError } = await db.from("voice_usage").select("chars").eq("team_id", team.id).eq("month", month).maybeSingle();
    if (usageError) return json({ error: "The commentary allowance couldn't be checked." });
    if ((used?.chars || 0) + chars > MONTHLY) return json({ error: "This team has used its commentary allowance for the month." });
    await db.from("voice_usage").upsert({ team_id: team.id, month, chars: (used?.chars || 0) + chars });

    const voice = VOICES.includes(input.voice) ? input.voice : VOICES[0];
    let problem = "";
    const audio = await Promise.all(lines.map(async (text) => {
      if (!text) return null;
      const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { text }, voice: { languageCode: "en-GB", name: voice }, audioConfig: { audioEncoding: "MP3" } }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.audioContent) { problem = String(out?.error?.message || `the voice service answered ${res.status}`).slice(0, 200); return null; }
      return out.audioContent as string;
    }));
    if (!audio.some(Boolean)) return json({ error: problem || "The voice service gave nothing back." });
    return json({ audio, chars, voice });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
