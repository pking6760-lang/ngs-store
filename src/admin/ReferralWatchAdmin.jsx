import { useEffect, useMemo, useState } from "react";
import * as api from "../lib/api.js";

// Referral watch — spot one device or connection farming the ₹30 welcome bonus,
// and reverse a bonus that was claimed fraudulently.
export default function ReferralWatchAdmin() {
  const [rows, setRows] = useState(null); // null = loading
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = () => {
    setErr("");
    api.adminReferralWatch()
      .then(setRows)
      .catch((e) => { setErr(e.message || "Couldn't load."); setRows([]); });
  };
  useEffect(() => { load(); }, []);

  const { flagged, clean } = useMemo(() => {
    const list = rows || [];
    const isFlagged = (r) => r.deviceCount > 1 || r.ipCount > 1;
    return {
      flagged: list.filter(isFlagged),
      clean: list.filter((r) => !isFlagged(r)),
    };
  }, [rows]);

  async function clawback(r) {
    const reason = window.prompt(
      `Reverse the ₹${r.reward} referral bonus for ${r.name || r.code || "this customer"}?\n\n` +
      `This takes the credit back from them${r.status === "rewarded" ? " and from the person who referred them" : ""}. ` +
      `Optionally note a reason:`,
      "Multiple accounts on one device",
    );
    if (reason === null) return; // cancelled
    setBusyId(r.refereeId); setErr("");
    try {
      await api.adminReferralClawback(r.refereeId, reason);
      load();
    } catch (e) {
      setErr(e.message || "Couldn't reverse that referral.");
    } finally {
      setBusyId("");
    }
  }

  if (rows === null) return <div className="refwatch-empty">Loading…</div>;

  return (
    <div className="refwatch">
      <p className="refwatch-intro">
        Each row is a customer who claimed a referral bonus. A <b>flagged</b> row means the
        same <b>device</b> or <b>internet connection (IP)</b> was used for more than one claim —
        a sign of farming. A device match is a strong signal (a VPN or incognito can't change
        it); an IP match can be innocent (one home, a hostel, office Wi-Fi) so review before reversing.
      </p>

      {err && <div className="refwatch-err">{err}</div>}

      <div className="refwatch-stats">
        <span><b>{(rows || []).length}</b> claims</span>
        <span className={flagged.length ? "hot" : ""}><b>{flagged.length}</b> flagged</span>
      </div>

      {flagged.length > 0 && (
        <>
          <h3 className="refwatch-h">Needs review</h3>
          <div className="refwatch-list">
            {flagged.map((r) => (
              <ClaimRow key={r.refereeId} r={r} busy={busyId === r.refereeId} onClawback={() => clawback(r)} />
            ))}
          </div>
        </>
      )}

      <h3 className="refwatch-h">{flagged.length > 0 ? "Everyone else" : "All claims"}</h3>
      {clean.length === 0 ? (
        <div className="refwatch-empty">No referral claims yet.</div>
      ) : (
        <div className="refwatch-list">
          {clean.map((r) => (
            <ClaimRow key={r.refereeId} r={r} busy={busyId === r.refereeId} onClawback={() => clawback(r)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ClaimRow({ r, busy, onClawback }) {
  const flagged = r.deviceCount > 1 || r.ipCount > 1;
  const clawed = r.status === "clawed";
  const when = r.createdAt ? new Date(r.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "";
  return (
    <div className={`refwatch-row ${flagged ? "flag" : ""} ${clawed ? "clawed" : ""}`}>
      <div className="refwatch-main">
        <div className="refwatch-who">
          <b>{r.name || "Customer"}</b>
          {r.code && <span className="refwatch-code">{r.code}</span>}
          {clawed && <span className="refwatch-badge clawed">Reversed</span>}
          {!clawed && r.status === "rewarded" && <span className="refwatch-badge paid">Referrer paid</span>}
          {!clawed && r.status === "linked" && <span className="refwatch-badge">Bonus given</span>}
        </div>
        {r.email && <div className="refwatch-sub">{r.email}</div>}
        <div className="refwatch-sub">
          {r.referrerName || r.referrerCode
            ? <>Referred by {r.referrerName || r.referrerCode}{r.referrerCode ? ` (${r.referrerCode})` : ""}</>
            : "No referrer on file"} · {when}
        </div>
        <div className="refwatch-signals">
          <span className={r.deviceCount > 1 ? "sig hot" : "sig"}>
            {r.deviceCount > 1 ? `⚠ ${r.deviceCount} accounts · same device` : "1 device"}
          </span>
          {r.ip && (
            <span className={r.ipCount > 1 ? "sig warn" : "sig"}>
              {r.ipCount > 1 ? `${r.ipCount} accounts · same IP` : "IP ok"}
            </span>
          )}
        </div>
      </div>
      <div className="refwatch-actions">
        <span className="refwatch-amt">₹{r.reward}</span>
        {clawed ? (
          <span className="refwatch-done">Reversed</span>
        ) : (
          <button className="refwatch-claw" onClick={onClawback} disabled={busy}>
            {busy ? "…" : "Reverse bonus"}
          </button>
        )}
      </div>
    </div>
  );
}
