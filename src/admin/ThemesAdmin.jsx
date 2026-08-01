import { useMemo, useState } from "react";
import { useThemes, useSettings } from "../lib/hooks.js";
import { importThemes, setThemeActive, updateThemeSchedule, deleteTheme, setThemeBanner, setThemeBackground } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// Built-in fallback for the festival-theme prompt. The live version is editable
// from the database (settings.prompts.theme) and takes precedence — this ships
// only so the button still works before any DB override is set. Example-free by
// design: the AI is given the schema and rules, and invents every colour and
// word itself so no two festivals come out looking alike.
const THEME_PROMPT_FALLBACK = `ROLE
You are a senior brand designer creating a limited-time festival skin for the customer app of "NGS — Nisha General Store", a neighbourhood grocery-delivery shop in Sultanpur, New Delhi. Match the polish of a top app's festival campaign: cohesive, premium and culturally authentic. Every occasion must look genuinely different from every other; nothing may feel like a recoloured template.

FIRST, ask me one question: which festival or special day is this theme for? Then wait for my answer. Do not assume an occasion or return any JSON until I tell you. Once I answer, design the whole theme yourself — every colour and every word is entirely your decision.

WHAT THE THEME DOES (so your choices work in the real app)
Your colours re-skin the entire app for the occasion: the header and search bar, the buttons, the cart bar, the price chips and the section accents all take these colours, and the whole top of the home screen flows in them and fades into the page. Your words appear to the customer as a short festive greeting. So the theme must be legible — white text sits on the lead colour — and unmistakably this one occasion.

RETURN ONLY THIS JSON OBJECT — no markdown, no code fence, no commentary:
{
  "name": "the occasion's name",
  "emoji": "one emoji that represents it",
  "startsOn": "YYYY-MM-DD — a few days before the day",
  "endsOn": "YYYY-MM-DD — on or just after the day",
  "greeting": "the main wish shown to the customer — one warm, sincere sentence, specific to what THIS occasion means; polished English; at most one emoji at the very end",
  "banner": {
    "kicker": "the occasion's own authentic greeting phrase, in its own words",
    "title": "a short, warm sign-off from the NGS family, worded freshly",
    "subtitle": "one graceful closing line of goodwill; nothing about groceries, delivery or prices"
  },
  "colors": {
    "primary":     "#RRGGBB — the occasion's lead colour; deep and saturated so WHITE text is clearly legible on it",
    "primaryDark": "#RRGGBB — a darker shade of the primary",
    "accent":      "#RRGGBB — a second signature colour that lifts the primary and is clearly different from it",
    "accentDeep":  "#RRGGBB — a darker shade of the accent",
    "tint":        "#RRGGBB — a very light wash for soft backgrounds",
    "bg":          "#RRGGBB — a near-white page canvas carrying the faintest hint of the occasion",
    "headerFrom":  "#RRGGBB — the top of the header gradient (usually the primary)",
    "headerTo":    "#RRGGBB — the foot of the header gradient (the darker shade, or a second colour); the whole top of home flows in this colour",
    "palette":     ["#RRGGBB", "...", "... — the occasion's own signature colours in order, primary first. You decide how many belong; use exactly as many as the occasion genuinely has, no padding and no colour that doesn't belong."]
  }
}

THE COLOURS ARE ENTIRELY YOURS
- I give you no colours and no direction on which to choose. Decide every hex yourself, drawn only from what this occasion authentically is.
- Two occasions must never come out looking alike. Choose one confident anchor with colours that genuinely belong beside it — harmonious, tasteful and premium.
- White text must read clearly on primary, primaryDark, headerFrom and headerTo, so none of those may be pale. Only bg and tint are pale.

THE WORDS ARE A GREETING CARD, NOT AN AD
- Wish the customer on the occasion, warmly, signed off from the NGS family. Never sell, and never mention groceries, delivery, ordering or prices.
- Make every line specific to this occasion's own meaning; if a line could be pasted onto any other festival, rewrite it. At most one exclamation mark in the whole theme.
- Professional, elegant and warm; English-led.

DATES
Schedule the next upcoming occurrence of the occasion. Use the correct date for the coming year; if unsure, give your best estimate — I can fine-tune it in the app.

Begin now by asking which festival or special day you're designing for. Once I answer, return only the JSON.
`;

