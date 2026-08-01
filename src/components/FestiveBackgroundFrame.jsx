// A festival ambient background authored as a small self-contained web page and
// delivered OVER-THE-AIR in the theme (theme.backgroundHtml). It runs inside a
// sealed sandbox iframe — allow-scripts only, no same-origin — so the animation
// paints freely but can never touch the app, its data, or the network.
//
// It sits fixed over the app as a transparent, click-through layer (the page
// stays fully usable), so a new festival's ambient motion ships with zero app
// updates: the code lives in the theme (edited + scheduled in Admin), not the
// build. Kept subtle by the prompt that generates it.
export default function FestiveBackgroundFrame({ html }) {
  if (!html) return null;
  return (
    <iframe
      title="Festival background"
      className="fest-bg-frame"
      srcDoc={html}
      sandbox="allow-scripts"
      scrolling="no"
      loading="eager"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
