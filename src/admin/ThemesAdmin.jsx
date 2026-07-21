import { useMemo, useState } from "react";
import { useThemes } from "../lib/hooks.js";
import { importThemes, setThemeActive, updateThemeSchedule, deleteTheme } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// The exact prompt the shopkeeper copies into ChatGPT/Gemini. It fully
// describes the theme JSON so whatever the AI returns pastes straight in.
const THEME_PROMPT = `You are designing a festival "theme" (a full colour skin) for the customer app of "NGS – Nisha General Store", a local grocery delivery shop in Sultanpur, New Delhi.

I will tell you a festival or occasion (e.g. Independence Day, Dussehra, Diwali, Dhanteras, Holi, Raksha Bandhan, New Year). Design a beautiful, tasteful theme that repaints the whole app in that festival's spirit.

Return ONLY a JSON object (no explanation, no markdown) with EXACTLY these keys:
{
  "name": "<festival name, e.g. Diwali>",
  "emoji": "<one emoji that represents it, e.g. 🪔>",
  "startsOn": "<YYYY-MM-DD the theme should switch ON — the day it starts>",
  "endsOn": "<YYYY-MM-DD the theme should switch OFF — usually the festival day or a day after>",
  "greeting": "<a short warm greeting shown at the top, Hinglish is welcome, e.g. Shubh Deepavali 🪔>",
  "banner": {
    "kicker": "<2–3 word tag, e.g. Happy Diwali>",
    "title": "<one short festive line, e.g. Festival of lights, delivered ✨>",
    "subtitle": "<one supporting line about fresh groceries for the celebration>"
  },
  "decoration": "<ONE of: diyas, lanterns, flags, tricolor, confetti, crackers, fireworks, petals, flowers, marigold, rangoli, sparkles, snow, leaves, coins, bow, none>",
  "colors": {
    "primary":     "<main brand colour — used on the header and buttons; must be rich & saturated with WHITE text clearly readable on it>",
    "primaryDark": "<a darker shade of primary for pressed/gradient>",
    "accent":      "<a bright highlight colour, e.g. festive gold>",
    "accentDeep":  "<a deeper shade of accent>",
    "tint":        "<a very light tint of the theme for soft backgrounds>",
    "bg":          "<a very light, near-white page background with a warm festival hint>",
    "headerFrom":  "<gradient start for the greeting ribbon — usually = primary>",
    "headerTo":    "<gradient end for the greeting ribbon — usually = primaryDark or a warm second colour>"
  }
}

Rules:
- All colours are #RRGGBB hex. primary MUST have white text readable on it (dark/saturated), never a pale colour.
- Pick a decoration that truly fits (Diwali → diyas; Independence/Republic Day → tricolor; Dussehra → bow; Dhanteras → coins; Holi → petals; New Year → confetti; winter → snow).
- Use the CORRECT date for the festival's NEXT occurrence.
- Independence Day = 15 Aug, Republic Day = 26 Jan, Gandhi Jayanti = 2 Oct (fixed every year). Diwali, Dhanteras, Dussehra, Holi, Raksha Bandhan shift each year — use this year's real date.
- Keep it elegant and premium, not garish.

The festival is: `;

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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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
    try { navigator.clipboard.writeText(THEME_PROMPT); setMsg("AI prompt copied — paste it into ChatGPT/Gemini, add the festival name, then paste the JSON back below."); }
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
          <button className="an-btn ghost" onClick={copyPrompt}>Copy AI prompt</button>
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
          </div>
        ))}
      </div>
    </section>
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
  return (
    <div className="theme-prev" style={{ background: c.bg || "#f4f6f9" }}>
      <div className="theme-prev-note">{note}: <strong>{t.emoji} {t.name || "Theme"}</strong></div>
      <div className="theme-prev-header" style={{ background: `linear-gradient(100deg, ${c.headerFrom || primary}, ${c.headerTo || c.primaryDark || primary})` }}>
        <span>{t.greeting || b.kicker || "Festive greeting"}</span>
      </div>
      <div className="theme-prev-body">
        <div className="theme-prev-title">{b.title || "Festive line"}</div>
        <div className="theme-prev-sub">{b.subtitle || ""}</div>
        <button className="theme-prev-btn" style={{ background: primary }}>Add to cart</button>
        <span className="theme-prev-chip" style={{ background: c.tint || "#e7f6ee", color: c.accentDeep || c.primaryDark || primary }}>₹49</span>
      </div>
    </div>
  );
}
