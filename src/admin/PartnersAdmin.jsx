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

export default function PartnersAdmin() {
  const partners = usePartners();
  const [filter, setFilter] = useState("pending");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [viewer, setViewer] = useState(null);

  const shown = partners.filter((p) => (filter === "all" ? true : p.status === filter));

  async function decide(p, status) {
    setBusy(p.userId + status);
    try { await api.setPartnerStatus(p.userId, status); }
    finally { setBusy(null); }
  }

  return (
    <>
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

                    {p.status !== "approved" && (
                      <button className="od-accept" disabled={busy} onClick={() => decide(p, "approved")}>
                        ✅ Approve partner
                      </button>
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
