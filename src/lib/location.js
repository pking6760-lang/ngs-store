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

// A Google Maps link that opens a pin at the given coordinates — works on the
// web and deep-links into the Google Maps app on a phone.
export function googleMapsLink({ lat, lng }) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
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