// ── The banner-animation prompt ─────────────────────────────────────────────
// This is the owner's over-the-air workflow: paste this into ChatGPT/Gemini,
// name the festival, and it returns ONE self-contained HTML page — a bespoke
// animated scene. Paste that into a theme's "Banner animation" box below and it
// goes live on every customer's home with NO app update (it renders inside a
// sealed sandbox iframe, so the code is isolated from the app and the network).
const BANNER_PROMPT_FALLBACK = `ROLE
You are a motion designer and creative coder building a premium, animated festival banner for the home screen of "NGS — Nisha General Store", a neighbourhood grocery-delivery app in Sultanpur, New Delhi. Aim for the craft of a top app's festival takeover: a real illustrated scene that moves, not a flat card. Every occasion must look genuinely different; nothing may feel like a recoloured template.

FIRST, ask me one question: which festival or special day do you want the banner for? Then wait for my answer. Do not assume an occasion or produce any code until I tell you.

WHAT TO RETURN
Once I've named the occasion, return ONLY the HTML — no markdown, no code fence, no commentary. It must be a single file that runs entirely on its own:
- Inline <style> and inline <script> only. Plain JavaScript, no imports, no frameworks.
- One <canvas> that fills the banner. Do ALL the artwork on the canvas by hand in JavaScript. Nothing may load from outside the file: no external images, fonts, scripts, stylesheets, network requests, <img>, fetch or CDN links. It runs in a sealed sandbox with no internet, so anything external simply will not appear.
- The banner is about 360–420px wide and EXACTLY 190px tall. Read the canvas container's clientWidth and clientHeight, honour devicePixelRatio up to 2, and redraw on resize. Never assume a fixed width.

CODE THAT WILL NOT BREAK — this is where banners fail, so follow it exactly
- Never use backtick template literals, and never use the dollar-brace placeholder syntax anywhere in the code. Build every string with single quotes and the + operator to join text and numbers together. Template literals get corrupted when this code is pasted and will silently leave the banner blank.
- Put the whole script inside one immediately-invoked function wrapped in a try/catch, so a single error can never blank the banner and nothing leaks to the global scope.
- Before you finish, read your own code back: confirm every bracket and parenthesis is matched, there are no backticks or dollar-brace placeholders left anywhere, and nothing external is referenced. The banner must never render blank.

THE SCENE — it is entirely yours to imagine
- Design a real, moving scene that is unmistakably the occasion I name. Its imagery, its colours, its motion and its mood are all your decision — I give you no direction. Put genuine effort into it and make it distinctly this occasion.
- Give it real, continuous motion on a smooth requestAnimationFrame loop, however the scene calls for it — calm and tasteful, never a flashing strobe.
- Place a little text over the canvas, clear of the busiest part of the art and easy to read (light text with a soft shadow): a short label naming the occasion, the greeting, and one short line of goodwill, appearing gently over the first second. The words are a warm greeting to the customer — never salesy, and never about groceries, delivery or prices.

QUALITY BAR
- Hand-crafted and premium; nothing clip-arty; no emoji anywhere in the artwork.
- Runs smoothly on a mid-range Android phone.
- If the device requests reduced motion (matchMedia for prefers-reduced-motion: reduce), draw one calm static frame instead of looping.

Begin now by asking which festival or special day you're designing for.
`;

