import { useState } from "react";
import { useSettings } from "../lib/hooks.js";
import { updateSettings } from "../lib/store.js";
import { getCurrentLocation, googleMapsLink } from "../lib/location.js";
import { shop } from "../data/shop.js";

export default function DeliveryAdmin() {
  const settings = useSettings();
  const [form, setForm] = useState({
    deliveryFee: settings.deliveryFee,
    freeDeliveryAbove: settings.freeDeliveryAbove,
    handlingFee: settings.handlingFee,
    maxDistanceKm: settings.maxDistanceKm,
  });
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");

  const shopLoc = settings.shopLocation;

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  }

  function save() {
    updateSettings({
      deliveryFee: Math.max(0, Number(form.deliveryFee) || 0),
      freeDeliveryAbove: Math.max(0, Number(form.freeDeliveryAbove) || 0),
      handlingFee: Math.max(0, Number(form.handlingFee) || 0),
      maxDistanceKm: Math.max(0, Number(form.maxDistanceKm) || 0),
    });
    setSaved(true);
  }

  async function setShopLocation() {
    setLocating(true);
    setLocError("");
    try {
      const loc = await getCurrentLocation();
      updateSettings({ shopLocation: { lat: loc.lat, lng: loc.lng } });
    } catch (err) {
      setLocError(err.message);
    } finally {
      setLocating(false);
    }
  }

  return (
    <div className="offers-wrap">
      <section className="panel offer-card">
        <h3>Charges</h3>
        <p className="sub">Set what customers pay for delivery.</p>
        <div className="delivery-fields">
          <label className="dfield">
            <span>Delivery fee (₹)</span>
            <input type="number" min="0" value={form.deliveryFee}
              onChange={(e) => set("deliveryFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Free delivery above (₹)</span>
            <input type="number" min="0" value={form.freeDeliveryAbove}
              onChange={(e) => set("freeDeliveryAbove", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Handling charge (₹)</span>
            <input type="number" min="0" value={form.handlingFee}
              onChange={(e) => set("handlingFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Delivery radius (km)</span>
            <input type="number" min="0" value={form.maxDistanceKm}
              onChange={(e) => set("maxDistanceKm", e.target.value)} />
          </label>
        </div>
        <p className="delivery-hint">
          Orders more than <strong>{form.maxDistanceKm || 0} km</strong> from your
          shop see a “coming to your area soon” message. Set radius to 0 to deliver
          everywhere.
        </p>
        <div className="delivery-save">
          <button className="primary-btn" onClick={save}>Save charges</button>
          {saved && <span className="notify-sent">✅ Saved</span>}
        </div>
      </section>

      <section className="panel offer-card">
        <h3>Shop location</h3>
        <p className="sub">
          Used to measure how far customers are. Stand at {shop.name} and tap the
          button to pin it.
        </p>
        {shopLoc ? (
          <div className="shop-loc-set">
            <span>📍 Location set<br />
              <small>{shopLoc.lat}, {shopLoc.lng}</small>
            </span>
            <a className="view-map-link" href={googleMapsLink(shopLoc)}
              target="_blank" rel="noopener noreferrer">View on map →</a>
          </div>
        ) : (
          <div className="shop-loc-unset">📍 Shop location not set yet.</div>
        )}
        <button className="location-btn" onClick={setShopLocation} disabled={locating}>
          {locating ? "📍 Getting location…" : shopLoc ? "Update shop location" : "📍 Set shop location"}
        </button>
        {locError && <div className="auth-error">{locError}</div>}
      </section>
    </div>
  );
}
