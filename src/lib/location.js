// Capture the customer's current location using the browser's Geolocation API.
// Returns a promise that resolves to { lat, lng, accuracy } or rejects with a
// friendly message. This powers "track where the order came from".
export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location isn't supported on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        resolve({
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
          accuracy: Math.round(accuracy),
        });
      },
      (err) => {
        const messages = {
          1: "Location permission denied. Please allow location access.",
          2: "Couldn't determine your location. Try again.",
          3: "Location request timed out. Try again.",
        };
        reject(new Error(messages[err.code] || "Couldn't get your location."));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
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
