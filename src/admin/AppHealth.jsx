import { useEffect, useState } from "react";
import { fetchAppHealth } from "../lib/api.js";

const DOT = { ok: "#12B886", warn: "#F59F00", fail: "#FA5252" };
const WORD = { ok: "All good", warn: "Needs a look", fail: "Problem" };

export default function AppHealth() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setBusy(true); setErr("");
    try { setData(await fetchAppHealth()); }
    catch (e) { setErr(e.message || "Couldn't load health."); }
    finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);

  const overall = data?.overall || "ok";
  return (
    <section className="panel">
      <h3>App health</h3>
      <p className="panel-sub">A quick check that the app stays fast — especially that product photos live in Storage, not the database. It also checks itself once a day and alerts you here if something goes wrong.</p>

      <div className={`ah-overall ah-${overall}`}>
        <span className="ah-dot" style={{ background: DOT[overall] }} />
        <strong>{busy ? "Checking…" : WORD[overall]}</strong>
        <button className="an-btn ghost ah-refresh" disabled={busy} onClick={load}>Refresh</button>
      </div>

      {err && <p className="an-msg">{err}</p>}

      <div className="ah-list">
        {(data?.checks || []).map((c) => (
          <div className="ah-item" key={c.key}>
            <span className="ah-dot" style={{ background: DOT[c.status] || "#adb5bd" }} />
            <div className="ah-item-txt">
              <strong>{c.label}</strong>
              <span>{c.hint}</span>
            </div>
            <div className={`ah-val ah-${c.status}`}>
              {c.value}{c.unit ? ` ${c.unit}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
