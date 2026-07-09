import { categories } from "../data/products.js";

// Shows a product's photo. When there's no photo yet, shows a clean placeholder
// (the product's first letter on a soft colour) instead of an emoji.
const PALETTE = ["#e7f7e9", "#e6f0fb", "#fce8ec", "#fdf4e3", "#f3ecfb", "#e7f6f6", "#fdeae6", "#eef2e6"];

function colorFor(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function catColor(id) {
  return categories.find((c) => c.id === id)?.color || null;
}

export default function ProductThumb({
  image,
  name = "",
  category,
  size = 44,
  radius = 10,
  fill = false,
}) {
  const boxStyle = fill
    ? { width: "100%", height: "100%", borderRadius: radius }
    : { width: size, height: size, borderRadius: radius };

  if (image) {
    return (
      <img
        className="thumb-img"
        src={image}
        alt={name}
        style={{ ...boxStyle, objectFit: "cover" }}
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
