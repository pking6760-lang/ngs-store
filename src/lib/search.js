// Search: ranking, spelling tolerance and suggestions.
//
// The old search was `name.includes(query)` with the results in whatever order
// the sort happened to give. That has two problems a shopkeeper feels
// immediately: typing "oil" put a random oil first instead of the one people
// actually buy, and typing "aata" found nothing at all — because the packet says
// "Atta". In Sultanpur people type what they say, in whichever spelling comes to
// mind, on a phone keyboard, in a hurry. A search that only matches exact
// letters is a search that says "no results" to a real customer holding money.
//
// So this file does three things:
//   1. FOLDS spelling so aata/atta, doodh/dudh, cheeni/chini, zeera/jeera and
//      maggie/maggi all land on the same key.
//   2. RANKS matches, because being found is not the same as being found first.
//   3. Builds SUGGESTIONS while typing, from the catalogue we already have in
//      memory — no network call, so it stays instant on a weak signal and costs
//      nothing.
//
// It is deliberately plain functions with no React and no imports: the logic can
// be checked on its own, which matters for the part that decides what a customer
// sees when they type the name of something we sell.

/* ── Spelling ────────────────────────────────────────────────────────────── */

// Strip everything that is not a letter or a number.
export function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Fold a word to the way it SOUNDS, so the spellings people actually type all
// meet in the same place. Applied to the catalogue and the query alike, so it
// can never make one side match something the other side cannot.
//
//   aata, atta      → ata        doodh, dudh   → dudh
//   cheeni, chini   → chini      zeera, jeera  → jira
//   maggie, maggi   → magi       coke, cok     → cok
export function fold(word) {
  let w = String(word || "").toLowerCase();
  w = w
    .replace(/ph/g, "f")     // phal → fal
    .replace(/ck/g, "k")     // snack → snak
    .replace(/ee/g, "i")     // cheeni → chini
    .replace(/oo/g, "u")     // doodh → dudh
    .replace(/aa/g, "a")     // aata → ata
    .replace(/ie/g, "i")     // maggie → maggi
    .replace(/z/g, "j")      // zeera → jeera
    .replace(/w/g, "v")      // wada → vada
    .replace(/c([aou])/g, "k$1")  // biscuit → biskuit, cola → kola
    .replace(/c/g, "s");     // remaining c reads as s (rice → rise)
  w = w.replace(/(.)\1+/g, "$1");   // maggi → magi, atta → ata
  w = w.replace(/e$/, "");          // coke → cok
  return w;
}

export function tokens(s) {
  return norm(s).split(" ").filter(Boolean);
}
const foldAll = (s) => tokens(s).map(fold);

