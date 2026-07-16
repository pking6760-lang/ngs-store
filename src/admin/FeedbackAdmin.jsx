import { useMemo } from "react";
import { useOrders } from "../lib/hooks.js";
import { useShowMore } from "../lib/useShowMore.js";

// Customer ratings & feedback, newest first — so the owner can see what people
// are saying about their orders.
export default function FeedbackAdmin() {
  const orders = useOrders();

  const rated = useMemo(
    () => orders.filter((o) => o.rating > 0).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [orders]
  );

  const summary = useMemo(() => {
    if (!rated.length) return null;
    const sum = rated.reduce((s, o) => s + o.rating, 0);
    const counts = [0, 0, 0, 0, 0];
    rated.forEach((o) => { counts[o.rating - 1] += 1; });
    return { avg: sum / rated.length, count: rated.length, counts };
  }, [rated]);

  const list = useShowMore(rated, 20);

  return (
    <div className="fb-wrap">
      {summary && (
        <section className="panel fb-summary">
          <div className="fb-avg">
            <div className="fb-avg-num">{summary.avg.toFixed(1)}</div>
            <div className="fb-avg-stars">{stars(Math.round(summary.avg))}</div>
            <div className="fb-avg-count">{summary.count} rating{summary.count > 1 ? "s" : ""}</div>
          </div>
          <div className="fb-bars">
            {[5, 4, 3, 2, 1].map((n) => (
              <div className="fb-bar-row" key={n}>
                <span className="fb-bar-n">{n}★</span>
                <div className="fb-bar-track">
                  <div
                    className="fb-bar-fill"
                    style={{ width: `${summary.count ? (summary.counts[n - 1] / summary.count) * 100 : 0}%` }}
                  />
                </div>
                <span className="fb-bar-c">{summary.counts[n - 1]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel no-pad">
        {rated.length === 0 ? (
          <p className="panel-empty" style={{ padding: 24 }}>No customer feedback yet.</p>
        ) : (
          <div className="fb-list">
            {list.shown.map((o) => (
              <div className="fb-item" key={o.id}>
                <div className="fb-item-top">
                  <span className="fb-stars">{stars(o.rating)}</span>
                  <span className="fb-item-meta">#{o.id} · {fmt(o.createdAt)}</span>
                </div>
                {o.feedback ? (
                  <p className="fb-text">“{o.feedback}”</p>
                ) : (
                  <p className="fb-text muted">No comment left.</p>
                )}
                <div className="fb-cust">{o.customer || "Customer"}{o.userPhone ? ` · ${o.userPhone}` : ""}</div>
              </div>
            ))}
            {list.more && (
              <button type="button" className="show-more-btn" onClick={list.toggle}>
                {list.label}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function stars(n) {
  return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
}

function fmt(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}
