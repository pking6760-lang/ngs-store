// Supabase Edge Function: soundbox-tts
// Returns a spoken-audio (MP3) announcement for an amount, so the soundbox device
// can play any value in English or Hindi without storing audio clips. The device
// calls: /soundbox-tts?key=...&amt=250&lang=hi  and streams the MP3 straight to
// its speaker. The voice is generated on the fly (Google Translate TTS proxy).
//
// Secrets: SOUNDBOX_KEY.
const SOUNDBOX_KEY = Deno.env.get("SOUNDBOX_KEY") ?? "";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || "";
  if (!SOUNDBOX_KEY || key !== SOUNDBOX_KEY) return new Response("unauthorized", { status: 401 });

  const lang = (url.searchParams.get("lang") || "en").startsWith("hi") ? "hi" : "en";
  const say = url.searchParams.get("say") || "";
  let text: string;
  if (say === "ready") {
    text = lang === "hi" ? "साउंडबॉक्स तैयार है" : "Soundbox is ready";
  } else {
    const amt = Math.round(Number(url.searchParams.get("amt") || "0"));
    if (!(amt >= 0)) return new Response("bad amount", { status: 400 });
    text = lang === "hi" ? `पेमेंट प्राप्त हुआ, ${amt} रुपये` : `Payment received, ${amt} rupees`;
  }

  const g = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
  try {
    const r = await fetch(g, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Referer": "https://translate.google.com/",
        "Accept": "audio/mpeg, */*",
      },
    });
    if (!r.ok) return new Response("tts upstream failed", { status: 502 });
    const buf = await r.arrayBuffer();
    return new Response(buf, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "content-length": String(buf.byteLength) },
    });
  } catch (e) {
    return new Response("tts error: " + (e as Error).message, { status: 502 });
  }
});
