// Turns commentary lines into speech for a highlight reel, using Google Cloud Text-to-Speech.
// Called by a gaffer's app (a game's highlights) or a player's (their own reel) with { code, lines: [text, ...], voice?, style? };
// answers { audio: [base64 MP3 or null, ...], engine } in the same order. Only the team's gaffers and players who have joined
// the squad as themselves can use it.
// style "hype" asks Gemini-TTS to perform the line like a live commentator, and "sweary" (18+, the app writes lines with
// swearing in) like a foul-mouthed pub commentator; if that isn't available to the key, or style is "plain", the same voice
// from the Chirp 3 HD set reads it straight.
// Each team has a monthly allowance of characters, kept in public.voice_usage, so the bill can't run away.
// Fenrir is free; every other voice, and the Sweary delivery, is bought once by the person asking (0034_voice_unlocks.sql,
// counted by team-pass), and is refused here until they have (reason "locked", with the voices missing in "locked").
// { action: "sample", voice, style } answers { url }: a short line in that voice, made once and kept in the public
// voice-samples bucket, for anyone signed in to hear before buying. It names nobody and counts against no team.
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
// (Ethan: it came out Australian, so the accent is spelt out.)
const SWEARY = "You are a foul-mouthed Sunday-league football commentator from the East End of London, speaking in a broad, proper East London Cockney accent: dropped h's, glottal stops (foo'ball, wha' a goal), London vowels. Never Australian, never American, never posh. You can't believe what you're watching: loud, raw and incredulous, swearing freely, shouting the big moments as if you're losing your mind down the pub. Say exactly this, swear words and all:";
const FREE = "Fenrir";
// The same sample for every voice, so they can be compared like for like; no names, so nothing about anyone goes to Google.
const SAMPLE: Record<string, string> = {
  hype: "Here he comes, cuts inside, shoots... and it's in! Top corner! What a goal!",
  plain: "Here he comes, cuts inside, shoots, and it's in. Top corner. What a goal.",
  sweary: "Here he comes, cuts inside, shoots... and it's in! Top bloody corner! What a fucking goal, my son!",
};
const MONTHLY = 40000; // characters per team per month: roughly forty reels
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
// Google's own wording for why the live-commentator delivery was refused is long and ends in a web address that doesn't
// fit on a phone screen: say what it means instead.
const reason = (m: string) =>
  /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(m) ? "Google's Agent Platform API has to be switched on for the project the key belongs to"
  : /are blocked|SERVICE_BLOCKED/i.test(m) ? "the key is limited to certain Google services. In Google Cloud: Credentials, open the key, API restrictions, and add Agent Platform API"
  : /API keys are not supported|endpoints\.predict/i.test(m) ? (Deno.env.get("GOOGLE_SERVICE_ACCOUNT") ? "the service account needs the Vertex AI User role in the Google project" : "it needs a service account: Google doesn't accept a plain API key for this voice")
  : /quota|rate.?limit|resource.?exhausted/i.test(m) ? "Google's limit on how often the commentator voice can be asked for was hit. In Google Cloud: IAM & Admin, Quotas, search gemini-2.5-flash-tts, and ask for a higher limit"
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
    const style = input.style === "plain" || input.style === "sweary" ? input.style : "hype";
    const sample = input.action === "sample";
    const lines: string[] = sample ? [SAMPLE[style]] : (Array.isArray(input.lines) ? input.lines : []).slice(0, 24).map(clean);
    const chars = lines.reduce((n, l) => n + l.length, 0);
    if (!chars) return json({ error: "Nothing to say." });
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: "Sign in first." });
    const voice = VOICES.includes(input.voice) ? input.voice : FREE;
    const file = `${voice.toLowerCase()}-${style}.mp3`;
    const sampleUrl = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/voice-samples/${file}`;
    if (sample) { // made once, then everyone plays the same file
      const there = await fetch(sampleUrl, { method: "HEAD" }).catch(() => null);
      if (there?.ok) return json({ url: sampleUrl });
    } else {
      // A paid voice (or Sweary) only for someone who has bought it.
      const need = [voice, style === "sweary" ? "sweary" : ""].filter((v) => v && v !== FREE).map((v) => v.toLowerCase());
      if (need.length) {
        const { data: owned, error: ownedError } = await db.from("voice_unlocks").select("voice").eq("user_id", who.user.id).in("voice", need);
        if (ownedError) return json({ error: "Your voices couldn't be checked. Try again in a moment." });
        const locked = need.filter((v) => !(owned || []).some((o: { voice: string }) => o.voice === v));
        if (locked.length) {
          const named = locked.map((v) => v === "sweary" ? "Sweary" : v[0].toUpperCase() + v.slice(1));
          return json({ error: `${named.join(" and ")} ${locked.length > 1 ? "are paid voices" : "is a paid voice"}: unlock ${locked.length > 1 ? "them" : "it"} in the voice picker, or pick ${FREE}, which is free.`, reason: "locked", locked });
        }
      }
    }
    const { data: team } = sample ? { data: { id: "" } } : await db.from("teams").select("id").eq("code", String(input.code || "").toUpperCase().trim()).maybeSingle();
    if (!team) return json({ error: "No such team." });
    const { data: gaffer } = sample ? { data: true } : await db.from("team_members").select("user_id").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
    const { data: player } = gaffer ? { data: null } : await db.from("players").select("pid").eq("team_id", team.id).eq("user_id", who.user.id).maybeSingle();
    if (!gaffer && !player) return json({ error: "Only the team's gaffers and players can add commentary. Join the squad as yourself first." });

    const key = Deno.env.get("GOOGLE_TTS_KEY");
    if (!key) return json({ error: "The voice service hasn't been set up yet." });

    if (!sample) {
      const month = new Date().toISOString().slice(0, 7);
      const { data: used, error: usageError } = await db.from("voice_usage").select("chars").eq("team_id", team.id).eq("month", month).maybeSingle();
      if (usageError) return json({ error: "The commentary allowance couldn't be checked." });
      if ((used?.chars || 0) + chars > MONTHLY) return json({ error: "This team has used its commentary allowance for the month." });
      await db.from("voice_usage").upsert({ team_id: team.id, month, chars: (used?.chars || 0) + chars });
    }

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
    if (style !== "plain") { try { bearer = await googleToken(); } catch (e) { refused(String((e as Error)?.message || e)); } }
    // Google only lets a project ask for the commentator voice a few times a minute: one line at a time, and when it says
    // slow down, wait and ask again (within about a minute and a half overall; anything left after that is read straight).
    const pause = Number(Deno.env.get("VOICE_RETRY_MS") || 5000), until = Date.now() + 90000;
    const performed = async (text: string) => {
      for (let tries = 0; ; tries++) {
        let said = "";
        const got = await speak({ input: { text, prompt: style === "sweary" ? SWEARY : HYPE }, voice: { languageCode: "en-GB", name: voice, model_name: "gemini-2.5-flash-tts" }, audioConfig: { audioEncoding: "MP3" } }, (m) => { said = m; refused(m); }, bearer);
        if (got) return got;
        const wait = pause * (tries + 1);
        if (!/quota|rate.?limit|resource.?exhausted/i.test(said) || tries >= 3 || Date.now() + wait > until) return null;
        await new Promise((done) => setTimeout(done, wait));
      }
    };
    let engine = "chirp";
    let audio: (string | null)[] = [];
    if (style !== "plain" && !(hypeProblem && !bearer)) { // (not if signing in as the service account has just failed)
      // try the first line as a performance; only carry on that way if it works
      const firstAt = lines.findIndex(Boolean);
      const first = await performed(lines[firstAt]);
      if (first) {
        engine = "gemini";
        for (let i = 0; i < lines.length; i++) audio.push(!lines[i] ? null : i === firstAt ? first : await performed(lines[i]));
        audio = await Promise.all(audio.map((a, i) => a || !lines[i] ? a : straight(lines[i]))); // any that failed are read straight
      }
    }
    if (engine === "chirp") audio = await Promise.all(lines.map((text) => text ? straight(text) : null));
    if (!audio.some(Boolean)) return json({ error: problem || hypeProblem || "The voice service gave nothing back." });
    if (sample) { // kept only if it came out as it will sound in a reel (a straight read standing in for a performance isn't)
      if (engine !== "gemini" && style !== "plain") return json({ error: "The sample couldn't be made just now: " + reason(hypeProblem || problem || "no reason given") });
      const mp3 = Uint8Array.from(atob(audio[0]!), (c) => c.charCodeAt(0));
      const { error: upError } = await db.storage.from("voice-samples").upload(file, mp3, { contentType: "audio/mpeg", upsert: true });
      if (upError) return json({ error: "The sample was made but couldn't be kept. Try again." });
      return json({ url: sampleUrl, made: true });
    }
    return json({ audio, chars, voice, engine, note: engine === "chirp" && hypeProblem ? reason(hypeProblem) : undefined });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
