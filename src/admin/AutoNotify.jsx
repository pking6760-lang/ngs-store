import { useEffect, useMemo, useState } from "react";
import {
  fetchNotifTemplates, addNotifTemplate, setNotifTemplateActive, deleteNotifTemplate,
  importNotifTemplates, sendBucketNow, fetchNotifCampaigns, updateNotifCampaign,
} from "../lib/api.js";
import { Ic } from "./AdminIcons.jsx";

// Buckets the admin can tag messages with (friendly label → key).
const BUCKETS = [
  ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"], ["night", "Night"],
  ["early_morning", "Early morning"], ["late_night", "Late night"], ["lunch", "Lunch"], ["dinner", "Dinner"],
  ["sunday", "Sunday"], ["saturday", "Saturday"],
  ["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"],
  ["new_year", "New Year"], ["holi", "Holi"], ["diwali", "Diwali"], ["dhanteras", "Dhanteras"],
  ["dussehra", "Dussehra"], ["govardhan", "Govardhan Puja"], ["bhai_dooj", "Bhai Dooj"],
  ["chhath", "Chhath Puja"], ["rakhi", "Raksha Bandhan"], ["janmashtami", "Janmashtami"],
  ["birthday", "Birthday"], ["anniversary", "Anniversary"], ["wedding", "Wedding"],
  ["party", "Party"], ["gift", "Gift"], ["sad", "Win-back / miss you"],
];
const LABEL = Object.fromEntries(BUCKETS);
const bucketLabel = (b) => LABEL[b] || b;

const AI_PROMPT = `You are writing push notifications for "NGS – Nisha General Store", a local grocery delivery shop in Sultanpur, New Delhi.
Generate 60 short, engaging notifications in Hindi–English mix (Hinglish). Each: a punchy TITLE with exactly one emoji, and a 1-line BODY (max ~90 characters) that nudges the customer to order groceries. Warm, friendly, local, non-repetitive. No prices, no fake discounts.
Return ONLY a JSON array of objects: {"bucket":"<category>","title":"<title>","body":"<body>"}.
Use these categories (bucket), a few messages each: morning, afternoon, evening, night, sunday, saturday, diwali, holi, dhanteras, dussehra, new_year, rakhi, chhath, birthday, sad, party, gift.`;

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => { const ap = h < 12 ? "AM" : "PM"; let hh = h % 12; if (hh === 0) hh = 12; return `${hh}:00 ${ap}`; };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AutoNotify() {
  const [tab, setTab] = useState("bank"); // 'bank' | 'schedule'
  const [templates, setTemplates] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function reload() {
    try {
      const [t, c] = await Promise.all([fetchNotifTemplates(), fetchNotifCampaigns()]);
      setTemplates(t); setCampaigns(c);
    } catch (e) { setMsg(e.message || "Couldn't load."); }
  }
  useEffect(() => { reload(); }, []);

  return (
    <section className="panel">
      <h3>Auto notifications</h3>
      <p className="panel-sub">A bank of ready messages that send themselves at the right time — mornings, festivals, weekends and more.</p>

      <div className="seg-toggle" role="tablist">
        <button className={`seg ${tab === "bank" ? "seg-on" : ""}`} onClick={() => setTab("bank")}>Message bank</button>
        <button className={`seg ${tab === "schedule" ? "seg-on" : ""}`} onClick={() => setTab("schedule")}>Schedule</button>
      </div>

      {msg && <p className="an-msg">{msg}</p>}

      {tab === "bank"
        ? <Bank templates={templates} busy={busy} setBusy={setBusy} setMsg={setMsg} reload={reload} />
        : <Schedule campaigns={campaigns} templates={templates} setMsg={setMsg} reload={reload} />}
    </section>
  );
}

