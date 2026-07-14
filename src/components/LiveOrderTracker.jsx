import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ORDER_STATUSES } from "../lib/store.js";
import { useBackGuard } from "../lib/useBackGuard.js";
import * as api from "../lib/api.js";

// Statuses that mean an order is still on its way (worth tracking live).
const LIVE_STATUSES = ["Placed", "Packed", "Out for delivery"];

export function isLiveOrder(o) {
  return o && LIVE_STATUSES.includes(o.status);
}

// Friendly one-liner + rough ETA for the current status.
function statusLine(order) {
  switch (order.status) {
    case "Placed": return { emoji: "📝", text: "Order placed — getting it ready" };
    case "Packed": return { emoji: "🧺", text: "Packed — waiting for a delivery partner" };
    case "Out for delivery": return { emoji: "🛵", text: "On the way to you" };
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
  const eta = etaMinutes(order);
  return (
    <button className={`live-pill ${raised ? "raised" : ""}`} onClick={onOpen}>
      <span className="live-pill-bike" aria-hidden>{emoji}</span>
      <span className="live-pill-mid">
        <span className="live-pill-top">
          Order #{order.id}
          <span className="live-pill-dot" />
          <span className="live-pill-live">LIVE</span>
        </span>
        <span className="live-pill-sub">{text}</span>
      </span>
      <span className="live-pill-eta">
        <strong>{eta}</strong>
        <small>min</small>
      </span>
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

    const pin = (emoji, cls) => L.divIcon({ className: "", html: `<div class="lt-marker ${cls}">${emoji}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
    L.marker([shop.lat, shop.lng], { icon: pin("🏪", "lt-shop") }).addTo(map);
    L.marker([home.lat, home.lng], { icon: pin("🏠", "lt-home") }).addTo(map);

    const bike = L.marker(route[0], { icon: L.divIcon({ className: "", html: `<div class="lt-bike">🛵</div>`, iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 1000 }).addTo(map);
    bikeRef.current = bike;
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 150);

    return () => { cancelAnimationFrame(rafRef.current); map.remove(); mapRef.current = null; bikeRef.current = null; };
  }, [open, canMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate the bike along the route based on status.
  useEffect(() => {
    if (!open || !canMap || !bikeRef.current || !route.length) return;
    const bike = bikeRef.current;
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
  }, [open, canMap, order?.status, route]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !order) return null;
  const eta = etaMinutes(order);
  const { text } = statusLine(order);

  return (
    <div className="lt-sheet">
      <div className="lt-head">
        <button className="back-btn small" onClick={onClose} aria-label="Back">←</button>
        <h2>Track order</h2>
        <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="lt-body">
        <div className="lt-eta-card">
          <div className="lt-eta-big">{order.status === "Delivered" ? "Delivered" : `Arriving in ~${eta} min`}</div>
          <div className="lt-eta-sub">🛵 {text}</div>
        </div>

        {canMap ? (
          <div className="lt-map-wrap">
            <div ref={mapEl} className="lt-map" />
            <button
              className={`lt-refresh ${refreshing ? "spin" : ""}`}
              onClick={refresh}
              aria-label="Refresh"
              title="Refresh"
            >
              ⟳
            </button>
          </div>
        ) : (
          <div className="lt-nomap">
            🗺️ Live map appears once your delivery location is shared. Your order status is below.
            <button className="lt-nomap-refresh" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "⟳ Refresh"}
            </button>
          </div>
        )}

        {rider && (
          <div className="lt-driver">
            <div className="lt-driver-av">{(rider.name || "?").trim().charAt(0).toUpperCase() || "🛵"}</div>
            <div className="lt-driver-mid">
              <div className="lt-driver-name">{rider.name}</div>
              <div className="lt-driver-msg">
                {order.status === "Out for delivery"
                  ? `Hi, I'm ${rider.name.split(" ")[0]} 👋 I've picked up your order and I'm on the way!`
                  : `${rider.name.split(" ")[0]} will bring your order.`}
              </div>
            </div>
            {rider.phone && (
              <a className="lt-driver-call" href={`tel:+91${rider.phone}`} aria-label={`Call ${rider.name}`}>
                📞
              </a>
            )}
          </div>
        )}

        <ol className="status-steps lt-steps">
          {ORDER_STATUSES.map((s, i) => (
            <li key={s} className={`step ${i < currentStep ? "done" : ""} ${i === currentStep ? "current" : ""}`}>
              <span className="step-dot" />
              <span className="step-label">{s}</span>
            </li>
          ))}
        </ol>

        <div className="lt-summary">
          <div className="lt-summary-head">
            <span>Order #{order.id}</span>
            <span className="lt-summary-total">₹{order.total}</span>
          </div>
          <div className="lt-summary-items">
            {(order.items || []).map((it) => (
              <div className="lt-summary-item" key={it.id}>
                <span>{it.name} × {it.qty}</span>
                <span>₹{it.price * it.qty}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