// Built-in fallback for the ambient-background prompt (settings.prompts.background
// overrides it). Example-free: the AI decides the whole atmosphere itself.
const BACKGROUND_PROMPT_FALLBACK = `ROLE
You are a motion designer and creative coder making a subtle, ambient animated BACKGROUND for the whole customer app of "NGS — Nisha General Store", a neighbourhood grocery-delivery app in Sultanpur, New Delhi. This is not a banner — it is a gentle festive atmosphere that plays quietly behind the entire app while people shop. Every occasion must feel different; nothing may feel like a recoloured template.

FIRST, ask me one question: which festival or special day is this background for? Then wait for my answer. Do not assume an occasion or produce any code until I tell you.

WHAT TO RETURN
Once I've named the occasion, return ONLY the HTML — no markdown, no code fence, no commentary. It must be a single file that runs entirely on its own:
- Inline <style> and inline <script> only. Plain JavaScript, no imports, no frameworks.
- One <canvas> that fills the whole screen. Do ALL the artwork on the canvas by hand in JavaScript. Nothing may load from outside the file: no external images, fonts, scripts, stylesheets, network requests, <img>, fetch or CDN links. It runs in a sealed sandbox with no internet, so anything external simply will not appear.
- It fills the viewport and is responsive: read the canvas container's clientWidth and clientHeight, honour devicePixelRatio up to 2, and redraw on resize. Never assume a fixed size.

IT MUST STAY IN THE BACKGROUND — this is the most important rule
- The page background MUST be fully transparent. Set html and body to background: transparent, and never paint a filled backdrop over the whole canvas — the app's own screens show through, and you only add a light touch of motion on top. If you fill the screen with colour you will hide the entire app, which is a failure.
- Keep it faint and sparse: only a gentle, low-opacity touch of movement, a modest number of elements (a couple of dozen at most), drifting slowly. It must never compete with the app's text, buttons or product cards, and a shopper should barely notice it while still feeling the occasion.
- Calm and continuous on a smooth requestAnimationFrame loop; never a flashing strobe.

CODE THAT WILL NOT BREAK — follow exactly
- Never use backtick template literals, and never use the dollar-brace placeholder syntax anywhere. Build every string with single quotes and the + operator to join text and numbers together. Template literals get corrupted when this code is pasted and will silently break everything.
- Put the whole script inside one immediately-invoked function wrapped in a try/catch, so a single error can never break the page and nothing leaks to the global scope.
- Before you finish, read your own code back: confirm every bracket and parenthesis is matched, there are no backticks or dollar-brace placeholders left anywhere, nothing external is referenced, and the background is transparent.

THE ATMOSPHERE — it is entirely yours to imagine
- Decide what quietly drifts, floats, rises or twinkles for the occasion I name, and in which colours — its imagery, its colours, its motion and its mood are all your decision. I give you no direction. Make it unmistakably this one occasion, and unlike any other.
- No emoji anywhere. It must run smoothly on a mid-range Android phone.
- If the device requests reduced motion (matchMedia for prefers-reduced-motion: reduce), draw one calm static frame, or nothing at all.

Begin now by asking which festival or special day you're designing for.
`;

