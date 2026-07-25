import { useMemo, useState, useEffect } from "react";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useShowMore } from "../lib/useShowMore.js";
import { useCustomers, useOrders, useUserNotifications, useSettings, useAdminProducts } from "../lib/hooks.js";
import { sendNotification } from "../lib/actions.js";
import { getOpsConfigRaw, fetchCustomerBalance, adminCreditWallet, adminCustomerWalletHistory } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import AdminPortal from "./AdminPortal.jsx";

export default function CustomersAdmin({ initialCustomerId = null }) {
  const customers = useCustomers();
  const orders = useOrders();
  const [selectedId, setSelectedId] = useState(initialCustomerId);
  // Deep-link: opening Customers with a target (e.g. tapped from an order) jumps
  // straight into that customer's profile.
  useEffect(() => { if (initialCustomerId) setSelectedId(initialCustomerId); }, [initialCustomerId]);
  useBackGuard(!!selectedId, () => setSelectedId(null));

  // Quick per-customer stats for the list.
  const statsFor = (userId) => {
    const theirs = orders.filter(
      (o) => o.userId === userId && o.status !== "Cancelled"
    );
    const spend = theirs.reduce((s, o) => s + (o.total || 0), 0);
    return { orders: theirs.length, spend };
  };

  const selected = customers.find((c) => c.id === selectedId) || null;
  const list = useShowMore(customers, 20);

  return (
    <>
      {customers.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">No customers yet.</p>
        </section>
      ) : (
        <div className="customer-list">
          {list.shown.map((c) => {
            const s = statsFor(c.id);
            return (
              <button
                className="customer-row"
                key={c.id}
                onClick={() => setSelectedId(c.id)}
              >
                <span className="customer-avatar">
                  {c.name.charAt(0).toUpperCase()}
                </span>
                <span className="customer-row-main">
                  <span className="customer-row-name">
                    {c.name}
                    {c.member && <span className="member-chip">Prime</span>}
                  </span>
                  <span className="customer-row-sub">
                    +91 {c.phone} · {s.orders} order{s.orders === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="customer-row-spend">₹{s.spend}</span>
                <span className="customer-row-arrow">›</span>
              </button>
            );
          })}
          {list.more && (
            <button
              type="button"
              className="show-more-btn"
              onClick={list.toggle}
            >
              {list.label}
            </button>
          )}
        </div>
      )}

      {selected && (
        <AdminPortal>
          <CustomerDetail
            customer={selected}
            orders={orders.filter((o) => o.userId === selected.id)}
            onClose={() => setSelectedId(null)}
          />
        </AdminPortal>
      )}
    </>
  );
}

// Give (or deduct) a customer's NGS Wallet money. Admin-only (server-enforced).
function WalletCredit({ customerId }) {
  const [balance, setBalance] = useState(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setBalance(await fetchCustomerBalance(customerId)); } catch { setBalance(0); }
  }
  useEffect(() => { load(); }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function apply(sign) {
    const val = Math.abs(Number(amount) || 0) * sign;
    if (!val) { toast("Enter an amount."); return; }
    setBusy(true);
    try {
      const bal = await adminCreditWallet(customerId, val, note);
      setBalance(bal);
      setAmount(""); setNote("");
      toast(`Wallet ${sign > 0 ? "credited" : "debited"} — new balance ₹${Math.round(bal)}`);
    } catch (e) { toast(e.message || "Couldn't update wallet."); }
    finally { setBusy(false); }
  }

  return (
    <div className="wallet-credit">
      <div className="wc-head">
        <span>NGS Wallet</span>
        <strong>{balance == null ? "…" : `₹${Math.round(balance)}`}</strong>
      </div>
      <div className="wc-quick">
        {[100, 200, 500, 1000].map((q) => (
          <button key={q} type="button" disabled={busy} onClick={() => setAmount(String(q))}>+₹{q}</button>
        ))}
      </div>
      <div className="wc-row">
        <input type="number" min="0" placeholder="Amount ₹" value={amount}
          onChange={(e) => setAmount(e.target.value)} />
        <input type="text" placeholder="Note (optional)" value={note}
          onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="wc-actions">
        <button type="button" className="wc-add" disabled={busy} onClick={() => apply(1)}>Add money</button>
        <button type="button" className="wc-sub" disabled={busy} onClick={() => apply(-1)}>Deduct</button>
      </div>
    </div>
  );
}

