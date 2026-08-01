import { useMemo, useState } from "react";
import { useThemes, useSettings } from "../lib/hooks.js";
import { importThemes, setThemeActive, updateThemeSchedule, deleteTheme, setThemeBanner } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// The exact prompt the shopkeeper copies into ChatGPT/Gemini. A full design
// brief (persona + schema + rules + a worked example) so the AI returns a
// premium, cohesive theme that pastes straight in. Today's date is injected so
// the AI schedules the NEXT occurrence correctly.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const THEME_PROMPT_FALLBACK = `ROLE
You are a senior brand designer creating a limited-time festival skin for the customer app of "NGS - Nisha General Store", a neighbourhood grocery-delivery shop in Sultanpur, New Delhi. Match the polish of a top app's festival campaign: cohesive, premium and culturally authentic — never gaudy or clip-arty. Every occasion must come out looking genuinely different from every other.

FIRST, ask me one question: which festival or special day is this theme for? Then wait for my answer. Do not assume an occasion or return any JSON until I tell you which one. Once I answer, design the complete theme yourself — every colour and every word is your call — and return it as ONE JSON object.

WHAT THE APP DOES WITH YOUR THEME
- Your "palette" (exactly 3 signature colours of the occasion) plus "primary"/"accent" re-skin the WHOLE app: the header and search bar turn these colours, along with the buttons, cart bar, price chips and section accents. White text sits on "primary", so it must be deep enough.
- "greeting", "kicker", "title" and "subtitle" are the words shown to the customer.
- "pattern" scatters a faint motif through the background of every page.
- "decoration" and "motif" style the fallback poster — used only when a festival has no custom banner animation.

RETURN ONLY THIS JSON OBJECT (no markdown, no code fence, no commentary):
{
  "name": "the occasion's name",
  "emoji": "one emoji that represents it",
  "startsOn": "YYYY-MM-DD — switch the theme ON a few days before",
  "endsOn": "YYYY-MM-DD — switch it OFF on or just after the day",
  "greeting": "the big wish on the poster — a warm, sincere wish or blessing to the customer, in polished English; up to one emoji at the end",
  "banner": {
    "kicker": "the occasion's own authentic greeting, kept as-is",
    "title": "a short sign-off line from the NGS family; vary the wording every time",
    "subtitle": "one graceful closing line of goodwill; no groceries, no prices"
  },
  "decoration": "garland style — choose ONE supported value that genuinely suits THIS occasion, or none: marigold | flowers | petals | leaves | tricolor | flags | lanterns | diyas | coins | snow | none. Do NOT default to any one style.",
  "motif": "poster backdrop — choose ONE supported value that fits: mandala | rays | arch",
  "pattern": "faint app-wide background motif — choose ONE supported value that fits: splash | flags | diyas | coins | petals | sparkles",
  "colors": {
    "primary":     "#RRGGBB — deep and saturated; WHITE text must be clearly legible on it",
    "primaryDark": "#RRGGBB — a darker shade of primary",
    "accent":      "#RRGGBB — a bright festive highlight, a different colour from primary",
    "accentDeep":  "#RRGGBB — a deeper shade of accent",
    "tint":        "#RRGGBB — a very light wash for soft backgrounds",
    "bg":          "#RRGGBB — a near-white page canvas with a faint festival hint",
    "headerFrom":  "#RRGGBB — header gradient start (usually = primary)",
    "headerTo":    "#RRGGBB — header gradient end (= primaryDark or a second colour)",
    "palette":     ["#RRGGBB", "#RRGGBB", "#RRGGBB — EXACTLY 3 signature colours of THIS occasion, in order"]
  }
}

THE COLOURS ARE YOUR CALL
- I am giving you NO colours. Choose every hex yourself, authentically from the occasion — its flowers, flags, sweets, lamps, fabrics and mood. Two occasions must never look the same; never fall back to a generic red/gold.
- One deep anchor plus companions — tasteful and premium; no neon, no muddy greys.
- White text must read clearly on "primary", "primaryDark", "headerFrom" and "headerTo", so none of those may be pale.
- Only "bg" and "tint" are pale.

