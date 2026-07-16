import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useSettings } from "../lib/hooks.js";
import { getShopLocations } from "../lib/store.js";
import { searchAddress, getCurrentLocation, reverseGeocode } from "../lib/location.js";
import * as api from "../lib/api.js";
import MapPicker from "./MapPicker.jsx";

const I = {
  home: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  work: <><rect x="3" y="8" width="18" height="12" rx="2" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></>,
  other: <><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M20 6 9 17l-5-5" />,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  trash: <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />,
  pin: <><path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  back: <path d="M15 18l-6-6 6-6" />,
};
function Ic({ d, size = 18, sw = 1.8 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{d}</svg>;
}

const LABELS = [
  { id: "home", name: "Home", d: I.home },
  { id: "work", name: "Work", d: I.work },
  { id: "other", name: "Other", d: I.other },
];
const labelOf = (id) => LABELS.find((l) => l.id === id) || LABELS[2];

// Manage delivery addresses — pick the active one, add new (with Home/Work/Other
// label + optional map pin), or edit/delete. Selecting one updates the header +
// checkout via profiles.address (kept in sync server-side).
export default function AddressSheet({ open, onClose }) {
  const { applyRewards } = useAuth(); // refresh() alias — reloads the active address
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState("list"); // "list" | "form"
  const [editing, setEditing] = useState(null);

  useBackGuard(open, () => (mode === "form" ? setMode("list") : onClose()));

  async function load() {
    setLoading(true);
    try { setList(await api.fetchMyAddresses()); } catch { /* keep prior */ }
    setLoading(false);
  }
  useEffect(() => { if (open) { setMode("list"); setEditing(null); load(); } }, [open]);

  async function select(a) {
    try { await api.setDefaultAddress(a.id); await applyRewards?.(); onClose(); }
    catch (e) { alert(e.message || "Couldn't set the address."); }
  }
  async function remove(a) {
    if (!window.confirm("Delete this address?")) return;
    try { await api.deleteAddress(a.id); await applyRewards?.(); load(); }
    catch (e) { alert(e.message || "Couldn't delete."); }
  }

  if (!open) return null;

  return createPortal(
    <div className="sheet-overlay" onClick={onClose}>
      <div className="addr-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="addr-head">
          {mode === "form" ? (
            <button className="addr-back" onClick={() => setMode("list")} aria-label="Back"><Ic d={I.back} size={20} /></button>
          ) : null}
          <h3>{mode === "form" ? (editing ? "Edit address" : "Add address") : "Delivery address"}</h3>
          <button className="addr-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {mode === "list" ? (
          <div className="addr-body">
            <button className="addr-add" onClick={() => { setEditing(null); setMode("form"); }}>
              <span className="addr-add-ic"><Ic d={I.plus} size={18} sw={2.4} /></span>
              Add a new address
            </button>

            {loading && list.length === 0 ? (
              <p className="addr-empty">Loading…</p>
            ) : list.length === 0 ? (
              <p className="addr-empty">No saved addresses yet. Add one to get started.</p>
            ) : (
              <div className="addr-list">
                <div className="addr-list-lbl">Saved addresses</div>
                {list.map((a) => {
                  const L = labelOf(a.label);
                  return (
                    <div key={a.id} className={`addr-card ${a.isDefault ? "on" : ""}`}>
                      <button className="addr-card-main" onClick={() => select(a)}>
                        <span className="addr-card-ic"><Ic d={L.d} size={19} /></span>
                        <span className="addr-card-txt">
                          <span className="addr-card-name">{L.name}{a.isDefault && <span className="addr-badge">Current</span>}</span>
                          <span className="addr-card-line">{a.address}</span>
                        </span>
                        {a.isDefault && <span className="addr-card-check"><Ic d={I.check} size={16} sw={2.4} /></span>}
                      </button>
                      <div className="addr-card-actions">
                        <button onClick={() => { setEditing(a); setMode("form"); }} aria-label="Edit"><Ic d={I.edit} size={16} /></button>
                        <button onClick={() => remove(a)} aria-label="Delete"><Ic d={I.trash} size={16} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <AddressForm
            editing={editing}
            onDone={async () => { await applyRewards?.(); setMode("list"); load(); }}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

function AddressForm({ editing, onDone }) {
  const settings = useSettings();
  const [label, setLabel] = useState(editing?.label || "home");
  const [address, setAddress] = useState(editing?.address || "");
  const [location, setLocation] = useState(editing?.location || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [map, setMap] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const searchTimer = useRef(null);

  // One tap → capture the customer's exact GPS spot and fill the address.
  async function useMyLocation() {
    setLocating(true); setErr("");
    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
      try {
        const a = await reverseGeocode(loc.lat, loc.lng);
        if (a) setAddress(a);
      } catch { /* keep coords even if the label lookup fails */ }
      setSuggestions([]);
    } catch (e) {
      setErr(e.message || "Couldn't get your location.");
    } finally { setLocating(false); }
  }

  // As the customer types their address, look up matching places on the map
  // (debounced). Picking one captures its exact coordinates, so the delivery
  // partner can navigate and the customer's live map works.
  function onAddressChange(value) {
    setAddress(value);
    setErr("");
    // Keep any captured pin as the customer refines the text (e.g. adds a flat
    // number) — appending detail shouldn't drop the coordinates they picked.
    clearTimeout(searchTimer.current);
    if (value.trim().length < 3) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const shop = getShopLocations(settings)[0];
        const res = await searchAddress(value, shop ? { lat: shop.lat, lng: shop.lng } : null);
        setSuggestions(res);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 500);
  }

  // Customer picks a place → fill the address and capture its coordinates.
  function pickSuggestion(s) {
    setAddress(s.label);
    setLocation({ lat: s.lat, lng: s.lng });
    setSuggestions([]);
    setErr("");
  }

  async function save() {
    if (!address.trim()) { setErr("Please enter your address."); return; }
    setBusy(true); setErr("");
    try {
      if (editing) await api.updateAddress(editing.id, { label, address: address.trim(), location });
      else await api.addAddress({ label, address: address.trim(), location, makeDefault: true });
      onDone();
    } catch (e) {
      setErr(e.message || "Couldn't save. Please try again."); setBusy(false);
    }
  }

  return (
    <div className="addr-body">
      <div className="addr-form-lbl">Save as</div>
      <div className="addr-chips">
        {LABELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`addr-chip ${label === l.id ? "on" : ""}`}
            onClick={() => setLabel(l.id)}
          >
            <Ic d={l.d} size={16} /> {l.name}
          </button>
        ))}
      </div>

      <button type="button" className="gps-hero" onClick={useMyLocation} disabled={locating}>
        <span className="gps-hero-ic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </span>
        <span className="gps-hero-txt">
          <strong>{locating ? "Getting your location…" : "Use my current location"}</strong>
          <small>Fastest &amp; most accurate — one tap</small>
        </span>
      </button>

      <div className="loc-or"><span>or type it below</span></div>

      <label className="addr-field">
        <span>Full address</span>
        <div className="address-autocomplete">
          <textarea
            rows={3}
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="House / flat no, building, street, area, landmark"
          />
          {(searching || suggestions.length > 0) && (
            <div className="address-suggest">
              {searching && suggestions.length === 0 && (
                <div className="address-suggest-loading">Searching the map…</div>
              )}
              {suggestions.map((s, i) => (
                <button
                  type="button"
                  className="address-suggest-item"
                  key={i}
                  onClick={() => pickSuggestion(s)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </label>

      <button type="button" className="addr-pin" onClick={() => setMap(true)}>
        <span className="addr-pin-ic"><Ic d={I.pin} size={17} /></span>
        <span>
          <strong>Or pin your exact location on the map</strong>
          <small>Helps the delivery partner reach you faster</small>
        </span>
      </button>

      {location && (
        <div className="addr-captured">
          <Ic d={I.check} size={15} sw={2.4} /> Location captured — delivery can reach this spot
        </div>
      )}

      {err && <div className="auth-error">{err}</div>}

      <button className="checkout-btn" onClick={save} disabled={busy}>
        {busy ? "Saving…" : editing ? "Save changes" : "Save address"}
      </button>

      <MapPicker
        open={map}
        initial={location}
        onClose={() => setMap(false)}
        onConfirm={(lat, lng, addr) => {
          setLocation({ lat, lng });
          if (addr && !address.trim()) setAddress(addr);
          else if (addr) setAddress(addr);
          setMap(false);
        }}
      />
    </div>
  );
}
