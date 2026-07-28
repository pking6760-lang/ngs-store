// Capture the current location. On the native Android app we use the Capacitor
// Geolocation plugin so Android's runtime permission dialog actually shows and
// the OS location service is used; on the web (the customer preview) we fall
// back to the browser's Geolocation API. Resolves to { lat, lng, accuracy } or
// rejects with a friendly message. Powers "track where the order came from" and
// the admin "use my current location" shop pin.
function shape(latitude, longitude, accuracy) {
  return {
    lat: Number(latitude.toFixed(6)),
    lng: Number(longitude.toFixed(6)),
    accuracy: accuracy == null ? null : Math.round(accuracy),
  };
}

const BROWSER_MESSAGES = {
  1: "Location permission denied. Please allow location access.",
  2: "Couldn't determine your location. Try again.",
  3: "Location request timed out. Try again.",
};

function browserLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location isn't supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        resolve(shape(latitude, longitude, accuracy));
      },
      (err) =>
        reject(
          new Error(BROWSER_MESSAGES[err.code] || "Couldn't get your location.")
        ),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

async function nativeLocation() {
  const { Geolocation } = await import("@capacitor/geolocation");
  // Ask for permission first — this is what triggers Android's system dialog.
  let perm = await Geolocation.checkPermissions();
  if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
    perm = await Geolocation.requestPermissions({ permissions: ["location"] });
  }
  if (perm.location === "denied" && perm.coarseLocation === "denied") {
    throw new Error(
      "Location permission denied. Enable it in Settings › Apps › NGS › Permissions."
    );
  }
  const pos = await Geolocation.getCurrentPosition({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });
  const { latitude, longitude, accuracy } = pos.coords;
  return shape(latitude, longitude, accuracy);
}

export async function getCurrentLocation() {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) {
    return nativeLocation();
  }
  return browserLocation();
}

// Continuously watch the device location and call cb({lat,lng,accuracy}) on each
// update. Returns a Promise<function> — call it to stop watching. Used by the
// partner app to stream a rider's live position during a delivery.
export async function watchLocation(cb) {
  const cap = typeof window !== "undefined" ? window.Capacitor : null;
  const isNative = cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform();
  if (isNative) {
    const { Geolocation } = await import("@capacitor/geolocation");
    let perm = await Geolocation.checkPermissions();
    if (perm.location !== "granted" && perm.coarseLocation !== "granted") {
      perm = await Geolocation.requestPermissions({ permissions: ["location"] });
    }
    const id = await Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 20000 }, (pos, err) => {
      if (err || !pos) return;
      const { latitude, longitude, accuracy } = pos.coords;
      cb(shape(latitude, longitude, accuracy));
    });
    return () => { try { Geolocation.clearWatch({ id }); } catch { /* ignore */ } };
  }
  if (!("geolocation" in navigator)) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      cb(shape(latitude, longitude, accuracy));
    },
    () => {},
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
  );
  return () => navigator.geolocation.clearWatch(id);
}

// A Google Maps link that opens a pin at the given coordinates — works on the
// web and deep-links into the Google Maps app on a phone.
export function googleMapsLink({ lat, lng }) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

