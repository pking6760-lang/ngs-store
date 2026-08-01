# Festive Intro — AI generation prompt

Paste the prompt below into any capable AI (Claude, GPT, Gemini…), replacing
`{FESTIVAL}` with the occasion (e.g. *Independence Day*, *Diwali*, *Holi*,
*Raksha Bandhan*, *Dhanteras*, *Christmas*, *Eid*, *Makar Sankranti*…). It returns
ONE self-contained React file — a full-screen animated intro unique to that
festival.

**To install what it gives you:**
1. Save the file as `src/components/festive-intros/<id>.jsx`
   (use the theme's id, e.g. `independence-day.jsx`).
2. Open `src/components/festive-intros/registry.js` and add one line, e.g.
   `independence_day: () => import("./independence-day.jsx"),`
3. Rebuild the customer app. It now plays automatically when that festival's
   theme is live — once per customer per day, with tap-to-skip built in.

---

## The prompt

> You are a **senior motion designer and front-end engineer** creating a
> limited-time, **full-screen "festive intro" animation** for the customer app of
> **NGS — Nisha General Store**, a neighbourhood grocery-delivery shop in
> Sultanpur, New Delhi. This intro plays **once when a customer opens the app
> during a festival**: a brief, breathtaking, screen-covering moment that makes
> them *feel* the occasion — then it dissolves into the app.
>
> **The festival is: {FESTIVAL}.**
>
> ### Design intent
> Give this festival its **own soul**. Every festival must feel completely
> different — Independence Day must feel nothing like Diwali, which feels nothing
> like Holi. Study **this** festival's true visual language — its signature
> colours, symbols, rituals, materials, light and motion — and craft **one
> signature moment** built from them. Some starting sparks (invent your own if
> better, and never reuse another festival's idea):
> - *Independence Day / Republic Day* — three ribbons of saffron, white and green
>   sweeping in and settling; a flag rising and rippling; a soft chakra bloom;
>   "Jai Hind" as the peak.
> - *Diwali* — a row of diyas igniting one after another, warm embers drifting up,
>   a rangoli blooming outward in symmetry.
> - *Holi* — bursts of coloured powder blooming and raining down in the palette.
> - *Dhanteras* — gold coins cascading and catching light; a shimmer sweep.
> - *Raksha Bandhan* — a single rakhi thread drawing itself and tying into a bow.
> - *Christmas* — soft snow, a rising star, a gentle glow.
>
> Aim for the polish of a top app's festival campaign (Zomato / Swiggy / Blinkit
> at Diwali) — but **classier, calmer and more premium**: cohesive, culturally
> authentic, and confident. **Never gaudy, clip-arty, emoji-filled, or
> cluttered.** Restraint is luxury.
>
> ### Hard technical contract — follow exactly
> - Return **ONE React component file**, default export:
>   `export default function FestiveIntro({ theme, onDone }) { … }`
> - **Zero external libraries. Zero imports from the app.** Only React
>   (`useEffect`, `useRef`, `useState`). Draw all motion (particles, shapes,
>   light) by hand on a **single full-screen `<canvas>`**; render the greeting
>   text as overlaid DOM on top.
> - You are given `theme`:
>   ```
>   theme = {
>     name, greeting, kicker, subtitle,
>     colors: { primary, accent, deep, tint, bg, ink },  // hex strings
>     palette: [c1, c2, c3],        // the festival's 3 signature colours
>     reducedMotion: boolean
>   }
>   ```
>   **Drive every colour from `theme`** — never hard-code the festival's colours,
>   so the file re-skins cleanly if the palette is tweaked. Use `theme.greeting`
>   as the words (fallback to a tasteful default only if empty).
> - **Cover the whole screen**: `position: fixed; inset: 0;` at a high z-index
>   (e.g. 9000), over a tasteful backdrop derived from the theme.
> - **Timing:** run ~**2.6–3.2s**, build to the greeting as the emotional peak,
>   then **fade out gracefully and call `onDone()` exactly once**.
> - **Skip:** tapping/clicking anywhere calls `onDone()` immediately.
> - **Reduced motion:** if `theme.reducedMotion` is true, skip the animation —
>   show a still, elegant greeting for ~1.2s, then `onDone()`.
> - **Performance (mobile is the target — Android WebView):** hold **60fps on a
>   mid-range phone**. Size the canvas to `devicePixelRatio`; cap particle counts
>   sensibly; use `requestAnimationFrame`; **cancel the rAF and remove every
>   listener on unmount** (no leaks, no work after `onDone`). Avoid heavy
>   per-frame blur/shadow filters that stutter on phones.
> - **Accessibility:** the overlay has `role="dialog"` and an `aria-label` of the
>   greeting.
> - **Quality:** clean, production-ready code, self-contained in one file, with
>   short comments explaining the concept. Name things after {FESTIVAL}.
>
> **Return only the complete component code**, ready to paste as one `.jsx` file.
> Begin with a single top comment naming the festival and describing the
> animation concept in one line.
