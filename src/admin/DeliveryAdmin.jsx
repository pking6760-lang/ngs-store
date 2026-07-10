import { useState } from "react";
import { useSettings } from "../lib/hooks.js";
import { getShopLocations } from "../lib/store.js";
import { updateSettings } from "../lib/actions.js";
import { getCurrentLocation, googleMapsLink } from "../lib/location.js";

export default function DeliveryAdmin() {
  const settings = useSettings();
  const [form, setForm] = useState({
    deliveryFee: settings.deliveryFee,
    freeDeliveryAbove: settings.freeDeliveryAbove,
    handlingFee: settings.handlingFee,
    maxDistanceKm: settings.maxDistanceKm ?? 5,
  });
  const [saved, setSaved] = useState(false);

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

  return (
    <div className="offers-wrap">
      <section className="panel offer-card">
        <h3>Charges &amp; radius</h3>
        <p className="sub">Set what customers pay and how far you deliver.</p>
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
          Customers beyond <strong>{form.maxDistanceKm || 0} km</strong> of your
          nearest shop see a “coming to your area soon” message. Set radius to 0 to
          deliver everywhere.
        </p>
        <div className="delivery-save">
          <button className="primary-btn" onClick={save}>Save</button>
          {saved && <span className="notify-sent">✅ Saved</span>}
        </div>
      </section>

      <ShopLocations settings={settings} />
    </div>
  );
}

function ShopLocations({ settings }) {
  const locations = getShopLocations(settings);
  const [label, setLabel] = useState("");
  const [coords, setCoords] = useState({ lat: "", lng: "" });
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");

  async function useMyLocation() {
    setLocating(true);
    setError("");
    try {
      const loc = await getCurrentLocation();
      setCoords({ lat: loc.lat, lng: loc.lng });
    } catch (err) {
      setError(err.message);
    } finally {
      setLocating(false);
    }
  }

  function addLocation() {
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
      setError("Set a location first (tap “Use my current location”).");
      return;
    }
    const next = [
      ...locations.filter((l) => l.id !== "legacy" || true),
      { id: "s" + Math.random().toString(36).slice(2, 8), label: label.trim() || `Shop ${locations.length + 1}`, lat, lng },
    ];
    updateSettings({ shopLocations: next });
    setLabel("");
    setCoords({ lat: "", lng: "" });
    setError("");
  }

  function removeLocation(id) {
    updateSettings({ shopLocations: locations.filter((l) => l.id !== id) });
  }

  return (
    <section className="panel offer-card">
      <h3>Shop locations</h3>
      <p className="sub">
        Add each of your shops. Delivery is allowed within the radius of any one
        of them. Stand at the shop and tap “Use my current location”.
      </p>

      {locations.length === 0 ? (
        <div className="shop-loc-unset">📍 No shop location added yet.</div>
      ) : (
        <div className="shop-loc-list">
          {locations.map((l) => (
            <div className="shop-loc-row" key={l.id}>
              <span className="shop-loc-pin">📍</span>
              <div className="shop-loc-info">
                <div className="shop-loc-name">{l.label}</div>
                <a className="shop-loc-coords" href={googleMapsLink(l)}
                  target="_blank" rel="noopener noreferrer">
                  {l.lat}, {l.lng} · view on map
                </a>
              </div>
              <button className="shop-loc-del" onClick={() => removeLocation(l.id)}
                aria-label={`Remove ${l.label}`}>🗑️</button>
            </div>
          ))}
        </div>
      )}

      <div className="shop-loc-add">
        <input
          className="shop-loc-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name — e.g. Main shop, Branch 2"
        />
        <div className="shop-loc-coord-row">
          <button className="location-btn" onClick={useMyLocation} disabled={locating}>
            {locating ? "📍 Getting location…" : "📍 Use my current location"}
          </button>
          {coords.lat !== "" && (
            <span className="shop-loc-picked">✅ {coords.lat}, {coords.lng}</span>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-btn" onClick={addLocation}>+ Add this shop</button>
      </div>
    </section>
  );
}
