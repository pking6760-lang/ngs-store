// Supabase Edge Function: soundbox-tts
// Audio for the payment soundbox. Three things it can return:
//   ?say=chime            -> the short "ting" chime (played before the voice)
//   ?say=ready            -> "Soundbox is ready" (spoken on boot)
//   ?amt=250&lang=hi      -> "पेमेंट प्राप्त हुआ, 250 रुपये" (spoken)
//
// The spoken voice uses Microsoft Azure Neural TTS when AZURE_SPEECH_KEY +
// AZURE_SPEECH_REGION are set (natural, human-like), and falls back to a free
// Google voice until then. All 24kHz mono MP3 so the chime and voice match.
//
// Secrets: SOUNDBOX_KEY, AZURE_SPEECH_KEY (optional), AZURE_SPEECH_REGION (optional).
const SOUNDBOX_KEY = Deno.env.get("SOUNDBOX_KEY") ?? "";
const AZ_KEY = Deno.env.get("AZURE_SPEECH_KEY") ?? "";
const AZ_REGION = Deno.env.get("AZURE_SPEECH_REGION") ?? "";
// Natural Indian neural voices (override per request with ?voice=).
const AZ_VOICE = { hi: "hi-IN-SwaraNeural", en: "en-IN-NeerjaNeural" } as Record<string, string>;

// The chime, embedded so it serves instantly with no dependency.
const CHIME_B64 = "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";
const CHIME = Uint8Array.from(atob(CHIME_B64), (c) => c.charCodeAt(0));

const mp3 = (buf: ArrayBuffer | Uint8Array) =>
  new Response(buf, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });

async function azureTts(text: string, lang: string, voice: string): Promise<ArrayBuffer | null> {
  if (!AZ_KEY || !AZ_REGION) return null;
  const locale = lang === "hi" ? "hi-IN" : "en-IN";
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'>${text}</voice></speak>`;
  try {
    const r = await fetch(`https://${AZ_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": AZ_KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "ngs-soundbox",
      },
      body: ssml,
    });
    if (!r.ok) return null;
    return await r.arrayBuffer();
  } catch { return null; }
}

async function googleTts(text: string, lang: string): Promise<ArrayBuffer | null> {
  const g = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
  try {
    const r = await fetch(g, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Referer": "https://translate.google.com/",
      },
    });
    if (!r.ok) return null;
    return await r.arrayBuffer();
  } catch { return null; }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (!SOUNDBOX_KEY || url.searchParams.get("key") !== SOUNDBOX_KEY) return new Response("unauthorized", { status: 401 });

  const say = url.searchParams.get("say") || "";
  if (say === "chime") return mp3(CHIME);

  const lang = (url.searchParams.get("lang") || "en").startsWith("hi") ? "hi" : "en";
  let text: string;
  if (say === "ready") {
    text = lang === "hi" ? "साउंडबॉक्स तैयार है" : "Soundbox is ready";
  } else {
    const amt = Math.round(Number(url.searchParams.get("amt") || "0"));
    if (!(amt >= 0)) return new Response("bad amount", { status: 400 });
    if (lang === "hi") {
      const unit = amt === 1 ? "रुपया" : "रुपये";
      const verb = amt === 1 ? "प्राप्त हुआ" : "प्राप्त हुए";
      text = `${amt} ${unit} ${verb}।`;
    } else {
      const unit = amt === 1 ? "rupee" : "rupees";
      text = `${amt} ${unit} received.`;
    }
  }

  const voice = url.searchParams.get("voice") || AZ_VOICE[lang];
  const audio = (await azureTts(text, lang, voice)) || (await googleTts(text, lang));
  if (!audio) return new Response("tts failed", { status: 502 });
  return mp3(audio);
});
