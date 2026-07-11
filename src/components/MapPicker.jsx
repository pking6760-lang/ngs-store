import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getCurrentLocation, reverseGeocode } from "../lib/location.js";

// A full-screen map where the customer moves the map under a fixed centre pin
// to mark their EXACT delivery spot (accuracy comes from where they place it).
// Free — OpenStreetMap tiles, no API key. Returns { lat, lng, address }.
export default function MapPicker({ open, initial, onClose, onConfirm }) {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const centerRef = useRef(initial || { lat: 28.497, lng: 77.13 });
  const [addr, setAddr] = useState("");
  const [center, setCenter] = useState(centerRef.current);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!open || !mapEl.current) return;
    const start = initial || { lat: 28.497, lng: 77.13 };
    const map = L.map(mapEl.current, { zoomControl: true, attributionControl: false })
      .setView([start.lat, start.lng], 16);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    const onMove = () => {
      const c = map.getCenter();
      centerRef.current = { lat: c.lat, lng: c.lng };
      setCenter({ lat: c.lat, lng: c.lng });
    };
    map.on("moveend", onMove);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    // Try to jump to the customer's GPS on open (most accurate start).
    getCurrentLocation()
      .then((loc) => map.setView([loc.lat, loc.lng], 17))
      .catch(() => {});
    return () => { map.off("moveend", onMove); map.remove(); mapRef.current = null; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the address under the pin as the map moves (debounced).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      reverseGeocode(center.lat, center.lng).then(setAddr).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [center, open]);

  async function recenter() {
    setLocating(true);
    try {
      const loc = await getCurrentLocation();
      mapRef.current?.setView([loc.lat, loc.lng], 18);
    } catch { /* ignore */ } finally { setLocating(false); }
  }

  if (!open) return null;
  return (
    <div className="mappick-overlay">
      <div className="mappick">
        <div className="mappick-head">
          <button className="back-btn small" onClick={onClose} aria-label="Back">←</button>
          <h3>Set your exact delivery location</h3>
        </div>
        <div className="mappick-map-wrap">
          <div ref={mapEl} className="mappick-map" />
          <div className="mappick-pin" aria-hidden>📍</div>
          <button className="mappick-gps" onClick={recenter} disabled={locating}>
            {locating ? "Locating…" : "◎ My location"}
          </button>
        </div>
        <div className="mappick-foot">
          <div className="mappick-addr">
            <strong>Delivering here:</strong>
            <span>{addr || "Move the map so the pin is on your home"}</span>
          </div>
          <button
            className="checkout-btn"
            onClick={() => onConfirm(centerRef.current.lat, centerRef.current.lng, addr)}
          >
            Confirm this location
          </button>
        </div>
      </div>
    </div>
  );
}
