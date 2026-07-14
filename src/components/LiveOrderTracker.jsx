import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ORDER_STATUSES } from "../lib/store.js";
import { useBackGuard } from "../lib/useBackGuard.js";
import * as api from "../lib/api.js";
import ScratchCard from "./ScratchCard.jsx";
import ProductThumb from "./ProductThumb.jsx";

/* Clean line icons (no emoji) for a professional delivery-app feel. */
const Icon = {
  phone: <path d="M6.6 10.8a15.9 15.9 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.58 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .58 3.6 1 1 0 0 1-.24 1z" />,
  scooter: <><circle cx="6" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/><path d="M6 17h7l3-6h3M13 11l-2-5H8M16 17h-3"/></>,
  check: <path d="M20 6 9 17l-5-5" />,
  store: <path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M4 9l1 11h14l1-11M4 9h16" />,
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
};
function Svg({ d, size = 18, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
}

// Statuses that mean an order is still on its way (worth tracking live).
const LIVE_STATUSES = ["Placed", "Packed", "Out for delivery"];

// Show the tracker for a live order, and keep it after delivery until the
// customer has scratched their reward (so the live page doesn't vanish the
// instant it's delivered).
export function isLiveOrder(o) {
  if (!o) return false;
  if (LIVE_STATUSES.includes(o.status)) return true;
  if (o.status === "Delivered" && !o.scratchClaimed) return true;
  return false;
}

// Friendly one-liner for the current status.
function statusLine(order) {
  switch (order.status) {
    case "Placed": return { emoji: "📝", text: "Order placed — getting it ready" };
    case "Packed": return { emoji: "🧺", text: "Packed — waiting for a delivery partner" };
    case "Out for delivery": return { emoji: "🛵", text: "On the way to you" };
    case "Delivered": return { emoji: "🎁", text: "Delivered — scratch your reward!" };
    default: return { emoji: "📦", text: order.status };
  }
}

function etaMinutes(order) {
  // Simple friendly ETA: ~12 min from placement, floored at 1.
  const placed = new Date(order.createdAt).getTime();
  const mins = Math.round((Date.now() - placed) / 60000);
  return Math.max(1, 12 - mins);
}

/* ── Floating pill (sits just above the cart bar on the home page) ─────────── */
export function LiveOrderPill({ order, raised, onOpen }) {
  const { emoji, text } = statusLine(order);
  const delivered = order.status === "Delivered";
  const eta = etaMinutes(order);
  return (
    <button className={`live-pill ${raised ? "raised" : ""} ${delivered ? "reward" : ""}`} onClick={onOpen}>
      <span className="live-pill-bike" aria-hidden>{emoji}</span>
      <span className="live-pill-mid">
        <span className="live-pill-top">
          Order #{order.id}
          <span className="live-pill-dot" />
          <span className="live-pill-live">{delivered ? "REWARD" : "LIVE"}</span>
        </span>
        <span className="live-pill-sub">{text}</span>
      </span>
      {delivered ? (
        <span className="live-pill-gift" aria-hidden>🎁</span>
      ) : (
        <span className="live-pill-eta">
          <strong>{eta}</strong>
          <small>min</small>
        </span>
      )}
      <span className="live-pill-arrow">›</span>
    </button>
  );
}

/* ── Curved route sampling (shop → home) for a road-like path ──────────────── */
function routePoints(shop, home, n = 40) {
  // Quadratic bezier with a perpendicular bow so it reads like a route, not a
  // ruler-straight line. Control point is the midpoint pushed sideways.
  const mx = (shop.lat + home.lat) / 2;
  const my = (shop.lng + home.lng) / 2;
  const dx = home.lat - shop.lat;
  const dy = home.lng - shop.lng;
  const cx = mx - dy * 0.18;
  const cy = my + dx * 0.18;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const lat = u * u * shop.lat + 2 * u * t * cx + t * t * home.lat;
    const lng = u * u * shop.lng + 2 * u * t * cy + t * t * home.lng;
    pts.push([lat, lng]);
  }
  return pts;
}

