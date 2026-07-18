// Turn a picked photo file into a small, self-contained data URL.
// Photos are downscaled (and JPEG-compressed) so they stay tiny — important
// while everything is stored on-device in localStorage (no backend yet).
export function fileToResizedDataUrl(file, max = 600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) {
          height = Math.round((height * max) / width);
          width = max;
        } else if (height > max) {
          width = Math.round((width * max) / height);
          height = max;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Downscale + auto-compress to a JPEG Blob under a hard byte cap. Even a giant
// phone photo can't produce a big upload: we resize to `max` px, then keep
// lowering JPEG quality (and, if needed, the dimensions) until the result is
// under `maxBytes`. Uploaded to Storage — never base64 in the database.
export function fileToResizedBlob(file, max = 600, quality = 0.82, maxBytes = 150 * 1024) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That image couldn't be loaded."));
      img.onload = () => {
        const encode = (w, h, q) =>
          new Promise((res, rej) => {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(w));
            canvas.height = Math.max(1, Math.round(h));
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
              (b) => (b ? res(b) : rej(new Error("Couldn't process that image."))),
              "image/jpeg",
              q
            );
          });
        (async () => {
          try {
            let { width, height } = img;
            if (width > height && width > max) { height = (height * max) / width; width = max; }
            else if (height > max) { width = (width * max) / height; height = max; }
            let q = quality;
            let blob = await encode(width, height, q);
            // Step 1: drop quality toward 0.5 until under the cap.
            while (blob.size > maxBytes && q > 0.5) {
              q = Math.max(0.5, q - 0.1);
              blob = await encode(width, height, q);
            }
            // Step 2: still too big → shrink dimensions in 15% steps (down to 200px).
            while (blob.size > maxBytes && width > 200) {
              width *= 0.85; height *= 0.85;
              blob = await encode(width, height, q);
            }
            resolve(blob);
          } catch (e) { reject(e); }
        })();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Download an image by URL (e.g. an Open Food Facts product photo) and turn it
// into the same small, self-contained data URL a manual upload produces — so a
// barcode-filled product doesn't depend on an external CDN staying up. The
// remote host must allow cross-origin reads (Open-*-Facts sends
// `access-control-allow-origin: *`, so its images work).
export async function urlToResizedDataUrl(url, max = 600, quality = 0.82) {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error("Couldn't download that image.");
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) throw new Error("That wasn't an image.");
  return fileToResizedDataUrl(blob, max, quality);
}