function Bank({ templates, busy, setBusy, setMsg, reload }) {
  const [bucket, setBucket] = useState("morning");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");

  const grouped = useMemo(() => {
    const g = {};
    templates.forEach((t) => { (g[t.bucket] = g[t.bucket] || []).push(t); });
    return g;
  }, [templates]);

  async function add() {
    if (!title.trim()) return;
    setBusy(true);
    try { await addNotifTemplate({ bucket, title: title.trim(), body: body.trim() }); setTitle(""); setBody(""); await reload(); setMsg("Message added."); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function doImport() {
    setBusy(true);
    try {
      const items = JSON.parse(importText);
      if (!Array.isArray(items)) throw new Error("Paste a JSON array.");
      const r = await importNotifTemplates(items);
      setImportText(""); setShowImport(false); await reload(); setMsg(`Imported ${r.count} messages.`);
    } catch (e) { setMsg(e.message || "Invalid JSON."); } finally { setBusy(false); }
  }
  async function toggle(t) { try { await setNotifTemplateActive(t.id, !t.active); await reload(); } catch (e) { setMsg(e.message); } }
  async function del(t) { try { await deleteNotifTemplate(t.id); await reload(); } catch (e) { setMsg(e.message); } }
  async function sendNow(b) {
    setBusy(true);
    try { const r = await sendBucketNow(b); setMsg(`Sent to ${r.count} customer(s).`); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  function copyPrompt() {
    try { navigator.clipboard.writeText(AI_PROMPT); setMsg("AI prompt copied — paste it into ChatGPT/Gemini, then paste the JSON back here via Bulk import."); }
    catch { setMsg("Couldn't copy — long-press to select the prompt."); }
  }

  return (
    <>
      <div className="an-add">
        <div className="an-row">
          <select className="an-select" value={bucket} onChange={(e) => setBucket(e.target.value)}>
            {BUCKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="an-input" placeholder="Title (e.g. Good morning ☀️)" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </div>
        <input className="an-input" placeholder="Message (short, Hinglish, engaging)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={140} />
        <div className="an-actions">
          <button className="an-btn ghost" onClick={copyPrompt}>Copy AI prompt</button>
          <button className="an-btn ghost" onClick={() => setShowImport((s) => !s)}>Bulk import</button>
          <button className="an-btn" disabled={busy || !title.trim()} onClick={add}>Add message</button>
        </div>
        {showImport && (
          <div className="an-import">
            <textarea className="an-textarea" rows={5} placeholder='Paste a JSON array: [{"bucket":"morning","title":"...","body":"..."}, ...]' value={importText} onChange={(e) => setImportText(e.target.value)} />
            <button className="an-btn" disabled={busy || !importText.trim()} onClick={doImport}>Import</button>
          </div>
        )}
      </div>

      <div className="an-list">
        {templates.length === 0 && <div className="an-empty">No messages yet. Add some above, or tap “Copy AI prompt” to generate a batch.</div>}
        {Object.keys(grouped).sort().map((b) => (
          <div className="an-group" key={b}>
            <div className="an-group-head">
              <span>{bucketLabel(b)} <em>· {grouped[b].length}</em></span>
              <button className="an-send" disabled={busy} onClick={() => sendNow(b)}><Ic name="broadcast" size={13} /> Send now</button>
            </div>
            {grouped[b].map((t) => (
              <div className={`an-item ${t.active ? "" : "off"}`} key={t.id}>
                <div className="an-item-txt"><strong>{t.title}</strong><span>{t.body}</span></div>
                <label className="an-switch"><input type="checkbox" checked={t.active} onChange={() => toggle(t)} /><span /></label>
                <button className="an-del" onClick={() => del(t)} aria-label="Delete"><Ic name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function Schedule({ campaigns, templates, setMsg, reload }) {
  const counts = useMemo(() => {
    const c = {}; templates.forEach((t) => { if (t.active) c[t.bucket] = (c[t.bucket] || 0) + 1; }); return c;
  }, [templates]);

  async function patch(id, p) { try { await updateNotifCampaign(id, p); await reload(); } catch (e) { setMsg(e.message); } }

  return (
    <div className="an-list">
      <p className="an-hint">Each campaign sends a random active message from its group at the set time. Festival dates change yearly — check & adjust them here.</p>
      {campaigns.map((c) => {
        const has = counts[c.bucket] || 0;
        return (
          <div className={`an-camp ${c.enabled ? "" : "off"}`} key={c.id}>
            <div className="an-camp-main">
              <strong>{c.label}</strong>
              <span className="an-camp-sub">
                {bucketLabel(c.bucket)} · {has} message{has === 1 ? "" : "s"}
                {has === 0 && <em className="an-warn"> · add messages!</em>}
              </span>
            </div>
            <div className="an-camp-when">
              <select className="an-mini" value={c.hour} onChange={(e) => patch(c.id, { hour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              {c.onDate != null ? (
                <input className="an-mini" type="date" value={c.onDate} onChange={(e) => patch(c.id, { onDate: e.target.value })} />
              ) : c.dow != null ? (
                <span className="an-tag">{DOW[c.dow]}</span>
              ) : (
                <span className="an-tag">Daily</span>
              )}
            </div>
            <label className="an-switch"><input type="checkbox" checked={c.enabled} onChange={() => patch(c.id, { enabled: !c.enabled })} /><span /></label>
          </div>
        );
      })}
    </div>
  );
}
