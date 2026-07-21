import { useMemo, useState } from "react";
import { useThemes } from "../lib/hooks.js";
import { importThemes, setThemeActive, updateThemeSchedule, deleteTheme } from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// The exact prompt the shopkeeper copies into ChatGPT/Gemini. A full design
// brief (persona + schema + rules + a worked example) so the AI returns a
// premium, cohesive theme that pastes straight in. Today's date is injected so
// the AI schedules the NEXT occurrence correctly.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const THEME_PROMPT = `ROLE
You are a senior brand & visual designer. Design a limited-time FESTIVAL THEME (a complete seasonal skin) for the customer app of "NGS - Nisha General Store", a neighbourhood grocery-delivery shop in Sultanpur, New Delhi. Aim for the quality of a top consumer app's festival campaign (think Zomato/Swiggy/Blinkit during Diwali): cohesive, premium, culturally authentic — never gaudy or clip-arty.

HOW THE THEME IS USED (design EXACTLY for this — the app renders all of it)
- "palette" is the heart of the theme. It drives, on EVERY screen: (a) a decorative garland hung across the top of home, (b) a thin colour band under the header, (c) the vertical accent bar on every section title, and (d) the blended background of the festive greeting hero. It also frames the hero. So "palette" MUST be the festival's real, recognisable signature colours, 3-5, in a pleasing order.
- "primary" colours the header, all buttons, the cart bar and price chips — WHITE text sits on it, so it MUST be deep/saturated (never pale).
- "accent" does double duty: it highlights savings/badges AND tints a faint sparkle texture watermark shown behind content on every page. So make "accent" a warm, clearly-festive colour that is DIFFERENT from "primary"; not too pale (it must read as a watermark) and not so dark it muddies.
- "tint" is the soft fill behind chips, section pills and light backgrounds. "bg" is the near-white page canvas.
- "decoration" ONLY chooses the garland style across the top: "tricolor" (or "flags") gives a triangular flag bunting — use it ONLY for flag days (Independence / Republic Day); "marigold" gives a hanging marigold flower garland — use it for EVERY other festival.
- "motif" chooses the ornamental backdrop drawn behind the greeting: "mandala" (rangoli ring), "rays" (sunburst) or "arch" (temple archway). Pick the one that fits — so different festivals get visibly different posters, not the same layout recoloured.
- greeting (the big line) and the banner kicker/title/subtitle are composed into an editorial poster: kicker (small, spaced, uppercase) → greeting → ornament → subtitle. Write them to read as a designed masthead.

OUTPUT
Return ONLY one valid minified-or-pretty JSON object — no markdown, no code fence, no commentary. Exactly these keys:
{
  "name": "<festival name>",
  "emoji": "<one representative emoji>",
  "startsOn": "<YYYY-MM-DD to switch the theme ON, a few days before the day>",
  "endsOn": "<YYYY-MM-DD to switch it OFF, usually the festival day or a day after>",
  "greeting": "<short warm greeting for the hero, Hinglish welcome, may end with 1 emoji>",
  "banner": {
    "kicker": "<2-3 word tag, e.g. Happy Diwali>",
    "title": "<one punchy festive line, tie the festival to fresh groceries>",
    "subtitle": "<one supporting line; friendly, local, no prices, no fake discounts>"
  },
  "decoration": "<garland style: 'tricolor' for flag days (Independence / Republic Day) renders flag bunting; 'marigold' for every other festival renders a marigold flower garland.>",
  "motif": "<ornamental backdrop behind the greeting poster — 'mandala' (a rangoli ring, good for most festivals), 'rays' (a sunburst, good for national / celebration days), or 'arch' (a temple archway, good for regal / religious festivals). Pick the one that best fits the festival's spirit.>",
  "colors": {
    "primary":     "<deep, saturated brand colour; WHITE text must be clearly legible on it>",
    "primaryDark": "<a darker shade of primary, for gradients/pressed states>",
    "accent":      "<a bright highlight colour, a DIFFERENT palette member than primary>",
    "accentDeep":  "<a deeper shade of accent>",
    "tint":        "<very light wash of the theme, for soft chip/section backgrounds>",
    "bg":          "<near-white page background with a faint warm festival hint>",
    "headerFrom":  "<hero gradient start, usually = primary>",
    "headerTo":    "<hero gradient end, usually = primaryDark or a warm second colour>",
    "palette":     ["<3 to 5 authentic signature colours of THIS festival, in order>"]
  }
}

DESIGN RULES
- Every colour is #RRGGBB hex. Colours must be HARMONIOUS together (one deep anchor + warm/festive companions), tasteful and premium — avoid neon, avoid muddy greys.
- CONTRAST: white text must be clearly readable on "primary", "primaryDark", "headerFrom" and "headerTo" — so none of those may be pale (no near-white, no pastel).
- "palette" is REQUIRED, 3-5 colours, ordered light-to-rich or by importance; it carries the festival's identity, so choose the colours people actually associate with it.
- "bg" and "tint" are the only pale colours; everything else is confident.
- Keep copy classy and specific to the festival + fresh groceries; never invent prices or discounts.

DATES
- Today is ${TODAY_ISO}. Schedule the NEXT upcoming occurrence relative to today.
- Fixed every year: Independence Day 15 Aug, Republic Day 26 Jan, Gandhi Jayanti 2 Oct, New Year 1 Jan.
- Lunar/variable (Diwali, Dhanteras, Dussehra, Holi, Raksha Bandhan, Navratri, Eid, Janmashtami…): use the correct real date for the upcoming year; if unsure, give your best estimate (the shopkeeper can fine-tune the dates in the app).

YOU CHOOSE THE COLOURS (this is the whole point)
- I am NOT giving you any colours. YOU decide every hex value yourself, authentically, from the festival itself — the colours people truly associate with it: its traditional flowers, flags, sweets, lights, fabrics, deities and overall mood. Two different festivals must never come out looking the same.
- Just obey the DESIGN RULES above for harmony, contrast and roles — the exact colours are entirely your call. Do not default to a generic red/gold unless that festival genuinely is red/gold.

FORMAT (shape only — the #... are placeholders; fill in YOUR colours, copy, emoji and dates for the actual festival):
{ "name": "...", "emoji": "...", "startsOn": "YYYY-MM-DD", "endsOn": "YYYY-MM-DD", "greeting": "...", "banner": { "kicker": "...", "title": "...", "subtitle": "..." }, "decoration": "marigold", "motif": "mandala", "colors": { "primary": "#...", "primaryDark": "#...", "accent": "#...", "accentDeep": "#...", "tint": "#...", "bg": "#...", "headerFrom": "#...", "headerTo": "#...", "palette": ["#...", "#...", "#..."] } }

Now design the complete theme — choosing all colours yourself — for this festival or occasion:
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
