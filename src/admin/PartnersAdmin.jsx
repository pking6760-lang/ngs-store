import { useEffect, useState } from "react";
import { usePartners } from "../lib/hooks.js";
import * as api from "../lib/api.js";
import { kycReport } from "../lib/kyc.js";

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
    <div className="doc-viewer" onClick={onClose}>
      <div className="doc-viewer-bar">
        <span>{doc.label}</span>
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      <img src={doc.url} alt={doc.label} onClick={(e) => e.stopPropagation()} />
    </div>
  );
}

// A partner's money at a glance + the two owner actions: confirm a cash
// deposit (clears cash-in-hand) and record a payout.
function WalletBlock({ partner, w, onChange }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const bal = w?.balance || 0, cash = w?.cashInHand || 0, strikes = w?.strikes || 0;

  async function deposit() {
    const v = Number(prompt(`Cash received from ${partner.fullName}? (they owe ₹${Math.round(cash)})`, Math.round(cash) || ""));
    if (!v || v <= 0) return;
    setBusy(true); setMsg("");
    try { await api.partnerDepositCash(partner.userId, v); setMsg("✓ Deposit recorded"); await onChange(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  async function payout() {
    const suggested = Math.max(0, Math.round(bal));
    const v = Number(prompt(`Pay out to ${partner.fullName}? (balance ₹${Math.round(bal)})`, suggested || ""));
    if (!v || v <= 0) return;
    setBusy(true); setMsg("");
    try { await api.partnerRecordPayoutAdmin(partner.userId, v, "Weekly payout"); setMsg("✓ Payout recorded"); await onChange(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="pwallet">
      <div className="pwallet-stats">
        <div className="pw-stat"><span>Balance</span><strong className={bal < 0 ? "neg" : ""}>₹{Math.round(bal)}</strong></div>
        <div className="pw-stat"><span>Cash in hand</span><strong className={cash > 0 ? "warn" : ""}>₹{Math.round(cash)}</strong></div>
        <div className="pw-stat"><span>Strikes</span><strong className={strikes >= 2 ? "neg" : ""}>{strikes}</strong></div>
      </div>
      <div className="pwallet-actions">
        <button disabled={busy || cash <= 0} onClick={deposit}>💵 Confirm cash deposit</button>
        <button disabled={busy || bal <= 0} onClick={payout}>💸 Record payout</button>
      </div>
      {msg && <div className="pwallet-msg">{msg}</div>}
    </div>
  );
}

export default function PartnersAdmin() {
  const partners = usePartners();
  const [filter, setFilter] = useState("pending");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [err, setErr] = useState("");
  const [wallets, setWallets] = useState({});

  const loadWallets = () => api.fetchPartnerWallets().then(setWallets).catch(() => {});
  useEffect(() => {
    loadWallets();
    const unsubs = ["wallet_ledger", "partner_strikes"].map((t) => api.subscribeTable(t, loadWallets));
    return () => unsubs.forEach((u) => u && u());
  }, [partners.length]);

  const shown = partners.filter((p) => (filter === "all" ? true : p.status === filter));
  const cashOnRoad = Object.values(wallets).reduce((s, w) => s + (w.cashInHand || 0), 0);
  const holders = Object.values(wallets).filter((w) => (w.cashInHand || 0) > 0).length;

  async function decide(p, status) {
    setErr("");
    setBusy(p.userId + status);
    try { await api.setPartnerStatus(p.userId, status); }
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
      <div className="toolbar">
        <div className="filter-chips">
          {["pending", "approved", "rejected", "all"].map((f) => (
            <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)}
              {f === "pending" && partners.some((p) => p.status === "pending") ? " ●" : ""}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="panel"><p className="panel-empty">No partners in this view.</p></section>
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
                          ✅ Approve partner
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
    </>
  );
}