// Ask our server (which holds the Ola key) to turn coordinates into an address.
// Returns a string, or null when the server isn't configured / errored — same
// fall-back signal as the search path.
async function googleReverse(lat, lng) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const res = await fetch(`${url}/functions/v1/places-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ reverse: true, lat, lng }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.address === "string" && data.address ? data.address : null;
  } catch { return null; }
}

// Turn GPS coordinates into a human-readable street address — used by "Use my
// current location" and the map pin. Ola first (correct pincode, real road
// names), OpenStreetMap Nominatim as the free fallback. Returns "" if neither
// can resolve it; the customer can still edit the result (e.g. add flat no).
export async function reverseGeocode(lat, lng) {
  const g = await googleReverse(lat, lng);
  if (g) return g;

  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Couldn't look up your address.");
  const data = await res.json();
  const a = data.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const parts = [
    street,
    a.neighbourhood || a.suburb || a.residential || a.hamlet,
    a.city || a.town || a.village || a.municipality || a.county,
    a.state,
    a.postcode,
  ].filter(Boolean);
  // De-duplicate consecutive repeats (Nominatim sometimes repeats a name).
  const clean = parts.filter((v, i) => v !== parts[i - 1]);
  return clean.join(", ") || data.display_name || "";
}

// Build a concise, human-readable label from a Nominatim address object.
function nominatimLabel(item) {
  const a = item.address || {};
  const lead =
    item.name ||
    [a.house_number, a.road].filter(Boolean).join(" ") ||
    a.neighbourhood || a.suburb;
  const parts = [
    lead,
    a.neighbourhood || a.suburb || a.residential || a.hamlet,
    a.city || a.town || a.village || a.municipality || a.city_district || a.county,
    a.postcode,
  ].filter(Boolean);
  // Drop consecutive repeats (e.g. lead == suburb).
  const clean = parts.filter((v, i) => v !== parts[i - 1]);
  return clean.join(", ") || item.display_name || "";
}

// Google Places — the only source that has local landmarks (a village chaupal,
// a named gali) the way the customer's Google Maps does. The API key is never
// in the app; this calls our own `places-search` edge function, which holds the
// key server-side. Returns a list (possibly empty) from Google, or null when
// the server isn't configured or errored.
async function googlePlaces(query, bias) {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const body = { q: query };
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    body.lat = bias.lat; body.lng = bias.lng;
  }
  try {
    const res = await fetch(`${url}/functions/v1/places-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // items === null means "not configured / upstream error" → fall back.
    return data && "items" in data ? data.items : null;
  } catch { return null; }
}

// Address autocomplete: as the customer types, return matching places (with
// coordinates) so they can pick their location on the "map" without granting
// GPS permission. Tries Google Places first (has the local landmarks), then
// falls back to free OpenStreetMap (Nominatim, then Photon) if Google isn't
// configured or is down. `bias` is an optional {lat,lng} (e.g. the shop) — used
// to prefer nearby places and rank the way a maps app would, instead of
// returning same-named places in other cities.
export async function searchAddress(query, bias) {
  const q = (query || "").trim();
  if (q.length < 3) return [];

  // Google first — it's the only one with the chaupal-level landmarks. If it
  // finds anything, use it. If it finds nothing (or isn't configured), fall
  // through to the free OpenStreetMap sources rather than showing an empty box.
  const g = await googlePlaces(q, bias);
  if (Array.isArray(g) && g.length) return g;

  const hasBias = bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng);
  let url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(q)}&addressdetails=1&limit=6&countrycodes=in`;
  if (hasBias) {
    // ~35 km box around the shop; bounded so far-away matches are excluded.
    const d = 0.32;
    const vb = [bias.lng - d, bias.lat - d, bias.lng + d, bias.lat + d].join(",");
    url += `&viewbox=${vb}&bounded=1`;
  }
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const out = (Array.isArray(data) ? data : [])
        .map((item) => ({
          label: nominatimLabel(item),
          lat: Number(item.lat),
          lng: Number(item.lon),
        }))
        .filter((s) => s.label && Number.isFinite(s.lat) && Number.isFinite(s.lng));
      // De-duplicate identical labels (Nominatim can repeat a place).
      const seen = new Set();
      const uniq = out.filter((s) => (seen.has(s.label) ? false : seen.add(s.label)));
      if (uniq.length) return uniq;
      // Bounded search found nothing local — retry once without the box.
      if (hasBias) return searchAddress(q, null);
    }
  } catch { /* fall through to Photon */ }
  // Fallback: Photon (different OSM index) if Nominatim is down or empty.
  return photonSearch(q, bias);
}

async function photonSearch(query, bias) {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en`;
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    url += `&lat=${bias.lat}&lon=${bias.lng}&zoom=13&location_bias_scale=0.9`;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features || [])
      .map((f) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry.coordinates;
        const label = [p.name, p.street, p.district, p.city || p.county, p.state, p.postcode]
          .filter(Boolean)
          .filter((v, i, arr) => v !== arr[i - 1])
          .join(", ");
        return { label, lat, lng };
      })
      .filter((s) => s.label);
  } catch { return []; }
}

// Straight-line distance between two {lat, lng} points, in kilometres.
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
