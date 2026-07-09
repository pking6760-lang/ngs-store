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
