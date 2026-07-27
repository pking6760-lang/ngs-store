import { useEffect, useMemo, useRef } from "react";
import ProductThumb from "./ProductThumb.jsx";
import { buildSuggestions, matchSplit, recentSearches, clearRecentSearches } from "../lib/search.js";

// The panel under the search box.
//
// It answers a different question from the results grid below it. The grid says
// "here is everything we have"; this says "is THIS what you meant?" — so it is
// short, it shows a picture and a price, and one tap goes straight to the item
// instead of to a page of items.
//
// Everything here is computed from the catalogue already in memory. No request
// goes out while someone is typing: on a weak signal that is the difference
// between suggestions that appear and suggestions that arrive after the customer
// has given up.
export default function SearchSuggest({
  query, products, categories, bought, onPick, onSearch, onCategory, onClose,
}) {
  const boxRef = useRef(null);
  const trimmed = (query || "").trim();

  const ctx = useMemo(() => ({ bought }), [bought]);
  const items = useMemo(
    () => (trimmed ? buildSuggestions({ products, categories, query: trimmed, ctx, limit: 6 }) : []),
    [trimmed, products, categories, ctx]
  );
  const recent = useMemo(() => (trimmed ? [] : recentSearches()), [trimmed]);
  const usual = useMemo(
    () => (trimmed ? [] : products.filter((p) => bought?.has(p.id)).slice(0, 6)),
    [trimmed, products, bought]
  );

  // Tapping the shop behind closes it. The search ROW counts as inside — tapping
  // the box you are typing in, or its clear button, must not dismiss the answers
  // you are reading.
  useEffect(() => {
    const onDown = (e) => {
      const row = boxRef.current?.closest(".header-searchrow");
      if (row && !row.contains(e.target)) onClose?.();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const nothing = trimmed ? items.length === 0 : recent.length === 0 && usual.length === 0;
  if (nothing) return null;

  return (
    <div className="sgst" ref={boxRef} role="listbox">
      {!trimmed && recent.length > 0 && (
        <>
          <div className="sgst-head">
            <span>Recent</span>
            <button type="button" onClick={() => { clearRecentSearches(); onClose?.(); }}>Clear</button>
          </div>
          {recent.map((r) => (
            <button type="button" className="sgst-row sgst-plain" key={`r-${r}`} onClick={() => onSearch(r)}>
              <span className="sgst-ic" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 7v5l3 2" /><circle cx="12" cy="12" r="9" /></svg>
              </span>
              <span className="sgst-txt">{r}</span>
            </button>
          ))}
        </>
      )}

      {!trimmed && usual.length > 0 && (
        <>
          <div className="sgst-head"><span>You buy this often</span></div>
          <div className="sgst-chips">
            {usual.map((p) => (
              <button type="button" className="sgst-chip" key={p.id} onClick={() => onPick(p)}>
                <ProductThumb image={p.image} name={p.name} category={p.category} size={26} />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {items.map((s, i) => {
        if (s.kind === "product") {
          const p = s.product;
          const [hit, rest] = matchSplit(p.name, trimmed);
          const out = p.inStock === false || (p.stock != null && p.stock <= 0);
          return (
            <button type="button" className="sgst-row" key={`p-${p.id}`} onClick={() => onPick(p)}>
              <span className="sgst-thumb">
                <ProductThumb image={p.image} name={p.name} category={p.category} size={34} />
              </span>
              <span className="sgst-txt">
                <span className="sgst-name"><b>{hit}</b>{rest}</span>
                <span className="sgst-sub">
                  {p.unit}
                  {bought?.has(p.id) && <em className="sgst-tag">bought before</em>}
                  {out && <em className="sgst-tag out">out of stock</em>}
                </span>
              </span>
              <span className="sgst-price">₹{p.price}</span>
            </button>
          );
        }
        if (s.kind === "brand") {
          return (
            <button type="button" className="sgst-row sgst-plain" key={`b-${s.text}-${i}`}
              onClick={() => onSearch(s.text)}>
              <span className="sgst-ic" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              </span>
              <span className="sgst-txt">{s.text}</span>
              <span className="sgst-count">{s.count} items</span>
            </button>
          );
        }
        return (
          <button type="button" className="sgst-row sgst-plain" key={`c-${s.category.id}`}
            onClick={() => onCategory(s.category)}>
            <span className="sgst-ic" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
            </span>
            <span className="sgst-txt">{s.category.name}</span>
            <span className="sgst-count">{s.count} items</span>
          </button>
        );
      })}

      {trimmed && items.length > 0 && (
        <button type="button" className="sgst-all" onClick={() => onSearch(trimmed)}>
          See all results for “{trimmed}”
        </button>
      )}
    </div>
  );
}
