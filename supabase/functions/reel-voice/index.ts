// Turns commentary lines into speech for a highlight reel, using Google Cloud Text-to-Speech.
// Called by a gaffer's app with { code, lines: [text, ...], voice?, style? }; answers { audio: [base64 MP3 or null, ...], engine } in the same order.
// style "hype" asks Gemini-TTS to perform the line like a live commentator; if that isn't available to the key, or style is "plain",
// the same voice from the Chirp 3 HD set reads it straight.
// Each team has a monthly allowance of characters, kept in public.voice_usage, so the bill can't run away.
// Needs this secret (Edge Functions > Secrets):
//   GOOGLE_TTS_KEY   an API key for a Google Cloud project with the Cloud Text-to-Speech API switched on
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const VOICES = ["Fenrir", "Puck", "Sadachbia", "Algenib", "Orus", "Charon", "Kore", "Leda"];
const HYPE = "You are an excitable British football commentator calling the action live on television. Loud, fast and full of energy, voice rising to a shout on the goal. Say exactly this:";
const MONTHLY = 40000; // characters per team per month: roughly forty reels
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
// Google's own wording for why the live-commentator delivery was refused is long and ends in a web address that doesn't
// fit on a phone screen: say what it means instead.
const reason = (m: string) =>
  /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(m) ? "Google's Agent Platform API has to be switched on for the project the key belongs to"
  : /are blocked|SERVICE_BLOCKED/i.test(m) ? "the key is limited to certain Google services. In Google Cloud: Credentials, open the key, API restrictions, and add Agent Platform API"
  : /API keys are not supported/i.test(m) ? "Google doesn't take an API key for this delivery: it needs a service account instead"
  : /billing/i.test(m) ? "the Google project needs billing switched on"
  : m.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 170);

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
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`;
    let problem = "", hypeProblem = "";
    const speak = async (body: unknown, note: (m: string) => void) => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.audioContent) { note(String(out?.error?.message || `the voice service answered ${res.status}`).slice(0, 400)); return null; }
      return out.audioContent as string;
    };
    const straight = (text: string) => speak({ input: { text }, voice: { languageCode: "en-GB", name: `en-GB-Chirp3-HD-${voice}` }, audioConfig: { audioEncoding: "MP3" } }, (m) => { problem = m; });
    const performed = (text: string) => speak({ input: { text, prompt: HYPE }, voice: { languageCode: "en-GB", name: voice, model_name: "gemini-2.5-flash-tts" }, audioConfig: { audioEncoding: "MP3" } }, (m) => { if (!hypeProblem) console.error("live-commentator delivery refused:", m); hypeProblem = m; });
    let engine = "chirp";
    let audio: (string | null)[] = [];
    if (input.style !== "plain") {
      // try the first line as a performance; only carry on that way if it works
      const firstAt = lines.findIndex(Boolean);
      const first = await performed(lines[firstAt]);
      if (first) {
        engine = "gemini";
        audio = await Promise.all(lines.map((text, i) => !text ? null : i === firstAt ? first : performed(text)));
        audio = await Promise.all(audio.map((a, i) => a || !lines[i] ? a : straight(lines[i]))); // any that failed are read straight
      }
    }
    if (engine === "chirp") audio = await Promise.all(lines.map((text) => text ? straight(text) : null));
    if (!audio.some(Boolean)) return json({ error: problem || hypeProblem || "The voice service gave nothing back." });
    return json({ audio, chars, voice, engine, note: engine === "chirp" && hypeProblem ? reason(hypeProblem) : undefined });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
