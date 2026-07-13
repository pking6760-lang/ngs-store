import { useEffect, useState } from "react";
import { usePartners } from "../lib/hooks.js";
import * as api from "../lib/api.js";
import { kycReport } from "../lib/kyc.js";
import { withMinTime } from "../lib/ux.js";
import { ActionOverlay } from "../components/Motion.jsx";
import { useBackGuard } from "../lib/useBackGuard.js";
import AdminPortal from "./AdminPortal.jsx";

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return iso; }
}

// One document photo. Loads a preview; tapping opens it full-screen INSIDE the
// app (never navigates away, so the backend address is never shown).
function DocView({ path, label, onOpen }) {
  const [url, setUrl] = useState(null);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let alive = true;
    if (path) api.partnerDocUrl(path).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [path]);
  if (!path) return null;
  async function open() {
    setOpening(true);
    try {
      const fresh = await api.partnerDocUrl(path);
      if (fresh) onOpen({ url: fresh, label });
    } finally { setOpening(false); }
  }
  return (
    <button type="button" className="pdoc" onClick={open}>
      {url ? <img src={url} alt={label} /> : <div className="pdoc-loading">{opening ? "…" : "📄"}</div>}
      <span>{label}</span>
    </button>
  );
}

// Full-screen in-app image viewer.
function DocViewer({ doc, onClose }) {
  if (!doc) return null;
  return (
    <AdminPortal>
      <div className="doc-viewer" onClick={onClose}>
        <div className="doc-viewer-bar">
          <span>{doc.label}</span>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <img src={doc.url} alt={doc.label} onClick={(e) => e.stopPropagation()} />
      </div>
    </AdminPortal>
  );
}