// One edit apart — a slipped finger, a doubled letter, a missing one.
// Only used as a last resort, and only on words long enough for it to mean
// something: at three letters everything is one edit from everything.
export function within1(a, b) {
  if (a === b) return true;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  if (t.length - s.length > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < s.length && j < t.length) {
    if (s[i] === t[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (s.length === t.length) { i++; j++; } else { j++; }
  }
  return edits + (t.length - j) + (s.length - i) <= 1;
}

/* ── Ranking ─────────────────────────────────────────────────────────────── */

// A searchable form of a product, built once and cached on the object. The
// catalogue is re-fetched rarely, so this is computed a few times a session
// rather than on every keystroke.
function indexOf(p) {
  if (p.__sx && p.__sxName === p.name) return p.__sx;
  const nameTokens = tokens(p.name);
  const sx = {
    name: norm(p.name),
    nameFolded: nameTokens.map(fold),
    nameFoldedJoined: nameTokens.map(fold).join(""),
    tags: (p.tags || []).map(norm),
    // Tags are phrases — "chane ka atta", "cold drink". Kept BOTH ways: the
    // individual words, so "atta" finds it, and the whole phrase, so "cold
    // drink" does too. Folding a phrase into one blob loses the first entirely.
    tagWords: [...new Set((p.tags || []).flatMap((t) => foldAll(t)))],
    tagPhrases: (p.tags || []).map((t) => foldAll(t).join(" ")),
  };
  try { Object.defineProperty(p, "__sx", { value: sx, writable: true, enumerable: false });
        Object.defineProperty(p, "__sxName", { value: p.name, writable: true, enumerable: false }); }
  catch { /* frozen object — just recompute next time */ }
  return sx;
}

// How well one product answers one word of the query. Zero means "not an
// answer" — the caller drops the product entirely, because a search that
// returns nearly everything is the same as a search that returns nothing.
function scoreWord(p, word) {
  const sx = indexOf(p);
  const f = fold(word);
  if (!f) return 0;

  // The name, in the order a person reads it.
  if (sx.nameFolded[0] === f) return 100;                       // exact first word
  if (sx.nameFolded[0]?.startsWith(f)) return 90;               // "fortu" → Fortune
  if (sx.nameFolded.some((w) => w === f)) return 80;            // exact, later word
  if (sx.nameFolded.some((w) => w.startsWith(f))) return 70;    // starts a later word
  // Matching in the MIDDLE of a word needs length behind it. Three letters
  // inside a longer word is not a search, it is a coincidence: "ata" sits inside
  // "khatta meetha", which is not what anyone typing "aata" wants.
  if (f.length >= 4 && sx.nameFoldedJoined.includes(f)) return 45;

  // Tags: the Hinglish and alternate names the owner typed in by hand.
  if (sx.tagWords.some((t) => t === f)) return 65;
  if (sx.tagWords.some((t) => t.startsWith(f))) return 55;
  if (f.length >= 4 && sx.tagPhrases.some((t) => t.includes(f))) return 35;

  // Last resort: one slipped letter. Five letters and up, because at four a
  // wrong word is one edit from a right one — "magi" reaches "magic", and a
  // customer looking for Maggi is better served by an honest "we don't have it"
  // than by a fruit juice.
  if (f.length >= 5 && sx.nameFolded.some((w) => within1(w, f))) return 25;
  if (f.length >= 5 && sx.tagWords.some((t) => within1(t, f))) return 20;
  return 0;
}

// What the shop knows that the letters do not.
function contextBoost(p, ctx) {
  let b = 0;
  const outOfStock = p.inStock === false || (p.stock != null && p.stock <= 0);
  // Still shown — a customer looking for it deserves to know we stock it at all,
  // and there is a "tell me when it's back" button on the card. Just never above
  // something they can actually buy.
  if (outOfStock) b -= 500;
  if (ctx?.bought?.has(p.id)) b += 30;   // they have bought this before
  if (p.hot) b += 8;                     // sells fast
  if (p.bait) b += 4;                    // on a real discount
  return b;
}

// Ranked matches for a query. Every word has to be answered by the product —
// "fortune oil" must not return every oil in the shop.
export function rankProducts(products, query, ctx) {
  const words = tokens(query);
  if (!words.length) return [];
  const out = [];
  for (const p of products) {
    let total = 0, ok = true;
    for (const w of words) {
      const s = scoreWord(p, w);
      if (!s) { ok = false; break; }
      total += s;
    }
    if (!ok) continue;
    // A short name matching is a more precise answer than a long one: for
    // "milk", "Amul Milk" beats "Britannia Winking Cow Chocolate Thick Shake".
    total += contextBoost(p, ctx) - Math.min(indexOf(p).name.length, 60) / 20;
    out.push({ p, score: total });
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((x) => x.p);
}

/* ── Did you mean ────────────────────────────────────────────────────────── */

// Only offered when the search found nothing. Looks for a real product word one
// edit away from what was typed, and suggests the word people would recognise.
export function didYouMean(products, query) {
  const words = tokens(query);
  if (!words.length) return null;
  const target = words[words.length - 1];
  if (target.length < 4) return null;
  const seen = new Map();
  for (const p of products) {
    for (const w of tokens(p.name)) {
      if (w.length < 4) continue;
      if (within1(fold(w), fold(target)) && fold(w) !== fold(target)) {
        seen.set(w, (seen.get(w) || 0) + 1);
      }
    }
    for (const t of (p.tags || [])) {
      const tw = norm(t);
      if (tw.length >= 4 && within1(fold(tw), fold(target)) && fold(tw) !== fold(target)) {
        seen.set(tw, (seen.get(tw) || 0) + 1);
      }
    }
  }
  if (!seen.size) return null;
  const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return words.slice(0, -1).concat(best).join(" ");
}

/* ── Suggestions ─────────────────────────────────────────────────────────── */

// Brands worth offering as their own row — "Fortune" when someone types "fortu"
// — taken from the first word of product names. Only when the brand covers more
// than one product, otherwise the product row already says it.
function brandSuggestions(matches, word) {
  const byBrand = new Map();
  for (const p of matches) {
    const first = tokens(p.name)[0];
    if (!first || !fold(first).startsWith(fold(word))) continue;
    // Show the brand the way it is written on the packet, not the lowercased
    // form the matcher works in.
    const key = (String(p.name).trim().split(/\s+/)[0] || first).replace(/[^\w&'-]/g, "");
    byBrand.set(key, (byBrand.get(key) || 0) + 1);
  }
  return [...byBrand.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name, n]) => ({ kind: "brand", text: name, count: n }));
}

// What to show under the box while someone is typing.
//
// Products first, because a customer is looking for a thing, not a word. Then
// the brand and the category, which is how you widen a search rather than
// narrow it. Capped hard: a list longer than the phone is a list nobody reads.
export function buildSuggestions({ products, categories = [], query, ctx, limit = 6 }) {
  const q = norm(query);
  if (!q) return [];
  const matches = rankProducts(products, q, ctx);
  const words = tokens(q);
  const last = words[words.length - 1];

  const out = matches.slice(0, limit).map((p) => ({ kind: "product", product: p }));

  // Only offer the brand row when one of the products already shown belongs to
  // it — otherwise it sends the customer somewhere they cannot see the reason for.
  for (const b of brandSuggestions(matches, last)) {
    const shown = out.some((s) => s.kind === "product"
      && tokens(s.product.name)[0] === norm(b.text));
    if (shown) out.push(b);
  }

  const cats = categories.filter((c) => {
    const cf = foldAll(c.name);
    return words.every((w) => cf.some((x) => x.startsWith(fold(w))));
  }).slice(0, 2);
  for (const c of cats) {
    out.push({ kind: "category", category: c, count: matches.filter((p) => p.category === c.id).length });
  }
  return out;
}

/* ── Recent searches ─────────────────────────────────────────────────────── */

const RECENT_KEY = "ngs_recent_searches";
const RECENT_MAX = 6;

export function recentSearches() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((s) => typeof s === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function rememberSearch(query) {
  const q = String(query || "").trim();
  if (q.length < 2) return;
  try {
    const list = [q, ...recentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase())];
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch { /* private mode — searches just aren't remembered */ }
}

export function clearRecentSearches() {
  try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
}

/* ── Highlighting ────────────────────────────────────────────────────────── */

// Split a name into [matched, rest] so the typed part can be shown solid and the
// rest lighter — the reader sees instantly why this row is here. Works on the
// folded form, so it still highlights when the spelling differs from the label.
export function matchSplit(name, query) {
  const words = tokens(query);
  if (!words.length) return [name, ""];
  const nameWords = tokens(name);
  const first = fold(words[0]);
  // Highlight up to the end of the name word the first query word lands on.
  let consumed = 0;
  for (let i = 0; i < nameWords.length; i++) {
    const nf = fold(nameWords[i]);
    consumed = name.toLowerCase().indexOf(nameWords[i], consumed);
    if (consumed < 0) break;
    if (nf.startsWith(first) || first.startsWith(nf)) {
      // Match the typed letters as they appear in the label, not the folded form.
      const take = Math.min(words[0].length, nameWords[i].length);
      return [name.slice(0, consumed + take), name.slice(consumed + take)];
    }
    consumed += nameWords[i].length;
  }
  return [name, ""];
}
