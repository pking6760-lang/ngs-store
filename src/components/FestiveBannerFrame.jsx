// Renders a festival banner that was authored as a small self-contained web page
// and delivered OVER-THE-AIR in the theme (theme.bannerHtml). It runs inside a
// sealed sandbox iframe — allow-scripts only, no same-origin — so the animation
// code can paint freely but can never touch the app, its data, or the network.
//
// This is what lets a new festival banner ship with zero app updates: the code
// lives in the theme (edited + scheduled in Admin), not in the build.
export default function FestiveBannerFrame({ html }) {
  if (!html) return null;
  return (
    <div className="fest-frame">
      <iframe
        title="Festival banner"
        className="fest-frame-if"
        srcDoc={html}
        sandbox="allow-scripts"
        scrolling="no"
        loading="eager"
      />
    </div>
  );
}
