// Clean line icons for the storefront categories (no emoji). Maps a category id
// to a recognisable glyph; unknown/admin-added categories fall back to a tag.
const PATHS = {
  "dairy-bread": (
    <><path d="M9 2h6M10 2v2.5L8 8v12a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8l-2-3.5V2" /><path d="M8 11h8" /></>
  ),
  snacks: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="15" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  beverages: (
    <><path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 8z" /><path d="M10 8l1-5M15 5l-1 3" /></>
  ),
  instant: (
    <><path d="M3 11h18a9 9 0 0 1-18 0z" /><path d="M8 11c0-3 1.5-5 4-5M12 6V3" /></>
  ),
  bakery: (
    <><path d="M6 11h12l-1.4 8a1 1 0 0 1-1 .9H8.4a1 1 0 0 1-1-.9L6 11z" /><path d="M7 11a5 5 0 0 1 10 0M12 4v2" /></>
  ),
  personal: <path d="M12 3s6 6.5 6 10.5a6 6 0 0 1-12 0C6 9.5 12 3 12 3z" />,
  household: (
    <><path d="M10 9h4a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" /><path d="M10 9V6h3V4M13 6l3.5-1.2M13 4l3-1" /></>
  ),
  default: (
    <><path d="M20 12l-8 8-9-9V4h7l10 10-1 1z" /><circle cx="7.5" cy="7.5" r="1.3" /></>
  ),
};

export default function CategoryIcon({ id, size = 26 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[id] || PATHS.default}
    </svg>
  );
}
