// Turns commentary lines into speech for a highlight reel, using Google Cloud Text-to-Speech.
// Called by a gaffer's app with { code, lines: [text, ...], voice?, style? }; answers { audio: [base64 MP3 or null, ...], engine } in the same order.
// style "hype" asks Gemini-TTS to perform the line like a live commentator; if that isn't available to the key, or style is "plain",
// the same voice from the Chirp 3 HD set reads it straight.
// Each team has a monthly allowance of characters, kept in public.voice_usage, so the bill can't run away.
// Needs this secret (Edge Functions > Secrets):
//   GOOGLE_TTS_KEY           an API key for a Google Cloud project with the Cloud Text-to-Speech API switched on
// and, for the live-commentator delivery (Google won't take a plain API key for that model):
//   GOOGLE_SERVICE_ACCOUNT   the whole JSON key file of a service account in that project with the "Vertex AI User" role
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
  : /API keys are not supported|endpoints\.predict/i.test(m) ? (Deno.env.get("GOOGLE_SERVICE_ACCOUNT") ? "the service account needs the Vertex AI User role in the Google project" : "it needs a service account: Google doesn't accept a plain API key for this voice")
  : /billing/i.test(m) ? "the Google project needs billing switched on"
  : m.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 170);

// Signs in to Google as the service account and returns a token good for an hour (kept between calls). Null if none is set up.
const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let t = ""; bytes.forEach((b) => (t += String.fromCharCode(b)));
  return btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
let signedIn: { token: string; until: number } | null = null;
async function googleToken(): Promise<string | null> {
  const raw = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "").trim();
  if (!raw) return null;
  if (signedIn && Date.now() < signedIn.until) return signedIn.token;
  let account: { client_email?: string; private_key?: string };
  try { account = JSON.parse(raw); } catch (_e) { throw new Error("the service account secret isn't the whole JSON key file"); }
  if (!account.client_email || !account.private_key) throw new Error("the service account secret isn't a service account key file");
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const claim = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(claim));
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: claim + "." + b64url(signature) }) });
  const out = await res.json().catch(() => ({}));
  if (!out.access_token) throw new Error(`Google wouldn't sign the service account in: ${out.error_description || out.error || res.status}`);
  signedIn = { token: out.access_token, until: Date.now() + (Math.max(300, Number(out.expires_in) || 3600) - 120) * 1000 };
  return signedIn.token;
}

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
    const speak = async (body: unknown, note: (m: string) => void, bearer?: string | null) => {
      const res = bearer
        ? await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) })
        : await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.audioContent) { note(String(out?.error?.message || `the voice service answered ${res.status}`).slice(0, 400)); return null; }
      return out.audioContent as string;
    };
    const straight = (text: string) => speak({ input: { text }, voice: { languageCode: "en-GB", name: `en-GB-Chirp3-HD-${voice}` }, audioConfig: { audioEncoding: "MP3" } }, (m) => { problem = m; });
    const refused = (m: string) => { if (!hypeProblem) console.error("live-commentator delivery refused:", m); hypeProblem = m; };
    // The live-commentator model wants to know who is calling: signed in as the service account if there is one, else the plain key.
    let bearer: string | null = null;
    if (input.style !== "plain") { try { bearer = await googleToken(); } catch (e) { refused(String((e as Error)?.message || e)); } }
    const performed = (text: string) => speak({ input: { text, prompt: HYPE }, voice: { languageCode: "en-GB", name: voice, model_name: "gemini-2.5-flash-tts" }, audioConfig: { audioEncoding: "MP3" } }, refused, bearer);
    let engine = "chirp";
    let audio: (string | null)[] = [];
    if (input.style !== "plain" && !(hypeProblem && !bearer)) { // (not if signing in as the service account has just failed)
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