const DECOR_LABEL = {
  diyas: "🪔 Diyas", lanterns: "🏮 Lanterns", flags: "🇮🇳 Flags", tricolor: "🇮🇳 Tricolour",
  confetti: "🎉 Confetti", crackers: "🎆 Crackers", fireworks: "🎆 Fireworks", petals: "🌸 Petals",
  flowers: "🌸 Flowers", marigold: "🌼 Marigold", rangoli: "🪔 Rangoli", sparkles: "✨ Sparkles",
  snow: "❄️ Snow", leaves: "🍂 Leaves", coins: "🪙 Coins", bow: "🏹 Bow", none: "— None",
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dLabel = (d) => { const p = String(d || "").split("-"); return p.length === 3 ? `${Number(p[2])} ${MON[Number(p[1]) - 1] || ""}` : "—"; };
const todayISO = () => new Date().toISOString().slice(0, 10);

// Would get_active_theme() pick this one? (active + inside its date window)
function isLiveNow(t) {
  if (!t.active) return false;
  const today = todayISO();
  if (t.startsOn && today < t.startsOn) return false;
  if (t.endsOn && today > t.endsOn) return false;
  return true;
}

export default function ThemesAdmin() {
  const themes = useThemes();
  const settings = useSettings();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // The AI prompts are editable from the database (settings.prompts) so their
  // wording can be refined without shipping a new app — the built-in versions
  // below are only the fallback if none is stored.
  const themePrompt = settings?.prompts?.theme || THEME_PROMPT_FALLBACK;
  const bannerPrompt = settings?.prompts?.banner || BANNER_PROMPT_FALLBACK;
  const backgroundPrompt = settings?.prompts?.background || BACKGROUND_PROMPT_FALLBACK;

  // Live-parse the paste box so the admin sees the theme before importing.
  const preview = useMemo(() => {
    const raw = text.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const one = Array.isArray(parsed) ? parsed[0] : parsed;
      return one && typeof one === "object" ? { ...one, _count: Array.isArray(parsed) ? parsed.length : 1 } : null;
    } catch { return null; }
  }, [text]);

  // The theme currently painting the app (newest live one wins, mirroring the RPC).
  const liveId = useMemo(() => {
    const live = themes.filter(isLiveNow);
    live.sort((a, b) => (b.startsOn ? 1 : 0) - (a.startsOn ? 1 : 0));
    return live[0]?.id || null;
  }, [themes]);

  function copyPrompt() {
    try { navigator.clipboard.writeText(themePrompt); setMsg("Theme prompt copied — paste it into Gemini/ChatGPT. It will ask which festival, then return the JSON to paste back below."); }
    catch { setMsg("Couldn't copy — long-press to select the prompt."); }
  }
  function copyBannerPrompt() {
    try { navigator.clipboard.writeText(bannerPrompt); setMsg("Banner prompt copied — paste it into Gemini/ChatGPT. It will ask which festival, then return the HTML to paste into a theme's “Banner animation” box below. It goes live with no app update."); }
    catch { setMsg("Couldn't copy — long-press to select the prompt."); }
  }
  function copyBackgroundPrompt() {
    try { navigator.clipboard.writeText(backgroundPrompt); setMsg("Background prompt copied — paste it into Gemini/ChatGPT. It will ask which festival, then return the HTML to paste into a theme’s “Background animation” box below. Subtle, and live with no app update."); }
    catch { setMsg("Couldn’t copy — long-press to select the prompt."); }
  }

  async function doImport() {
    setBusy(true); setMsg("");
    try {
      const items = JSON.parse(text);
      const r = await importThemes(items);
      setText(""); setMsg(`Saved ${r.count} theme${r.count === 1 ? "" : "s"}. Turn one on below to go live.`);
    } catch (e) { setMsg(e.message?.includes("JSON") ? "That doesn't look like valid JSON — paste exactly what the AI returned." : (e.message || "Import failed.")); }
    finally { setBusy(false); }
  }
  async function saveBanner(t, html) { const r = await setThemeBanner(t.id, html); setMsg(r.hasBanner ? `Banner animation saved for ${t.name}. It's live now on the customer app — no app update needed.` : `Banner animation cleared for ${t.name}.`); return r; }
  async function saveBackground(t, html) { const r = await setThemeBackground(t.id, html); setMsg(r.hasBackground ? `Ambient background saved for ${t.name}. It’s live now — no app update.` : `Ambient background cleared for ${t.name}.`); return r; }
  async function toggle(t) { try { await setThemeActive(t.id, !t.active); } catch (e) { setMsg(e.message); } }
  async function schedule(t, patch) { try { await updateThemeSchedule(t.id, { startsOn: t.startsOn, endsOn: t.endsOn, ...patch }); } catch (e) { setMsg(e.message); } }
  async function del(t) { try { await deleteTheme(t.id); } catch (e) { setMsg(e.message); } }

  return (
    <section className="panel">
      <h3>Festival themes</h3>
      <p className="panel-sub">
        Re-skin the whole customer app (web &amp; APK) for Independence Day, Dussehra, Diwali, Dhanteras and more — colours, a festive greeting and falling decorations. Same idea as Auto-notifications: <strong>Copy AI prompt → paste it in ChatGPT/Gemini → paste the JSON back here.</strong> Set the dates and it switches on by itself on the day.
      </p>

      {msg && <p className="an-msg">{msg}</p>}

      <div className="an-add">
        <div className="an-actions">
          <button className="an-btn ghost" onClick={copyPrompt}>Copy theme prompt</button>
          <button className="an-btn ghost" onClick={copyBannerPrompt}>Copy banner prompt</button>
          <button className="an-btn ghost" onClick={copyBackgroundPrompt}>Copy background prompt</button>
        </div>
        <textarea
          className="an-textarea" rows={5}
          placeholder='Paste the theme JSON here — e.g. {"name":"Diwali","emoji":"🪔","startsOn":"2026-11-06","endsOn":"2026-11-08","decoration":"diyas","colors":{ ... }}'
          value={text} onChange={(e) => setText(e.target.value)}
        />

        {text.trim() && (
          preview
            ? <ThemePreview t={preview} note={preview._count > 1 ? `Preview of first of ${preview._count} themes` : "Preview"} />
            : <p className="an-warn" style={{ margin: "6px 2px" }}>⚠ Not valid JSON yet — paste exactly what the AI returned.</p>
        )}

        <div className="an-actions">
          <button className="an-btn" disabled={busy || !preview} onClick={doImport}>{busy ? "Saving…" : "Save theme"}</button>
        </div>
      </div>

      <div className="an-list">
        {themes.length === 0 && <div className="an-empty">No themes yet. Tap “Copy AI prompt”, generate one for the next festival, and paste it above.</div>}
        {themes.map((t) => (
          <div className={`theme-card ${t.active ? "" : "off"}`} key={t.id}>
            <ThemeSwatch colors={t.theme?.colors || {}} emoji={t.emoji} />
            <div className="theme-main">
              <div className="theme-name">
                {t.emoji} {t.name}
                {t.id === liveId && <span className="theme-live">● LIVE</span>}
                {t.active && t.id !== liveId && <span className="theme-scheduled">scheduled</span>}
              </div>
              <div className="theme-decor">{DECOR_LABEL[t.theme?.decoration] || t.theme?.decoration || "— None"}</div>
              <div className="theme-when">
                <label>On <input type="date" value={t.startsOn || ""} onChange={(e) => schedule(t, { startsOn: e.target.value })} /></label>
                <label>Off <input type="date" value={t.endsOn || ""} onChange={(e) => schedule(t, { endsOn: e.target.value })} /></label>
                {!t.startsOn && !t.endsOn && <span className="theme-hint">no dates · manual</span>}
              </div>
            </div>
            <div className="theme-controls">
              <label className="an-switch"><input type="checkbox" checked={t.active} onChange={() => toggle(t)} /><span /></label>
              <button className="an-del" onClick={() => del(t)} aria-label="Delete"><Ic name="trash" size={15} /></button>
            </div>
            <BannerEditor theme={t} onSave={(html) => saveBanner(t, html)} />
            <BackgroundEditor theme={t} onSave={(html) => saveBackground(t, html)} />
          </div>
        ))}
      </div>
    </section>
  );
}

