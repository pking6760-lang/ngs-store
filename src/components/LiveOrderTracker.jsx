import { useEffect, useMemo, useRef, useState, useCallback } from "react";
// Leaflet (~40KB gz) is loaded ONLY when the tracking map actually builds, so it
// never weighs down the home screen. isLiveOrder / LiveOrderPill are map-free.
let _L = null, _Lpromise = null;
function loadLeaflet() {
  if (_L) return Promise.resolve(_L);
  if (!_Lpromise) {
    _Lpromise = Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([m]) => { _L = m.default || m; return _L; });
  }
  return _Lpromise;
}
import { ORDER_STATUSES } from "../lib/store.js";
import { useCall } from "./CallProvider.jsx";
import { useBackGuard } from "../lib/useBackGuard.js";
import { getCurrentLocation } from "../lib/location.js";
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
  box: <><path d="M21 8 12 3 3 8l9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"/></>,
  basket: <><path d="M5 11h14l-1.2 8.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 11zM9.5 11 12 4l2.5 7"/></>,
  gift: <><path d="M20 12v8H4v-8M2 8h20v4H2zM12 8v12M12 8S11 3 8 3a2 2 0 0 0 0 4h4zM12 8s1-5 4-5a2 2 0 0 1 0 4h-4z"/></>,
};
function Svg({ d, size = 18, sw = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
}

// Statuses that mean an order is still on its way (worth tracking live).
const LIVE_STATUSES = ["Placed", "Packed", "Out for delivery"];

// Show the tracker for a live order, and keep it lingering for ~15 minutes
// after delivery (so the customer can scratch the reward + leave feedback)
// before it quietly disappears.
const POST_DELIVERY_MS = 15 * 60 * 1000;
export function isLiveOrder(o) {
  if (!o) return false;
  if (LIVE_STATUSES.includes(o.status)) return true;
  if (o.status === "Delivered" && o.deliveredAt) {
    return Date.now() - new Date(o.deliveredAt).getTime() < POST_DELIVERY_MS;
  }
  return false;
}

// Friendly one-liner for the current status, with a matching line icon.
function statusLine(order) {
  switch (order.status) {
    case "Placed": return { icon: "box", text: "Order placed — getting it ready" };
    case "Packed": return { icon: "basket", text: "Packed — waiting for a delivery partner" };
    case "Out for delivery": return { icon: "scooter", text: "On the way to you" };
    case "Delivered": return { icon: "gift", text: "Delivered — scratch your reward!" };
    default: return { icon: "box", text: order.status };
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
  const { icon, text } = statusLine(order);
  const delivered = order.status === "Delivered";
  const eta = etaMinutes(order);
  return (
    <button className={`live-pill ${raised ? "raised" : ""} ${delivered ? "reward" : ""}`} onClick={onOpen}>
      <span className="live-pill-bike" aria-hidden><Svg d={Icon[icon]} size={20} /></span>
      <span className="live-pill-mid">
        <span className="live-pill-top">
          Order #{order.id}
          <span className="live-pill-dot" />
          <span className="live-pill-live">{delivered ? "REWARD" : "LIVE"}</span>
        </span>
        <span className="live-pill-sub">{text}</span>
      </span>
      {delivered ? (
        <span className="live-pill-gift" aria-hidden><Svg d={Icon.gift} size={22} /></span>
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

// Normalise a location that may be an object OR a JSON string (jsonb quirks).
function parseLatLng(o) {
  if (!o) return null;
  let v = o;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (v.lat == null || v.lng == null) return null;
  const lat = Number(v.lat), lng = Number(v.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
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
  const [sharing, setSharing] = useState(false);
  const [shareErr, setShareErr] = useState("");
  const { callParty } = useCall();
  // One in-app call button: the server rings the assigned rider, or the shop
  // owner if none — either way the customer just sees "Delivery partner".
  const callDelivery = () => callParty(order?.dbId, "Delivery partner");

  useBackGuard(open, onClose);

  // Order was placed without a pinned location → let the customer share it now
  // so delivery can reach them and the live map lights up.
  const shareLocation = useCallback(async () => {
    if (!order?.dbId) return;
    setSharing(true); setShareErr("");
    try {
      const loc = await getCurrentLocation();
      await api.setOrderLocation(order.dbId, { lat: loc.lat, lng: loc.lng });
      if (onRefresh) await onRefresh();
    } catch (e) {
      setShareErr(e.message || "Couldn't get your location.");
    } finally {
      setSharing(false);
    }
  }, [order?.dbId, onRefresh]);

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

  const home = parseLatLng(order?.location);
  const shop = parseLatLng(shopLoc);
  // A map shows whenever we know where the order is going. Shop + route + bike
  // are added when the shop location is known too.
  const canMap = !!home;
  const hasRoute = !!(home && shop);

  const route = useMemo(() => (hasRoute ? routePoints(shop, home) : []), [hasRoute, shop?.lat, shop?.lng, home?.lat, home?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentStep = order ? ORDER_STATUSES.indexOf(order.status) : -1;

  // Build the map once when the sheet opens (leaflet is fetched on demand here).
  useEffect(() => {
    if (!open || !canMap || !mapEl.current) return;
    let map, cancelled = false;
    loadLeaflet().then((L) => {
    if (cancelled || !mapEl.current) return;
    try {
      map = L.map(mapEl.current, { zoomControl: false, attributionControl: false, dragging: true });
      // Carto's free basemap — app-friendly (unlike OSM's public server which
      // blocks bulk/app usage and returns blank tiles).
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", {
        maxZoom: 19, subdomains: "abcd",
      }).addTo(map);

      const pinSvg = (paths) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
      const pin = (svg, cls) => L.divIcon({ className: "", html: `<div class="lt-marker ${cls}">${svg}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] });
      const bikeSvg = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="2.4"/><circle cx="17" cy="17" r="2.4"/><path d="M6 17h7l3-6h3M13 11l-2-5H8M16 17h-3"/></svg>`;
      const bikeIcon = L.divIcon({ className: "", html: `<div class="lt-bike">${bikeSvg}</div>`, iconSize: [44, 44], iconAnchor: [22, 22] });

      L.marker([home.lat, home.lng], { icon: pin(pinSvg('<path d="M3 11l9-8 9 8M5 10v10h14V10"/>'), "lt-home") }).addTo(map);

      if (hasRoute && route.length) {
        const line = L.polyline(route, { color: "#0AA25F", weight: 5, opacity: 0.85, dashArray: "1 10", lineCap: "round" }).addTo(map);
        L.marker([shop.lat, shop.lng], { icon: pin(pinSvg('<path d="M4 9V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M4 9l1 11h14l1-11M4 9h16"/>'), "lt-shop") }).addTo(map);
        const bike = L.marker(route[0], { icon: bikeIcon, zIndexOffset: 1000 }).addTo(map);
        bikeRef.current = bike;
        map.fitBounds(line.getBounds().pad(0.45), { maxZoom: 16 });
      } else {
        const bike = L.marker([home.lat, home.lng], { icon: bikeIcon, zIndexOffset: 1000 }).addTo(map);
        bikeRef.current = bike;
        map.setView([home.lat, home.lng], 16);
      }

      mapRef.current = map;
      const fix = () => { try { map.invalidateSize(); } catch { /* ignore */ } };
      [120, 400, 900].forEach((ms) => setTimeout(fix, ms));
    } catch { /* leaflet failed — the sheet still shows everything else */ }
    }).catch(() => { /* leaflet chunk failed to load — sheet still works */ });

    return () => { cancelled = true; cancelAnimationFrame(rafRef.current); try { map && map.remove(); } catch { /* ignore */ } mapRef.current = null; bikeRef.current = null; };
  }, [open, canMap, hasRoute]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real GPS wins: if the rider is streaming a fresh position, pin the bike
  // there and keep it + the home in view. Otherwise fall back to the animation.
  const riderFresh = rider && rider.lat != null && rider.locAt &&
    (Date.now() - new Date(rider.locAt).getTime() < 120000);

  // Animate the bike along the route based on status.
  useEffect(() => {
    if (!open || !canMap || !bikeRef.current) return;
    const bike = bikeRef.current;

    if (riderFresh) {
      bike.setLatLng([rider.lat, rider.lng]);
      const map = mapRef.current;
      if (map && _L && home) {
        map.fitBounds(_L.latLngBounds([[rider.lat, rider.lng], [home.lat, home.lng]]).pad(0.4), { animate: true, maxZoom: 16 });
      }
      return; // real GPS — no fake animation
    }

    if (!route.length) return; // no shop route to animate along — bike sits at home

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
  // A delivery partner only exists once the order is actually on its way — the
  // picker packs first, then a driver (or the owner) takes it out. Until then
  // there's no one to call, so the call buttons stay hidden.
  const outForDelivery = order.status === "Out for delivery";
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
            <div className="lt-hero-eta">
              {delivered
                ? "Delivered"
                : order.deliverySlot
                ? order.deliverySlot.replace(/^(Today|Tomorrow)\s+/, "")
                : `${eta} min`}
            </div>
            <div className="lt-hero-sub">
              {delivered
                ? "Order delivered — enjoy!"
                : order.deliverySlot
                ? `Scheduled · arriving ${order.deliverySlot}`
                : text}
            </div>
          </div>
          {outForDelivery && (
            <div className="lt-hero-actions">
              <button className="lt-hero-call" onClick={callDelivery} aria-label="Call the delivery partner">
                <Svg d={Icon.phone} size={14} sw={2.2} /> Call
              </button>
            </div>
          )}
        </div>

        {/* Segmented progress */}
        <div className="lt-progress">
          {ORDER_STATUSES.map((s, i) => (
            <span key={s} className={`lt-progress-seg ${i <= currentStep ? "on" : ""}`} />
          ))}
        </div>

        {delivered && (order.scratchClaimed || order.scratchPoints > 0 || order.scratchWallet > 0) && (
          <ScratchCard orderId={order.dbId} existingReward={order.scratchClaimed ? order.scratchReward : null} />
        )}

        {delivered && <LiveFeedback order={order} riderName={rider?.name} />}

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
            <p>Share your location so the rider reaches you and the live map turns on.</p>
            <button className="lt-nomap-share" onClick={shareLocation} disabled={sharing}>
              {sharing ? "Getting your location…" : "📍 Share my location"}
            </button>
            {shareErr && <span className="lt-nomap-err">{shareErr}</span>}
          </div>
        )}

        {/* Driver card */}
        {rider && outForDelivery && (
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
            <button className="lt-driver-call" onClick={callDelivery} aria-label={`Call ${rider.name}`}>
              <Svg d={Icon.phone} size={20} />
            </button>
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

        {/* Contact — the masked in-app call reaches the delivery partner, so it
            only makes sense once someone is actually out delivering. While the
            order is still being packed we show a calm "being prepared" note. */}
        {outForDelivery ? (
          <div className="lt-card lt-contact">
            <div className="lt-card-title">Need help with this order?</div>
            <div className="lt-contact-btns">
              <button className="lt-contact-btn" onClick={callDelivery}>
                <Svg d={Icon.phone} size={16} sw={2.2} /> Call delivery partner
              </button>
            </div>
          </div>
        ) : !delivered && (
          <div className="lt-card lt-contact">
            <div className="lt-card-title">Need help with this order?</div>
            <div className="lt-contact-note">
              <Svg d={Icon.box} size={16} sw={2.1} />
              <span>Your order is being prepared. You'll be able to call your delivery partner once it's on the way.</span>
            </div>
          </div>
        )}

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

function Stars({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="lt-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= (hover || value) ? "on" : ""}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function LiveFeedback({ order, riderName }) {
  const [driver, setDriver] = useState(order.riderRating || 0);
  const [appR, setAppR] = useState(order.rating || 0);
  const [comment, setComment] = useState(order.feedback || "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(!!(order.rating || order.riderRating));

  async function submit() {
    if (busy || (!driver && !appR)) return;
    setBusy(true);
    try {
      if (driver) await api.rateOrderRider(order.dbId, driver);
      if (appR) await api.rateOrder(order.dbId, appR, comment);
      setDone(true);
    } catch { /* keep the form so they can retry */ }
    finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="lt-card lt-fb-done">
        <Svg d={Icon.check} size={18} sw={2.6} />
        Thanks for your feedback!
      </div>
    );
  }

  return (
    <div className="lt-card">
      <div className="lt-card-title">Rate your order</div>
      <div className="lt-fb-block">
        <div className="lt-fb-lbl">
          <Svg d={Icon.scooter} size={16} /> Delivery partner{riderName ? ` · ${riderName.split(" ")[0]}` : ""}
        </div>
        <Stars value={driver} onChange={setDriver} />
      </div>
      <div className="lt-fb-block">
        <div className="lt-fb-lbl"><Svg d={Icon.shield} size={16} /> Your experience with NGS</div>
        <Stars value={appR} onChange={setAppR} />
        <textarea
          className="lt-fb-text"
          placeholder="Tell us what went well or what we can improve (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
        />
      </div>
      <button className="lt-fb-submit" onClick={submit} disabled={busy || (!driver && !appR)}>
        {busy ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}
