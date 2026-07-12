import { useEffect, useState } from "react";
import { usePartners } from "../lib/hooks.js";
import * as api from "../lib/api.js";

// One document photo — loads a short-lived signed URL for the private file.
function DocView({ path, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    if (path) api.partnerDocUrl(path).then((u) => alive && setUrl(u));
    return () => { alive = false; };
  }, [path]);
  if (!path) return null;
  return (
    <a className="pdoc" href={url || undefined} target="_blank" rel="noopener noreferrer">
      {url ? <img src={url} alt={label} /> : <div className="pdoc-loading">…</div>}
      <span>{label}</span>
    </a>
  );
}

export default function PartnersAdmin() {
  const partners = usePartners();
  const [filter, setFilter] = useState("pending");
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);

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
                    <div className="partner-kv"><span>Holder</span><span>{p.bankHolder || "—"}</span></div>
                    {p.role === "delivery" && (
                      <div className="partner-kv"><span>Vehicle</span><span>{p.usesEv ? "Low-speed EV (no licence)" : "Needs licence"}</span></div>
                    )}

                    <div className="pdocs">
                      <DocView path={p.aadhaarFront} label="Aadhaar front" />
                      <DocView path={p.aadhaarBack} label="Aadhaar back" />
                      <DocView path={p.pan} label="PAN" />
                      {p.dl && <DocView path={p.dl} label="Licence" />}
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
    </>
  );
}