COPY — the poster is a GREETING CARD, not an ad
- It WISHES the customer on the occasion, signed off from the NGS family. It does NOT sell or mention groceries, delivery or prices. Professional, elegant, warm; English-led.
- Every line must be specific to THIS occasion's meaning — if a line could fit any festival, rewrite it. At most one exclamation mark.
- BAN clichés: "Celebrate the spirit of…", "Experience the joy of…", "spread the joy/cheer", "Tis the season", "make this <occasion> special".

DATES (today is ${TODAY_ISO})
Schedule the NEXT upcoming occurrence; use the correct date for the upcoming year and give your best estimate if unsure (I can fine-tune it in the app).

Begin now by asking me which festival or special day you're designing for. Once I answer, return only the JSON.
`;

// ── The banner-animation prompt ─────────────────────────────────────────────
// This is the owner's over-the-air workflow: paste this into ChatGPT/Gemini,
// name the festival, and it returns ONE self-contained HTML page — a bespoke
// animated scene. Paste that into a theme's "Banner animation" box below and it
// goes live on every customer's home with NO app update (it renders inside a
// sealed sandbox iframe, so the code is isolated from the app and the network).
const BANNER_PROMPT_FALLBACK = `ROLE
You are a motion designer + creative coder building a premium, animated festival banner for the home screen of "NGS - Nisha General Store", a neighbourhood grocery-delivery app in Sultanpur, New Delhi. Aim for the craft of a Blinkit / Zepto festival takeover: a real illustrated SCENE that moves, not a flat card with an emoji. Every festival must look genuinely different.

FIRST, ask me one question: which festival or special day do you want the banner for? Then wait for my answer. Do not assume an occasion or produce any code until I tell you which one.

OUTPUT — once I've named the occasion, return ONLY the HTML (no markdown, no code fence, no commentary). It MUST be a single file that runs on its own:
- One <canvas> that fills the banner; do ALL the artwork on the canvas with hand-written JavaScript (gradients, shapes, particles). NO external images, fonts, scripts, stylesheets, network requests, <img>, fetch, or CDN links — nothing loads from outside the file. It runs in a sealed sandbox with no internet, so anything external will simply fail to appear.
- Inline <style> and inline <script> only. Plain JavaScript (no imports, no frameworks).
- The banner area is about 360-420px wide and EXACTLY 190px tall. Size the canvas to its container (read clientWidth/clientHeight, honour devicePixelRatio up to 2) and redraw on resize. Do not assume a fixed width.

THE SCENE — it's yours to imagine
- Build a real, animated scene that is unmistakably the occasion I name: its own imagery, its own signature colours, its own mood. Two different occasions must never come out looking alike. The creative direction is entirely yours — surprise me, and put real effort into the illustration.
- Real motion: things drift, flicker, sway, unfurl, twinkle, fall or rise — a continuous, smooth requestAnimationFrame loop. Tasteful and calm, never a flashing strobe.
- A short text overlay on one side (positioned with CSS over the canvas): a small spaced uppercase kicker (the occasion's name), a large serif greeting line, and one short line of goodwill. Let the words fade/slide in once over the first ~1 second. Keep the text clear of the busiest part of the scene.
- Use the occasion's authentic signature colours, baked into the code as hex constants. White or light text with a soft shadow so it reads over the art.

QUALITY BAR
- Looks hand-crafted and premium; nothing clip-arty; NO emoji anywhere in the artwork.
- Runs smoothly on a mid-range Android phone (keep particle counts sensible, a few dozen, not thousands).
- Accessibility: if window.matchMedia('(prefers-reduced-motion: reduce)') matches, render ONE calm static frame (no looping animation).
- Degrade safely: wrap the script so a stray error can't blank the banner.
- Self-contained and idempotent: it may be injected more than once on a page, so don't rely on globals leaking; keep everything inside one IIFE.

Begin now by asking me which festival or special day you're designing for.
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