function CustomerDetail({ customer, orders, onClose }) {
  const { notes } = useUserNotifications(customer.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);

  const valid = orders.filter((o) => o.status !== "Cancelled");
  const totalSpend = valid.reduce((s, o) => s + (o.total || 0), 0);

  // Lifetime profit from this customer — for EVERY customer, not just members.
  // Income (Prime fees + order margin + fees they paid) minus what you gave them
  // (rewards) and paid out for their orders (staff picker/driver, refunds).
  const settings = useSettings();
  const adminProducts = useAdminProducts();
  const [ops, setOps] = useState(null);
  useEffect(() => { getOpsConfigRaw().then(setOps).catch(() => {}); }, []);
  const eco = useMemo(() => {
    const nn = (v) => Number(v) || 0;
    const cost = {};
    adminProducts.forEach((p) => { if (p.cost != null) cost[p.id] = p.cost; });
    const redeemPer = nn(settings.rewards?.redeemPer) || 10;
    const stdDelivery = nn(settings.deliveryFee);
    const stdHandling = nn(settings.handlingFee);
    const freeThresh = nn(settings.freeDeliveryAbove);
    let spend = 0, feePaid = 0, margin = 0, feesGot = 0, savings = 0, rewards = 0,
        pickerPay = 0, driverPay = 0, refunds = 0, freeDelivery = 0, freeHandling = 0, ordersN = 0;
    valid.forEach((o) => {
      spend += nn(o.total);
      feePaid += nn(o.membershipFee);
      if (o.isTopup) return;
      if (!o.isMembership) ordersN += 1;
      savings += nn(o.memberSavings);
      rewards += nn(o.scratchWallet) + nn(o.scratchPoints) / redeemPer;
      refunds += nn(o.refundedAmount);
      feesGot += nn(o.deliveryFee) + nn(o.handling) + nn(o.surgeFee);
      (o.items || []).forEach((it) => { if (cost[it.id] != null) margin += (it.price - cost[it.id]) * it.qty; });
      if (o.pickerId) pickerPay += nn(ops?.picker_pack_fee);
      if (o.riderId) {
        driverPay += (o.member && ops?.rider_member_base != null ? nn(ops.rider_member_base) : nn(ops?.rider_base))
          + Math.max(nn(o.distanceKm) - nn(ops?.rider_free_km), 0) * nn(ops?.rider_per_km)
          + ((o.surgeFee || 0) > 0 ? nn(ops?.peak_bonus) : 0);
      }
      if (o.member) {
        freeHandling += stdHandling;
        if (nn(o.itemTotal) < freeThresh) freeDelivery += stdDelivery;
      }
    });
    const net = feePaid + margin + feesGot - rewards - pickerPay - driverPay - refunds;
    const r = (x) => Math.round(x);
    return {
      spend: r(spend), feePaid: r(feePaid), margin: r(margin), feesGot: r(feesGot),
      savings: r(savings), rewards: r(rewards), pickerPay: r(pickerPay), driverPay: r(driverPay),
      refunds: r(refunds), freeDelivery: r(freeDelivery), freeHandling: r(freeHandling),
      net: r(net), ordersN,
    };
  }, [valid, adminProducts, settings, ops]);

  function send(e) {
    e.preventDefault();
    if (!title.trim()) return;
    sendNotification({ userId: customer.id, title, body });
    setTitle("");
    setBody("");
    setSent(true);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card customer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Customer</h3>
          <button type="button" className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="customer-detail">
          <div className="customer-hero">
            <span className="customer-avatar big">
              {customer.name.charAt(0).toUpperCase()}
            </span>
            <div>
              <div className="customer-hero-name">
                {customer.name}
                {customer.member ? (
                  <span className="member-chip">Prime</span>
                ) : (
                  <span className="nonmember-chip">Not a member</span>
                )}
              </div>
              <div className="customer-hero-phone">+91 {customer.phone}</div>
            </div>
          </div>

          <div className="customer-stats">
            <div className="cstat">
              <strong>₹{totalSpend}</strong>
              <span>Total spent</span>
            </div>
            <div className="cstat">
              <strong>{valid.length}</strong>
              <span>Orders</span>
            </div>
            <div className="cstat">
              <strong>{customer.points || 0}</strong>
              <span>Points</span>
            </div>
          </div>

          <WalletCredit customerId={customer.id} />


          <div className="customer-fields">
            {customer.email && (
              <div className="cfield">
                <span>Email</span>
                <b>{customer.email}</b>
              </div>
            )}
            <div className="cfield">
              <span>Address</span>
              <b>{customer.address || "—"}</b>
            </div>
            <div className="cfield">
              <span>Member since</span>
              <b>{customer.memberSince ? fmtDate(customer.memberSince) : "—"}</b>
            </div>
            <div className="cfield">
              <span>Joined</span>
              <b>{customer.createdAt ? fmtDate(customer.createdAt) : "—"}</b>
            </div>
          </div>

          <h4 className="customer-sec">Lifetime profit</h4>
          <div className={`prime-eco ${eco.net >= 0 ? "good" : "bad"}`}>
            <div className="pe-verdict">
              <span className="pe-net">₹{eco.net}</span>
              <span className="pe-tag">{eco.net >= 0 ? "Profitable customer ✓" : "At a loss ✗"}</span>
            </div>
            <div className="pe-sub">Lifetime spend ₹{eco.spend} · {eco.ordersN} order{eco.ordersN === 1 ? "" : "s"}</div>
            <div className="pe-rows">
              {eco.feePaid > 0 && <div className="pe-row income"><span>Prime fees paid {customer.membershipCount > 1 ? `(×${customer.membershipCount})` : ""}</span><b>+₹{eco.feePaid}</b></div>}
              <div className="pe-row income"><span>Order margin (sell − buy)</span><b>+₹{eco.margin}</b></div>
              {eco.feesGot > 0 && <div className="pe-row income"><span>Delivery / handling fees paid</span><b>+₹{eco.feesGot}</b></div>}
              {eco.rewards > 0 && <div className="pe-row"><span>Rewards given</span><b>−₹{eco.rewards}</b></div>}
              {eco.pickerPay > 0 && <div className="pe-row"><span>Picker pay</span><b>−₹{eco.pickerPay}</b></div>}
              {eco.driverPay > 0 && <div className="pe-row"><span>Driver pay</span><b>−₹{eco.driverPay}</b></div>}
              {eco.refunds > 0 && <div className="pe-row"><span>Refunds</span><b>−₹{eco.refunds}</b></div>}
              <div className="pe-row total"><span>Net profit</span><b>₹{eco.net}</b></div>
            </div>
            {customer.member && (eco.freeDelivery > 0 || eco.freeHandling > 0 || eco.savings > 0) && (
              <p className="pe-note">
                As a member they also enjoyed{" "}
                {[eco.freeDelivery > 0 ? `₹${eco.freeDelivery} free delivery` : null,
                  eco.freeHandling > 0 ? `₹${eco.freeHandling} free handling` : null,
                  eco.savings > 0 ? `₹${eco.savings} off member prices` : null]
                  .filter(Boolean).join(", ")} — perks already reflected above.
              </p>
            )}
          </div>

          <h4 className="customer-sec">Wallet history</h4>
          <WalletHistory customerId={customer.id} />

          <h4 className="customer-sec">
            Order history
            {orders.length > 0 && <span className="sec-count">{orders.length}</span>}
          </h4>
          {orders.length === 0 ? (
            <p className="panel-empty">No orders yet.</p>
          ) : (
            <>
              <div className="customer-orders">
                {(showAllOrders ? orders : orders.slice(0, 5)).map((o) => (
                  <div className="customer-order" key={o.id}>
                    <div>
                      <span className="order-id">#{o.id}</span>
                      <span className="order-time">{fmtDate(o.createdAt)}</span>
                    </div>
                    <span className="customer-order-right">
                      <span className={`status-badge status-${slug(o.status)}`}>
                        {o.status}
                      </span>
                      <b>₹{o.total}</b>
                    </span>
                  </div>
                ))}
              </div>
              {orders.length > 5 && (
                <button type="button" className="show-more-btn" onClick={() => setShowAllOrders((v) => !v)}>
                  {showAllOrders ? "Show less" : `Show all ${orders.length} orders`}
                </button>
              )}
            </>
          )}

          <h4 className="customer-sec">Send a notification / offer</h4>
          <form className="notify-form" onSubmit={send}>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setSent(false);
              }}
              placeholder="Title — e.g. Special 20% off for you!"
            />
            <textarea
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message (optional) — e.g. Use code NISHA20 today."
            />
            <div className="notify-actions">
              <button className="primary-btn" type="submit">
                Send to {customer.name.split(" ")[0]}
              </button>
              {sent && <span className="notify-sent">Sent</span>}
            </div>
          </form>

          {notes.length > 0 && (
            <>
              <h4 className="customer-sec">
                Sent notifications
                <span className="sec-count">{notes.length}</span>
              </h4>
              <div className="notify-history">
                {(showAllNotes ? notes : notes.slice(0, 3)).map((n) => (
                  <div className="notify-item" key={n.id}>
                    <div className="notify-item-title">
                      {n.title}
                      {!n.read && <span className="notify-unread">Unread</span>}
                    </div>
                    {n.body && <div className="notify-item-body">{n.body}</div>}
                    <div className="notify-item-time">{fmtDate(n.createdAt)}</div>
                  </div>
                ))}
              </div>
              {notes.length > 3 && (
                <button type="button" className="show-more-btn" onClick={() => setShowAllNotes((v) => !v)}>
                  {showAllNotes ? "Show less" : `Show all ${notes.length}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function slug(s) {
  return (s || "").toLowerCase().replace(/\s+/g, "-");
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}


/* Full wallet ledger for one customer — read through an admin-gated RPC, so a
   customer can never pull another person's wallet history. */
function WalletHistory({ customerId }) {
  const [rows, setRows] = useState(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    adminCustomerWalletHistory(customerId)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [customerId]);

  if (rows === null) return <p className="panel-empty">Loading wallet…</p>;
  if (!rows.length) return <p className="panel-empty">No wallet activity yet.</p>;
  const shown = all ? rows : rows.slice(0, 6);
  const balance = rows.reduce((t, r) => t + r.amount, 0);

  return (
    <>
      <div className="wh-balance">
        <span>Wallet balance</span>
        <b className={balance >= 0 ? "good" : "bad"}>₹{balance.toFixed(2)}</b>
      </div>
      <div className="wh-list">
        {shown.map((r) => (
          <div className="wh-row" key={r.id}>
            <div className="wh-txt">
              <b>{WALLET_KIND[r.kind] || r.kind}</b>
              <small>
                {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}
                {r.orderCode ? ` · ${r.orderCode}` : ""}{r.note ? ` · ${r.note}` : ""}
              </small>
            </div>
            <b className={r.amount >= 0 ? "wh-in" : "wh-out"}>
              {r.amount >= 0 ? "+" : "−"}₹{Math.abs(r.amount).toFixed(2)}
            </b>
          </div>
        ))}
      </div>
      {rows.length > 6 && (
        <button type="button" className="show-more-btn" onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : `Show all ${rows.length} entries`}
        </button>
      )}
    </>
  );
}
const WALLET_KIND = {
  topup: "Wallet top-up", spent: "Spent on order", referral: "Referral bonus",
  change: "Cash change", adjustment: "Manual adjustment", refund: "Refund",
};