// A partner's money at a glance + the two owner actions: confirm a cash
// deposit (clears cash-in-hand) and record a payout.
// A clean in-app amount modal (replaces the browser prompt).
function AmountModal({ title, hint, suggest, okLabel, onCancel, onSubmit }) {
  const [val, setVal] = useState(suggest ? String(suggest) : "");
  const n = Number(val);
  return (
    <div className="amt-modal" onClick={onCancel}>
      <div className="amt-card" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {hint && <p>{hint}</p>}
        <input type="number" inputMode="numeric" autoFocus value={val}
          onChange={(e) => setVal(e.target.value)} placeholder="₹ amount" />
        <div className="amt-actions">
          <button className="amt-cancel" onClick={onCancel}>Cancel</button>
          <button className="amt-ok" disabled={!n || n <= 0} onClick={() => onSubmit(n)}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

function WalletBlock({ partner, w, onChange }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState(null); // 'deposit' | 'payout' | 'adjust' | null
  useBackGuard(!!modal, () => setModal(null));
  const bal = w?.balance || 0, cash = w?.cashInHand || 0, strikes = w?.strikes || 0;

  async function submit(kind, v) {
    setModal(null); setBusy(true); setMsg("");
    try {
      if (kind === "deposit") { await withMinTime(() => api.partnerDepositCash(partner.userId, v), 600, 1200); setMsg("✓ Deposit recorded"); }
      else { await withMinTime(() => api.partnerRecordPayoutAdmin(partner.userId, v, "Weekly payout"), 600, 1200); setMsg("✓ Payout recorded"); }
      await onChange();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function clearStrikes() {
    if (!confirm(`Clear all ${strikes} strike${strikes === 1 ? "" : "s"} for ${partner.fullName}?`)) return;
    setBusy(true); setMsg("");
    try {
      await withMinTime(() => api.partnerClearStrikes(partner.userId), 500, 1000);
      setMsg("✓ Strikes cleared"); await onChange();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function adjust(signed, note) {
    setModal(null); setBusy(true); setMsg("");
    try {
      await withMinTime(() => api.partnerWalletAdjust(partner.userId, signed, note), 500, 1000);
      setMsg(`✓ Balance adjusted ${signed > 0 ? "+" : "−"}₹${Math.abs(signed)}`); await onChange();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="pwallet">
      <div className="pwallet-stats">
        <div className="pw-stat"><span>Balance</span><strong className={bal < 0 ? "neg" : ""}>₹{Math.round(bal)}</strong></div>
        <div className="pw-stat"><span>Cash in hand</span><strong className={cash > 0 ? "warn" : ""}>₹{Math.round(cash)}</strong></div>
        <div className="pw-stat"><span>Strikes</span><strong className={strikes >= 2 ? "neg" : ""}>{strikes}</strong></div>
      </div>
      <div className="pwallet-actions">
        <button disabled={busy || cash <= 0} onClick={() => setModal("deposit")}>💵 Confirm cash deposit</button>
        <button disabled={busy || bal <= 0} onClick={() => setModal("payout")}>💸 Record payout</button>
      </div>
      <div className="pwallet-fix">
        <button className="fix-btn" disabled={busy} onClick={() => setModal("adjust")}>⚖️ Adjust balance / fix mistake</button>
        {strikes > 0 && (
          <button className="fix-btn" disabled={busy} onClick={clearStrikes}>🧹 Reset strikes</button>
        )}
      </div>
      {msg && <div className="pwallet-msg">{msg}</div>}

      {modal === "deposit" && (
        <AdminPortal>
          <AmountModal title={`Cash deposit — ${partner.fullName}`} hint={`They owe the shop ₹${Math.round(cash)}.`}
            suggest={Math.round(cash)} okLabel="Confirm" onCancel={() => setModal(null)}
            onSubmit={(v) => submit("deposit", v)} />
        </AdminPortal>
      )}
      {modal === "payout" && (
        <AdminPortal>
          <AmountModal title={`Pay out — ${partner.fullName}`} hint={`Current balance ₹${Math.round(bal)}.`}
            suggest={Math.max(0, Math.round(bal))} okLabel="Pay out" onCancel={() => setModal(null)}
            onSubmit={(v) => submit("payout", v)} />
        </AdminPortal>
      )}
      {modal === "adjust" && (
        <AdminPortal>
          <AdjustModal partner={partner} bal={bal} onCancel={() => setModal(null)} onSubmit={adjust} />
        </AdminPortal>
      )}
    </div>
  );
}

// Post a manual wallet correction: Credit adds to the partner's balance,
// Debit subtracts. Used to reverse a mistaken payout/deposit.
function AdjustModal({ partner, bal, onCancel, onSubmit }) {
  const [val, setVal] = useState("");
  const [note, setNote] = useState("");
  const amt = Math.abs(Number(val) || 0);
  return (
    <div className="amt-modal" onClick={onCancel}>
      <div className="amt-card" onClick={(e) => e.stopPropagation()}>
        <h3>Adjust balance — {partner.fullName}</h3>
        <p>
          Current balance ₹{Math.round(bal)}. <b>Credit</b> adds money back to the partner (e.g. to
          reverse a wrong payout); <b>Debit</b> takes it away.
        </p>
        <input type="number" min="0" inputMode="numeric" value={val} autoFocus
          onChange={(e) => setVal(e.target.value)} placeholder="₹ amount" />
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (e.g. reverse wrong payout)" />
        <div className="amt-actions amt-actions-3">
          <button className="amt-cancel" onClick={onCancel}>Cancel</button>
          <button className="amt-ok debit" disabled={amt <= 0} onClick={() => onSubmit(-amt, note)}>− Debit</button>
          <button className="amt-ok credit" disabled={amt <= 0} onClick={() => onSubmit(amt, note)}>＋ Credit</button>
        </div>
      </div>
    </div>
  );
}

export default function PartnersAdmin() {
  const partners = usePartners();
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [err, setErr] = useState("");
  const [wallets, setWallets] = useState({});
  const [approved, setApproved] = useState(false);
  const [view, setView] = useState("team"); // 'team' (approved) | 'requests' (pending) | 'rejected'
  useBackGuard(view !== "team", () => { setView("team"); setOpenId(null); });
  useBackGuard(!!viewer, () => setViewer(null));

  const loadWallets = () => api.fetchPartnerWallets().then(setWallets).catch(() => {});
  useEffect(() => {
    loadWallets();
    const unsubs = ["wallet_ledger", "partner_strikes"].map((t) => api.subscribeTable(t, loadWallets));
    return () => unsubs.forEach((u) => u && u());
  }, [partners.length]);

  const byName = (a, b) => a.fullName.localeCompare(b.fullName);
  // Home shows your team (approved). Pending (awaiting your decision) is the
  // "Requests" list; rejected are already decided, so they get their own list.
  const team = partners.filter((p) => p.status === "approved").sort(byName);
  const pending = partners.filter((p) => p.status === "pending").sort(byName);
  const rejected = partners.filter((p) => p.status === "rejected").sort(byName);
  const shown = view === "requests" ? pending : view === "rejected" ? rejected : team;
  const cashOnRoad = Object.values(wallets).reduce((s, w) => s + (w.cashInHand || 0), 0);
  const holders = Object.values(wallets).filter((w) => (w.cashInHand || 0) > 0).length;

  async function decide(p, status) {
    setErr("");
    setBusy(p.userId + status);
    try {
      await withMinTime(() => api.setPartnerStatus(p.userId, status), 650, 1300);
      if (status === "approved") { setApproved(true); setTimeout(() => setApproved(false), 1500); }
    }
    catch (e) { setErr(e?.message || "Couldn't update this partner."); }
    finally { setBusy(null); }
  }

  return (
    <>
      {cashOnRoad > 0 && (
        <div className="cash-road">
          <span>💵 Cash on the road</span>
          <strong>₹{Math.round(cashOnRoad).toLocaleString("en-IN")}</strong>
          <small>held by {holders} partner{holders === 1 ? "" : "s"}</small>
        </div>
      )}
      {view === "team" ? (
        <>
          {pending.length > 0 && (
            <button className="pending-banner" onClick={() => setView("requests")}>
              🔔 {pending.length} partner{pending.length === 1 ? "" : "s"} waiting for your approval — review →
            </button>
          )}
          <div className="partner-nav">
            {pending.length === 0 && (
              <button className="requests-link" onClick={() => setView("requests")}>
                📋 Requests ({pending.length}) →
              </button>
            )}
            {rejected.length > 0 && (
              <button className="requests-link" onClick={() => setView("rejected")}>
                🚫 Rejected ({rejected.length}) →
              </button>
            )}
          </div>
        </>
      ) : (
        <button className="requests-back" onClick={() => { setView("team"); setOpenId(null); }}>
          ← Back to team
        </button>
      )}

      {shown.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">
            {view === "requests"
              ? "No one is waiting for approval."
              : view === "rejected"
              ? "No rejected partners."
              : "No approved partners yet."}
          </p>
        </section>
      ) : (
        <div className="orders-list">
          {shown.map((p) => {
            const open = openId === p.id;
            return (
              <div className="order-card" key={p.id}>
                <button className="partner-head" onClick={() => setOpenId(open ? null : p.id)}>
                  <span className="partner-role">{p.role === "picker" ? "🧺" : "🛵"}</span>
                  <span className="partner-main">
                    <strong>{p.fullName}</strong>
                    <small>{p.role === "picker" ? "Picker" : "Delivery"} · 📞 {p.phone || "—"}</small>
                  </span>
                  <span className={`partner-status ${p.status}`}>{p.status}</span>
                </button>

                {open && (
                  <div className="partner-detail">
                    <div className="partner-kv"><span>Address</span><span>{p.address || "—"}</span></div>
                    <div className="partner-kv"><span>Email</span><span>{p.email || "—"}</span></div>
                    <div className="partner-kv"><span>Bank A/C</span><span>{p.bankAccount || "—"}</span></div>
                    <div className="partner-kv"><span>IFSC</span><span>{p.bankIfsc || "—"}</span></div>
                    {p.bankName && (
                      <div className="partner-kv"><span>Bank</span><span>{p.bankName}{p.bankBranch ? ` — ${p.bankBranch}` : ""}</span></div>
                    )}
                    <div className="partner-kv"><span>Holder</span><span>{p.bankHolder || "—"}</span></div>
                    {p.role === "delivery" && (
                      <div className="partner-kv"><span>Vehicle</span><span>{p.usesEv ? "Low-speed EV (no licence)" : "Needs licence"}</span></div>
                    )}

                    <div className="kyc-report">
                      <div className="kyc-report-title">ID verification</div>
                      {kycReport(p).map((it) => (
                        <div className={`kyc-row ${it.ok ? "ok" : "bad"}`} key={it.key}>
                          <span className="kyc-mark">{it.ok ? "✓" : "✗"}</span>
                          <span className="kyc-main">
                            <strong>{it.label}</strong>
                            <small>{it.show || "—"} · {it.ok ? it.okText : it.badText}</small>
                          </span>
                        </div>
                      ))}
                      {p.termsAcceptedAt ? (
                        <div className="kyc-row ok">
                          <span className="kyc-mark">✓</span>
                          <span className="kyc-main">
                            <strong>Terms &amp; declaration accepted</strong>
                            <small>{fmtDate(p.termsAcceptedAt)}{p.termsVersion ? ` · v${p.termsVersion}` : ""}</small>
                          </span>
                        </div>
                      ) : (
                        <div className="kyc-row bad">
                          <span className="kyc-mark">✗</span>
                          <span className="kyc-main"><strong>Terms not accepted</strong>
                            <small>Registered before the declaration was added</small></span>
                        </div>
                      )}
                    </div>

                    <div className="pdocs">
                      <DocView path={p.aadhaarFront} label="Aadhaar front" onOpen={setViewer} />
                      <DocView path={p.aadhaarBack} label="Aadhaar back" onOpen={setViewer} />
                      <DocView path={p.pan} label="PAN" onOpen={setViewer} />
                      {p.dl && <DocView path={p.dl} label="Licence" onOpen={setViewer} />}
                    </div>

                    {p.status === "approved" && (
                      <WalletBlock partner={p} w={wallets[p.userId]} onChange={loadWallets} />
                    )}

                    {err && busy === null && <div className="preg-error" style={{ marginTop: 10 }}>{err}</div>}
                    {p.status !== "approved" && (
                      !p.termsAcceptedAt ? (
                        <div className="approve-blocked">
                          🔒 Can't approve yet — this partner hasn't accepted the Terms &amp; Conditions.
                          They must re-open the app and complete registration (accepting the declaration) first.
                        </div>
                      ) : (
                        <button className="od-accept" disabled={busy} onClick={() => decide(p, "approved")}>
                          {busy === p.userId + "approved" ? <span className="ngs-spin" /> : "✅ Approve partner"}
                        </button>
                      )
                    )}
                    {p.status !== "rejected" && (
                      <button className="od-reject" style={{ width: "100%", marginTop: 8 }} disabled={busy}
                        onClick={() => decide(p, "rejected")}>
                        ✖ {p.status === "approved" ? "Revoke access" : "Reject"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DocViewer doc={viewer} onClose={() => setViewer(null)} />
      {approved && <AdminPortal><ActionOverlay variant="admin" mode="success" title="Partner approved" sub="They can start now" accent="#3B5BDB" /></AdminPortal>}
    </>
  );
}