/* ── Full-screen live tracking sheet ──────────────────────────────────────── */
export function LiveTrackingSheet({ open, order, shopLoc, onClose, onRefresh }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const bikeRef = useRef(null);
  const rafRef = useRef(null);
  const [rider, setRider] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useBackGuard(open, onClose);

  // Pull the assigned rider (name + phone) for the driver card.
  const loadRider = useCallback(() => {
    if (!order?.dbId) { setRider(null); return; }
    api.fetchOrderRider(order.dbId).then(setRider).catch(() => setRider(null));
  }, [order?.dbId]);

  useEffect(() => {
    if (!open) return;
    loadRider();
    const iv = setInterval(loadRider, 15000); // keep the driver card fresh
    return () => clearInterval(iv);
  }, [open, loadRider]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      loadRider();
      if (onRefresh) await onRefresh();
      // Re-fit the map to the current route.
      const map = mapRef.current;
      if (map) { map.invalidateSize(); }
    } finally {
      setTimeout(() => setRefreshing(false), 500);
    }
  }, [loadRider, onRefresh]);

  const home = order?.location && order.location.lat != null
    ? { lat: Number(order.location.lat), lng: Number(order.location.lng) }
    : null;
  const shop = shopLoc && shopLoc.lat != null
    ? { lat: Number(shopLoc.lat), lng: Number(shopLoc.lng) }
    : null;
  const canMap = !!(home && shop);

  const route = useMemo(() => (canMap ? routePoints(shop, home) : []), [canMap, shop?.lat, shop?.lng, home?.lat, home?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentStep = order ? ORDER_STATUSES.indexOf(order.status) : -1;

  // Build the map once when the sheet opens.
  useEffect(() => {
    if (!open || !canMap || !mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: false, dragging: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);

    const line = L.polyline(route, { color: "#0AA25F", weight: 5, opacity: 0.85, dashArray: "1 10", lineCap: "round" }).addTo(map);
    map.fitBounds(line.getBounds().pad(0.35));

    const pinSvg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    const pin = (svg, cls) => L.divIcon({ className: "", html: `<div class="lt-marker ${cls}">${svg}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
    L.marker([shop.lat, shop.lng], { icon: pin(pinSvg('<path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M4 9l1 11h14l1-11M4 9h16"/>'), "lt-shop") }).addTo(map);
    L.marker([home.lat, home.lng], { icon: pin(pinSvg('<path d="M3 11l9-8 9 8M5 10v10h14V10"/>'), "lt-home") }).addTo(map);

    const bikeSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/><path d="M6 17h7l3-6h3M13 11l-2-5H8M16 17h-3"/></svg>`;
    const bike = L.marker(route[0], { icon: L.divIcon({ className: "", html: `<div class="lt-bike">${bikeSvg}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 1000 }).addTo(map);
    bikeRef.current = bike;
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);

    return () => { cancelAnimationFrame(rafRef.current); map.remove(); mapRef.current = null; bikeRef.current = null; };
  }, [open, canMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real GPS wins: if the rider is streaming a fresh position, pin the bike
  // there and keep it + the home in view. Otherwise fall back to the animation.
  const riderFresh = rider && rider.lat != null && rider.locAt &&
    (Date.now() - new Date(rider.locAt).getTime() < 120000);

  // Animate the bike along the route based on status.
  useEffect(() => {
    if (!open || !canMap || !bikeRef.current || !route.length) return;
    const bike = bikeRef.current;

    if (riderFresh) {
      bike.setLatLng([rider.lat, rider.lng]);
      const map = mapRef.current;
      if (map && home) {
        map.fitBounds(L.latLngBounds([[rider.lat, rider.lng], [home.lat, home.lng]]).pad(0.4), { animate: true });
      }
      return; // real GPS — no fake animation
    }

    // Where along the route the bike belongs for this status.
    const target =
      order.status === "Placed" ? 0.0 :
      order.status === "Packed" ? 0.08 :
      order.status === "Out for delivery" ? null : // animate
      1.0;

    if (target !== null) {
      const idx = Math.round(target * (route.length - 1));
      bike.setLatLng(route[idx]);
      return;
    }
    // Out for delivery: loop the bike smoothly from shop toward home.
    let t0 = null;
    const DUR = 14000; // one sweep
    const step = (ts) => {
      if (t0 == null) t0 = ts;
      const p = ((ts - t0) % DUR) / DUR;      // 0..1 loop
      const eased = 0.05 + p * 0.85;           // travel most of the way, then restart
      const idx = Math.min(route.length - 1, Math.round(eased * (route.length - 1)));
      bike.setLatLng(route[idx]);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, canMap, order?.status, route, riderFresh, rider?.lat, rider?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !order) return null;
  const eta = etaMinutes(order);
  const delivered = order.status === "Delivered";
  const { text } = statusLine(order);
  const firstName = rider?.name ? rider.name.split(" ")[0] : "";
  const itemCount = (order.items || []).reduce((s, it) => s + it.qty, 0);
  const payLabel = order.payment === "razorpay" ? "Paid online"
    : order.payment === "upi" ? "Paid via UPI"
    : order.payment === "wallet" ? "Paid with NGS Wallet" : "Cash on delivery";

  return (
    <div className="lt-sheet">
      <div className="lt-head">
        <button className="back-btn small" onClick={onClose} aria-label="Back">←</button>
        <h2>Track order</h2>
        <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="lt-body">
        {/* Hero ETA */}
        <div className={`lt-hero ${delivered ? "done" : ""}`}>
          <div className="lt-hero-ico"><Svg d={delivered ? Icon.check : Icon.scooter} size={22} /></div>
          <div className="lt-hero-txt">
            <div className="lt-hero-eta">{delivered ? "Delivered" : `${eta} min`}</div>
            <div className="lt-hero-sub">{delivered ? "Order delivered — enjoy!" : text}</div>
          </div>
        </div>

        {/* Segmented progress */}
        <div className="lt-progress">
          {ORDER_STATUSES.map((s, i) => (
            <span key={s} className={`lt-progress-seg ${i <= currentStep ? "on" : ""}`} />
          ))}
        </div>

        {delivered && (
          <ScratchCard orderId={order.dbId} existingReward={order.scratchClaimed ? order.scratchReward : null} />
        )}

        {/* Map */}
        {canMap ? (
          <div className="lt-map-wrap">
            <div ref={mapEl} className="lt-map" />
            <button className={`lt-refresh ${refreshing ? "spin" : ""}`} onClick={refresh} aria-label="Refresh" title="Refresh">⟳</button>
            {riderFresh && <div className="lt-live-tag"><span className="lt-live-dot" /> Live</div>}
          </div>
        ) : (
          <div className="lt-nomap">
            <Svg d={Icon.home} size={26} />
            <p>Live map appears once your delivery location is shared.</p>
            <button className="lt-nomap-refresh" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}

        {/* Driver card */}
        {rider && !delivered && (
          <div className="lt-driver">
            <div className="lt-driver-av">
              <span>{(rider.name || "?").trim().charAt(0).toUpperCase() || "R"}</span>
              <span className="lt-driver-badge"><Svg d={Icon.scooter} size={12} sw={2.4} /></span>
            </div>
            <div className="lt-driver-mid">
              <div className="lt-driver-name">
                {rider.name}
                <span className="lt-driver-verified"><Svg d={Icon.shield} size={13} sw={2.2} /></span>
              </div>
              <div className="lt-driver-role">Your delivery partner</div>
              <div className="lt-driver-msg">
                {order.status === "Out for delivery"
                  ? `"Hi, I'm ${firstName}. I've picked up your order and I'm on my way!"`
                  : `${firstName} will bring your order.`}
              </div>
            </div>
            {rider.phone && (
              <a className="lt-driver-call" href={`tel:+91${rider.phone}`} aria-label={`Call ${rider.name}`}>
                <Svg d={Icon.phone} size={20} />
              </a>
            )}
          </div>
        )}

        {/* Timeline */}
        <div className="lt-card">
          <div className="lt-card-title">Order status</div>
          <ol className="lt-timeline">
            {ORDER_STATUSES.map((s, i) => (
              <li key={s} className={`lt-tl ${i < currentStep ? "done" : ""} ${i === currentStep ? "current" : ""}`}>
                <span className="lt-tl-mark">{i < currentStep || (delivered && i === currentStep) ? <Svg d={Icon.check} size={13} sw={2.6} /> : <span className="lt-tl-dot" />}</span>
                <span className="lt-tl-label">{s}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Order summary + full bill */}
        <div className="lt-card">
          <div className="lt-card-title">
            Order summary
            <span className="lt-card-sub">#{order.id} · {itemCount} item{itemCount > 1 ? "s" : ""}</span>
          </div>
          <div className="lt-items">
            {(order.items || []).map((it) => (
              <div className="lt-item" key={it.id}>
                <ProductThumb image={it.image} name={it.name} category={it.category} size={40} radius={10} />
                <div className="lt-item-mid">
                  <div className="lt-item-name">{it.name}</div>
                  <div className="lt-item-qty">Qty {it.qty} × ₹{it.price}</div>
                </div>
                <div className="lt-item-amt">₹{it.price * it.qty}</div>
              </div>
            ))}
          </div>

          <div className="lt-bill">
            <BillRow k="Item total" v={`₹${order.itemTotal}`} />
            {order.couponDiscount > 0 && <BillRow k={`Coupon ${order.couponCode || ""}`.trim()} v={`− ₹${order.couponDiscount}`} good />}
            {order.pointsDiscount > 0 && <BillRow k={`Points used${order.pointsRedeemed ? ` (${order.pointsRedeemed} pts)` : ""}`} v={`− ₹${order.pointsDiscount}`} good />}
            <BillRow k="Delivery fee" v={order.deliveryFee ? `₹${order.deliveryFee}` : "FREE"} free={!order.deliveryFee} />
            {order.handling > 0 && <BillRow k="Handling charge" v={`₹${order.handling}`} />}
            {order.surgeFee > 0 && <BillRow k="Surge fee" v={`₹${order.surgeFee}`} />}
            {order.walletUsed > 0 && <BillRow k="NGS Wallet" v={`− ₹${order.walletUsed}`} good />}
            <div className="lt-bill-total">
              <span>Total paid</span>
              <span>₹{order.total}</span>
            </div>
            <div className="lt-pay"><Svg d={Icon.shield} size={13} /> {payLabel}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BillRow({ k, v, good, free }) {
  return (
    <div className="lt-bill-row">
      <span>{k}</span>
      <span className={good ? "good" : free ? "free" : ""}>{v}</span>
    </div>
  );
}
