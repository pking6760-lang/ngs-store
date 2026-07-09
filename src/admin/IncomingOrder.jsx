import { useEffect, useRef, useState } from "react";
import { useOrders } from "../lib/hooks.js";
import { acceptOrder, rejectOrder } from "../lib/store.js";
import { googleMapsLink } from "../lib/location.js";
import { startAlarm, stopAlarm } from "../lib/sound.js";
import ProductThumb from "../components/ProductThumb.jsx";

// Full-screen takeover shown to the admin the moment a new (unaccepted) order
// arrives, with a looping alarm and a slide-to-accept control. In the demo it
// appears whenever the app is open; delivering it to a locked phone needs the
// backend + native push (like an incoming call).
export default function IncomingOrder() {
  const orders = useOrders();
  const [slide, setSlide] = useState(0); // 0..100 slide-to-accept progress

  // Oldest order still waiting for a decision.
  const pending = orders.filter(
    (o) => o.accepted !== true && o.status !== "Cancelled"
  );
  const order = pending.length ? pending[pending.length - 1] : null;

  // Start / stop the alarm as the screen appears / disappears.
  const activeId = order?.id || null;
  const prevId = useRef(null);
  useEffect(() => {
    if (activeId) startAlarm();
    else stopAlarm();
    prevId.current = activeId;
    return () => stopAlarm();
  }, [activeId]);

  // Reset the slider whenever a new order comes up.
  useEffect(() => {
    setSlide(0);
  }, [activeId]);

  if (!order) return null;

  function release() {
    if (slide >= 90) {
      stopAlarm();
      acceptOrder(order.id);
    } else {
      setSlide(0);
    }
  }

  function reject() {
    stopAlarm();
    rejectOrder(order.id);
  }

  return (
    <div className="incoming-overlay">
      <div className="incoming-card">
        <div className="incoming-pulse">🔔</div>
        <div className="incoming-title">NEW ORDER</div>
        <div className="incoming-id">#{order.id}</div>

        {order.member && (
          <div className="incoming-member">👑 Prime member · priority</div>
        )}

        <div className="incoming-amount">
          ₹{order.total}
          <span className="incoming-pay">
            {order.payment === "upi" ? "UPI (paid)" : "Cash on delivery"}
          </span>
        </div>

        <div className="incoming-customer">
          👤 {order.customer}
          {order.userPhone ? ` · 📞 +91 ${order.userPhone}` : ""}
        </div>

        {order.address && (
          <div className="incoming-address">🏠 {order.address}</div>
        )}

        {order.location && (
          <a
            className="incoming-map"
            href={googleMapsLink(order.location)}
            target="_blank"
            rel="noopener noreferrer"
          >
            📍 View location on Google Maps
          </a>
        )}

        <div className="incoming-items">
          {order.items.map((it) => (
            <div className="incoming-item" key={it.id}>
              <span className="incoming-item-name">
                <ProductThumb
                  image={it.image}
                  name={it.name}
                  category={it.category}
                  size={24}
                  radius={5}
                />
                {it.name}
              </span>
              <span>× {it.qty}</span>
            </div>
          ))}
        </div>

        {/* Slide to accept */}
        <div className="slide-accept">
          <div className="slide-fill" style={{ width: `${slide}%` }} />
          <span className="slide-label">
            {slide >= 90 ? "Release to accept ✓" : "Slide to accept →"}
          </span>
          <input
            className="slide-range"
            type="range"
            min="0"
            max="100"
            value={slide}
            onChange={(e) => setSlide(Number(e.target.value))}
            onPointerUp={release}
            onTouchEnd={release}
            onMouseUp={release}
          />
        </div>

        <button className="incoming-reject" onClick={reject}>
          Reject order
        </button>
      </div>
    </div>
  );
}
