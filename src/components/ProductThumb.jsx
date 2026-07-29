import { useState } from "react";
import { getCategories } from "../lib/store.js";

// Shows a product's photo. When there's no photo yet, shows a clean placeholder
// (the product's first letter on a soft colour) instead of an emoji.
const PALETTE = ["#e7f7e9", "#e6f0fb", "#fce8ec", "#fdf4e3", "#f3ecfb", "#e7f6f6", "#fdeae6", "#eef2e6"];

function colorFor(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function catColor(id) {
  if (!id) return null;
  return getCategories().find((c) => c.id === id)?.color || null;
}

export default function ProductThumb({
  image,
  name = "",
  category,
  size = 44,
  radius = 10,
  fill = false,
}) {
  const [failed, setFailed] = useState(false);
  const boxStyle = fill
    ? { width: "100%", height: "100%", borderRadius: radius }
    : { width: size, height: size, borderRadius: radius };

  if (image && !failed) {
    return (
      <img
        className="thumb-img"
        src={image}
        alt={name}
        // Off-screen thumbnails don't block the first paint or the scroll:
        // the browser defers loading + decoding until they're near the viewport.
        loading="lazy"
        decoding="async"
        // A dead URL (deleted photo, offline) falls back to the lettered
        // placeholder instead of a blank/broken box.
        onError={() => setFailed(true)}
        // `contain` on white shows the whole product (no cropping) and blends
        // seamlessly with white-background catalog photos.
        style={{ ...boxStyle, objectFit: "contain", background: "#fff" }}
      />
    );
  }

  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const bg = catColor(category) || colorFor(name);
  return (
    <span
      className="thumb-ph"
      style={{ ...boxStyle, background: bg, fontSize: fill ? 42 : Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