// Per-theme over-the-air banner animation. Paste the HTML the banner prompt
// produced, preview it live in a sealed iframe (exactly how the customer app
// renders it), then save — it goes live instantly, no app update. Clearing it
// falls back to the bundled scene / composed poster.
function BannerEditor({ theme, onSave }) {
  const saved = theme.theme?.bannerHtml || "";
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirty = html.trim() !== saved.trim();
  const preview = html.trim();

  async function save(next) {
    setBusy(true); setErr("");
    try { await onSave(next); if (next === "") setHtml(""); }
    catch (e) { setErr(e.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="theme-banner">
      <button className="theme-banner-toggle" onClick={() => setOpen((v) => !v)}>
        <Ic name="broadcast" size={13} />
        {saved ? "Banner animation ✓ — edit" : "Add banner animation"}
        <span className="theme-banner-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="theme-banner-body">
          <p className="theme-banner-hint">
            Paste the HTML from <strong>“Copy banner prompt”</strong>. Preview shows exactly what customers see. Save and it’s live — no app update.
          </p>
          <textarea
            className="an-textarea" rows={4} spellCheck={false}
            placeholder="Paste the banner HTML here (starts with <!doctype html> …)"
            value={html} onChange={(e) => setHtml(e.target.value)}
          />
          {err && <p className="an-warn" style={{ margin: "4px 2px" }}>⚠ {err}</p>}
          {preview && (
            <div className="theme-banner-prev">
              <div className="theme-banner-prev-note">Live preview</div>
              <iframe title="Banner preview" srcDoc={preview} sandbox="allow-scripts" scrolling="no" />
            </div>
          )}
          <div className="an-actions">
            <button className="an-btn" disabled={busy || !dirty || !preview} onClick={() => save(html)}>{busy ? "Saving…" : "Save & go live"}</button>
            {saved && <button className="an-btn ghost" disabled={busy} onClick={() => save("")}>Remove banner</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// Per-theme over-the-air ambient background. Paste the HTML the background
// prompt produced; the preview shows it over a mock screen so you can confirm
// it stays subtle and see-through. Save and it plays behind the whole app.
function BackgroundEditor({ theme, onSave }) {
  const saved = theme.theme?.backgroundHtml || "";
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const dirty = html.trim() !== saved.trim();
  const preview = html.trim();

  async function save(next) {
    setBusy(true); setErr("");
    try { await onSave(next); if (next === "") setHtml(""); }
    catch (e) { setErr(e.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <div className="theme-banner">
      <button className="theme-banner-toggle" onClick={() => setOpen((v) => !v)}>
        <Ic name="broadcast" size={13} />
        {saved ? "Background animation ✓ — edit" : "Add background animation"}
        <span className="theme-banner-caret">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="theme-banner-body">
          <p className="theme-banner-hint">
            Paste the HTML from <strong>“Copy background prompt”</strong>. It plays gently behind the whole app. The preview sits over a mock screen so you can check it stays subtle and see-through. Save and it’s live — no app update.
          </p>
          <textarea
            className="an-textarea" rows={4} spellCheck={false}
            placeholder="Paste the background HTML here (starts with <!doctype html> …)"
            value={html} onChange={(e) => setHtml(e.target.value)}
          />
          {err && <p className="an-warn" style={{ margin: "4px 2px" }}>⚠ {err}</p>}
          {preview && (
            <div className="theme-bg-prev">
              <div className="theme-bg-prev-mock">
                <div className="theme-bg-prev-card">Amul Cow Milk · ₹31</div>
                <div className="theme-bg-prev-card">Frequently bought together</div>
              </div>
              <iframe title="Background preview" srcDoc={preview} sandbox="allow-scripts" scrolling="no" />
            </div>
          )}
          <div className="an-actions">
            <button className="an-btn" disabled={busy || !dirty || !preview} onClick={() => save(html)}>{busy ? "Saving…" : "Save & go live"}</button>
            {saved && <button className="an-btn ghost" disabled={busy} onClick={() => save("")}>Remove background</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// Small colour dots for a saved theme.
function ThemeSwatch({ colors, emoji }) {
  const c = colors || {};
  return (
    <div className="theme-swatch" style={{ background: c.bg || "#fff" }}>
      <span className="theme-swatch-badge" style={{ background: c.primary || "#0a9155" }}>{emoji || "✨"}</span>
      <span className="theme-dot" style={{ background: c.accent || "#f6c445" }} />
    </div>
  );
}

// A mini mock of the customer home so the shopkeeper sees the look before saving.
function ThemePreview({ t, note }) {
  const c = t.colors || {};
  const b = t.banner || {};
  const primary = c.primary || "#0a9155";
  // Every festival's palette (explicit, or flag stripe, or primary+accent).
  const raw = Array.isArray(c.palette) ? c.palette : Array.isArray(c.stripe) ? c.stripe : [];
  const pal = raw.filter(Boolean);
  const palette = pal.length >= 2 ? pal : [c.primary, c.accent, c.primaryDark].filter(Boolean);
  const multi = palette.length >= 2;
  const bandBg = multi ? `linear-gradient(90deg, ${palette.map((col, i) => `${col} ${(i / palette.length) * 100}% ${((i + 1) / palette.length) * 100}%`).join(", ")})` : null;
  const ribbonBg = multi ? `linear-gradient(100deg, ${palette.join(", ")})` : `linear-gradient(100deg, ${c.headerFrom || primary}, ${c.headerTo || c.primaryDark || primary})`;
  return (
    <div className="theme-prev" style={{ background: c.bg || "#f4f6f9" }}>
      <div className="theme-prev-note">{note}: <strong>{t.emoji} {t.name || "Theme"}</strong></div>
      {multi && <div style={{ height: 7, background: bandBg }} />}
      <div className="theme-prev-header" style={{ background: ribbonBg, position: "relative" }}>
        <span style={{ position: "relative", zIndex: 1, textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>{t.greeting || b.kicker || "Festive greeting"}</span>
        <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.30)" }} />
      </div>
      {multi && <div style={{ height: 7, background: bandBg }} />}
      <div className="theme-prev-body">
        <div className="theme-prev-title">{b.title || "Festive line"}</div>
        <div className="theme-prev-sub">{b.subtitle || ""}</div>
        <button className="theme-prev-btn" style={{ background: primary }}>Add to cart</button>
        <span className="theme-prev-chip" style={{ background: c.tint || "#e7f6ee", color: c.accentDeep || c.primaryDark || primary }}>₹49</span>
      </div>
    </div>
  );
}
