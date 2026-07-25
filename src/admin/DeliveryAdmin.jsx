import { useState } from "react";
import { Ic } from "./AdminIcons.jsx";
import { useSettings } from "../lib/hooks.js";
import { getShopLocations } from "../lib/store.js";
import { updateSettings } from "../lib/actions.js";
import { updateOpsConfig } from "../lib/api.js";
import { getCurrentLocation, googleMapsLink } from "../lib/location.js";

export default function DeliveryAdmin() {
  const settings = useSettings();
  const [form, setForm] = useState({
    deliveryFee: settings.deliveryFee,
    freeDeliveryAbove: settings.freeDeliveryAbove,
    handlingFee: settings.handlingFee,
    surgeFee: settings.surgeFee ?? 20,
    smallCartFee: settings.smallCartFee ?? 0,
    smallCartThreshold: settings.smallCartThreshold ?? 0,
    maxDistanceKm: settings.maxDistanceKm ?? 5,
    minOrderValue: settings.rewards?.minOrderValue ?? 0,
    walletMinOrder: settings.rewards?.walletMinOrder ?? 199,
    supportPhone: settings.supportPhone ?? "",
    cancelFee: settings.cancelFee ?? 20,
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
    setError("");
  }

  async function save() {
    try {
      // Charges are single-sourced in ops_config (a DB trigger mirrors them into
      // the customer `settings`), so these values always match what the customer
      // pays and what the partner payout engine reads. Radius stays in settings.
      await updateOpsConfig({
        delivery_fee: Math.max(0, Number(form.deliveryFee) || 0),
        free_delivery_threshold: Math.max(0, Number(form.freeDeliveryAbove) || 0),
        handling_fee: Math.max(0, Number(form.handlingFee) || 0),
        surge_fee: Math.max(0, Number(form.surgeFee) || 0),
        small_cart_fee: Math.max(0, Number(form.smallCartFee) || 0),
        small_cart_threshold: Math.max(0, Number(form.smallCartThreshold) || 0),
      });
      await updateSettings({
        maxDistanceKm: Math.max(0, Number(form.maxDistanceKm) || 0),
        cancelFee: Math.max(0, Number(form.cancelFee) || 0),
        supportPhone: (form.supportPhone || "").replace(/\D/g, "").slice(0, 10) || null,
        rewards: {
          ...(settings.rewards || {}),
          minOrderValue: Math.max(0, Number(form.minOrderValue) || 0),
          walletMinOrder: Math.max(0, Number(form.walletMinOrder) || 0),
        },
      });
      setSaved(true);
    } catch (e) {
      setError(e.message || "Couldn't save.");
    }
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
            <span>Minimum order value (₹)</span>
            <input type="number" min="0" value={form.minOrderValue}
              onChange={(e) => set("minOrderValue", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Wallet usable above (₹)</span>
            <input type="number" min="0" value={form.walletMinOrder}
              onChange={(e) => set("walletMinOrder", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Handling charge (₹)</span>
            <input type="number" min="0" value={form.handlingFee}
              onChange={(e) => set("handlingFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Surge charge (₹)</span>
            <input type="number" min="0" value={form.surgeFee}
              onChange={(e) => set("surgeFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Small cart charge (₹)</span>
            <input type="number" min="0" value={form.smallCartFee}
              onChange={(e) => set("smallCartFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>…on carts below (₹)</span>
            <input type="number" min="0" value={form.smallCartThreshold}
              onChange={(e) => set("smallCartThreshold", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Delivery radius (km)</span>
            <input type="number" min="0" value={form.maxDistanceKm}
              onChange={(e) => set("maxDistanceKm", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Cancellation fee (₹)</span>
            <input type="number" min="0" value={form.cancelFee}
              onChange={(e) => set("cancelFee", e.target.value)} />
          </label>
          <label className="dfield">
            <span>Store contact number</span>
            <input type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit number"
              value={form.supportPhone}
              onChange={(e) => set("supportPhone", e.target.value.replace(/\D/g, "").slice(0, 10))} />
          </label>
        </div>
        <p className="delivery-hint">
          The <strong>store contact number</strong> shows as a "Call store" button
          on the customer's live order screen, so they can reach you about an order.
        </p>
        <p className="delivery-hint">
          The <strong>small cart charge</strong> is added to every order whose
          items come to less than the amount beside it — Prime members included.
          A tiny basket costs the same to pick and ride out as a big one, so this
          covers it and nudges customers to add a little more. It's worked out on
          the item total <em>before</em> any coupon, so a discount can't be used
          to dodge it. Set the charge to 0 to switch it off.
        </p>
        <p className="delivery-hint">
          The <strong>cancellation fee</strong> is charged when a customer cancels
          after a short free window (≈90s) or once you've started packing. What
          they paid is refunded to their wallet minus this fee. Set to 0 to allow
          free cancellation.
        </p>
        <p className="delivery-hint">
          <strong>Wallet usable above</strong> is the smallest cart on which a
          customer can spend their NGS Wallet (referral bonus, change, refunds).
          Below it the wallet stays locked — this stops a ₹30 referral credit
          being burned on a tiny order that doesn't cover the delivery. Set to 0
          to allow wallet on any order.
        </p>
        <p className="delivery-hint">
          The <strong>surge charge</strong> is added to every order only while
          you turn on <strong>Surge</strong> (top bar) — for rain, peak hours
          or bad weather.
        </p>
        <p className="delivery-hint">
          Customers beyond <strong>{form.maxDistanceKm || 0} km</strong> of your
          nearest shop see a “coming to your area soon” message. Set radius to 0 to
          deliver everywhere.
        </p>
        <div className="delivery-save">
          <button className="primary-btn" onClick={save}>Save</button>
          {saved && <span className="notify-sent">Saved</span>}
          {error && <span className="auth-error">{error}</span>}
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
        <div className="shop-loc-unset">No shop location added yet.</div>
      ) : (
        <div className="shop-loc-list">
          {locations.map((l) => (
            <div className="shop-loc-row" key={l.id}>
              <span className="shop-loc-pin"></span>
              <div className="shop-loc-info">
                <div className="shop-loc-name">{l.label}</div>
                <a className="shop-loc-coords" href={googleMapsLink(l)}
                  target="_blank" rel="noopener noreferrer">
                  {l.lat}, {l.lng} · view on map
                </a>
              </div>
              <button className="shop-loc-del" onClick={() => removeLocation(l.id)}
                aria-label={`Remove ${l.label}`}><Ic name="trash" size={16} /></button>
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
            {locating ? "Getting location…" : "Use my current location"}
          </button>
          {coords.lat !== "" && (
            <span className="shop-loc-picked">{coords.lat}, {coords.lng}</span>
          )}
        </div>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-btn" onClick={addLocation}>+ Add this shop</button>
      </div>
    </section>
  );
}
