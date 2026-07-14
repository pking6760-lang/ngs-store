import { useMemo, useState } from "react";
import { useCustomers } from "../lib/hooks.js";
import { sendNotification, broadcastNotification } from "../lib/actions.js";

// Admin "Notify" screen — send a push to the customer inbox, either to EVERY
// customer at once or to one specific customer. The message lands in the bell /
// inbox on the customer app (ngsstore.in).
export default function NotifyAdmin() {
  const customers = useCustomers();
  const [audience, setAudience] = useState("all"); // 'all' | 'one'
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState(null); // selected customer for 'one'
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, msg }

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter(
        (c) =>
          (c.name || "").toLowerCase().includes(q) ||
          (c.email || "").toLowerCase().includes(q) ||
          (c.phone || "").toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [customers, query]);

  const canSend =
    title.trim().length > 0 && (audience === "all" || !!pick) && !busy;

  async function send(e) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    setResult(null);
    let r;
    if (audience === "all") {
      r = await broadcastNotification({ title, body });
    } else {
      r = await sendNotification({ userId: pick.id, title, body });
    }
    setBusy(false);
    if (r.ok) {
      const who =
        audience === "all"
          ? `all customers${typeof r.count === "number" ? ` (${r.count})` : ""}`
          : pick.name || "customer";
      setResult({ ok: true, msg: `✅ Sent to ${who}` });
      setTitle("");
      setBody("");
      if (audience === "one") {
        setPick(null);
        setQuery("");
      }
    } else {
      setResult({ ok: false, msg: r.error || "Could not send." });
    }
  }

  return (
    <section className="panel">
      <h3>Send a notification</h3>
      <p className="panel-sub">
        Drops straight into the customer’s bell / inbox on the app.
      </p>

      {/* Audience toggle */}
      <div className="seg-toggle" role="tablist">
        <button
          type="button"
          className={`seg ${audience === "all" ? "seg-on" : ""}`}
          onClick={() => {
            setAudience("all");
            setResult(null);
          }}
        >
          📣 All customers
        </button>
        <button
          type="button"
          className={`seg ${audience === "one" ? "seg-on" : ""}`}
          onClick={() => {
            setAudience("one");
            setResult(null);
          }}
        >
          👤 One customer
        </button>
      </div>

      <form className="notify-form" onSubmit={send}>
        {audience === "one" && (
          <div className="notify-picker">
            {pick ? (
              <div className="picked-row">
                <span>
                  📌 {pick.name || "Customer"}{" "}
                  <span className="muted">
                    {pick.phone || pick.email || ""}
                  </span>
                </span>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setPick(null);
                    setQuery("");
                  }}
                >
                  change
                </button>
              </div>
            ) : (
              <>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search customer by name, phone or email…"
                />
                <div className="pick-list">
                  {matches.length === 0 && (
                    <div className="pick-empty">No match.</div>
                  )}
                  {matches.map((c) => (
                    <button
                      type="button"
                      key={c.id}
                      className="pick-item"
                      onClick={() => setPick(c)}
                    >
                      <b>{c.name || "Customer"}</b>
                      <span className="muted">
                        {c.phone || c.email || ""}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setResult(null);
          }}
          placeholder="Title — e.g. 🎉 Weekend sale is live!"
          maxLength={120}
        />
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message (optional) — e.g. Flat 20% off fruits today. Use code NISHA20."
          maxLength={500}
        />

        <div className="notify-actions">
          <button className="primary-btn" type="submit" disabled={!canSend}>
            {busy
              ? "Sending…"
              : audience === "all"
              ? "Send to all customers"
              : `Send to ${pick ? pick.name?.split(" ")[0] || "customer" : "customer"}`}
          </button>
          {result && (
            <span className={result.ok ? "notify-sent" : "notify-err"}>
              {result.msg}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
