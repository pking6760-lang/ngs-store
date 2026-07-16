import { useState } from "react";

// Cap a long list to `initial` items with an expand/collapse toggle, so screens
// don't turn into an endless scroll. Returns the visible slice + a ready-made
// button descriptor (label + onClick) to render below the list.
export function useShowMore(items, initial = 8) {
  const [expanded, setExpanded] = useState(false);
  const list = Array.isArray(items) ? items : [];
  const shown = expanded ? list : list.slice(0, initial);
  const hidden = list.length - shown.length;
  return {
    shown,
    expanded,
    total: list.length,
    hidden,
    // true when there's anything to collapse/expand
    more: list.length > initial,
    label: expanded ? "Show less" : `Show all ${list.length}`,
    toggle: () => setExpanded((v) => !v),
  };
}
