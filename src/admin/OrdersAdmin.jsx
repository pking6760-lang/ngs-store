import { useState } from "react";
import { useOrders } from "../lib/hooks.js";
import { ORDER_STATUSES } from "../lib/store.js";
import { updateOrderStatus } from "../lib/actions.js";
import { googleMapsLink } from "../lib/location.js";
import { buildUpiLink, qrDataUri, SHOP_UPI_ID, cleanUpiQrFromImage } from "../lib/payments.js";
import { createOrderQr } from "../lib/api.js";
import ProductThumb from "../components/ProductThumb.jsx";
import { StatusPill } from "./Dashboard.jsx";

export default function OrdersAdmin() {
  const orders = useOrders();
  const [filter, setFilter] = useState("all");
  // Doorstep collection: which order's QR is open + its QR image + whether it's
  // the gateway QR (auto-confirms) or the plain UPI fallback (confirm manually).
  const [qrFor, setQrFor] = useState(null);
  const [qrState, setQrState] = useState({ loading: false, url: "", verified: false });

  async function openQr(order) {
    if (qrFor === order.id) { setQrFor(null); return; }
    setQrFor(order.id);
    setQrState({ loading: true, url: "", verified: false });
    try {
      // Gateway QR (auto-verifies). Redraw it as a plain, clean QR (no branding).
      const { imageUrl, imageDataUrl } = await createOrderQr(order.dbId);
      const cleanQr = await cleanUpiQrFromImage(imageDataUrl);
      setQrState({ loading: false, url: cleanQr || imageDataUrl || imageUrl, verified: true });
    } catch {
      // Fallback: a plain UPI QR straight to the shop. Works everywhere; the
      // rider confirms by tapping Delivered after the money lands.
      const upi = qrDataUri(buildUpiLink({ amount: order.total, note: `NGS ${order.id}` }));
      setQrState({ loading: false, url: upi, verified: false });
    }
  }

  const shown =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  return (
    <>
      <div className="toolbar">
        <div className="filter-chips">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>
            All
          </Chip>
          {ORDER_STATUSES.map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>
              {s}
            </Chip>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">No orders in this view yet.</p>
        </section>
      ) : (
        <div className="orders-list">
          {shown.map((o) => (
            <div className="order-card" key={o.id}>
              <div className="order-card-head">
                <div>
                  <span className="order-id">#{o.id}</span>
                  <span className="order-time">{formatTime(o.createdAt)}</span>
                </div>
                <StatusPill status={o.status} />
              </div>

              <div className="order-customer">
                👤 {o.customer}
                {o.userPhone ? ` · 📞 +91 ${o.userPhone}` : ""}
                {o.member && <span className="member-chip">👑 Prime</span>}
                {o.accepted === false && o.status !== "Cancelled" && (
                  <span className="await-chip">⏳ Awaiting accept</span>
                )}
              </div>

              {o.address && <div className="order-address">🏠 {o.address}</div>}

              {/* Doorstep collection: for any order NOT already paid, show a
                  Razorpay UPI QR. The customer scans it with ANY UPI app and pays
                  directly; the webhook then flips this order to PAID (green) live. */}
              {o.paymentStatus !== "paid" && o.status !== "Cancelled" && (
                <div className="order-collect">
                  <button className="collect-btn" onClick={() => openQr(o)}>
                    {qrFor === o.id ? "▲ Hide payment QR" : `📲 Show UPI QR · collect ₹${o.total}`}
                  </button>
                  {qrFor === o.id && (
                    <div className="collect-qr">
                      {qrState.loading && <p>Creating UPI QR…</p>}
                      {qrState.url && (
                        <>
                          <img src={qrState.url} alt="UPI payment QR code" />
                          <p>
                            Scan with <strong>any UPI app</strong> (GPay, PhonePe, Paytm) to pay{" "}
                            <strong>₹{o.total}</strong>
                            <br />
                            <span>Pays directly to the shop</span>
                          </p>
                          {qrState.verified ? (
                            <p className="collect-wait">⏳ Waiting for payment… turns green here once paid.</p>
                          ) : (
                            <p className="collect-wait">After the money is received, tap <strong>Delivered</strong>.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="order-meta">
                <PaymentTag order={o} />
                {o.location ? (
                  <a
                    className="order-track-link"
                    href={googleMapsLink(o.location)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    📍 Track on Google Maps
                  </a>
                ) : (
                  <span className="order-noloc">📍 No location shared</span>
                )}
              </div>

              <div className="order-items">
                {o.items.map((it) => (
                  <div className="order-item" key={it.id}>
                    <span className="order-item-icon">
                      <ProductThumb
                        image={it.image}
                        name={it.name}
                        category={it.category}
                        size={28}
                        radius={6}
                      />
                    </span>
                    <span className="order-item-name">{it.name}</span>
                    <span className="order-item-qty">× {it.qty}</span>
                    <span className="order-item-price">₹{it.price * it.qty}</span>
                  </div>
                ))}
              </div>

              {(o.pointsEarned > 0 || o.pointsUsed > 0 || o.discount > 0 || o.couponDiscount > 0) && (
                <div className="order-points-row">
                  {o.couponDiscount > 0 && (
                    <span>🎟️ {o.couponCode} −₹{o.couponDiscount}</span>
                  )}
                  {o.discount > 0 && <span>₹{o.discount} points discount</span>}
                  {o.pointsUsed > 0 && <span>−{o.pointsUsed} pts used</span>}
                  {o.pointsEarned > 0 && <span>+{o.pointsEarned} pts earned</span>}
                </div>
              )}

              <div className="order-card-foot">
                <div className="order-total">
                  Total <strong>₹{o.total}</strong>
                </div>
                {o.status === "Delivered" ? (
                  <span className="order-done-tag">✅ Delivered</span>
                ) : o.status === "Cancelled" ? (
                  <span className="order-cancel-tag">✖ Cancelled</span>
                ) : (
                  <label className="order-status-select">
                    <span>Update status</span>
                    <select
                      value={o.status}
                      onChange={(e) => updateOrderStatus(o, e.target.value)}
                    >
                      {/* Only the current status and the steps AFTER it — an
                          order can move forward, never back. */}
                      {ORDER_STATUSES.slice(
                        Math.max(0, ORDER_STATUSES.indexOf(o.status))
                      ).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// A clear, at-a-glance payment badge: is this order already PAID, or does the
// rider need to COLLECT cash on delivery?
function PaymentTag({ order }) {
  const method = order.paymentMethod || order.payment;
  const online = method === "razorpay" || method === "online" || method === "card";
  if (online) {
    return order.paymentStatus === "paid" ? (
      <span className="order-pay-tag paid">✅ PAID online · ₹{order.total}</span>
    ) : (
      <span className="order-pay-tag unpaid">⏳ Online — payment pending</span>
    );
  }
  if (method === "cod") {
    return <span className="order-pay-tag cod">💵 COLLECT ₹{order.total} cash on delivery</span>;
  }
  if (method === "upi") {
    return <span className="order-pay-tag">🟣 UPI · ₹{order.total}</span>;
  }
  return <span className="order-pay-tag">💳 ₹{order.total}</span>;
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
