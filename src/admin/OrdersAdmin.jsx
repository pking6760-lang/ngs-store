import { useState } from "react";
import { useBackGuard } from "../lib/useBackGuard.js";
import { useOrders, usePartners } from "../lib/hooks.js";
import { ORDER_STATUSES } from "../lib/store.js";
import {
  updateOrderStatus, markCashReceived, acceptOrder, rejectOrder,
} from "../lib/actions.js";
import { googleMapsLink } from "../lib/location.js";
import { buildUpiLink, qrDataUri, cleanUpiQrFromImage } from "../lib/payments.js";
import { createOrderQr, adminRefundToWallet, adminCreateReturn } from "../lib/api.js";
import ProductThumb from "../components/ProductThumb.jsx";
import AdminPortal from "./AdminPortal.jsx";
import Receipt from "./Receipt.jsx";
import { StatusPill } from "./Dashboard.jsx";
import { withMinTime } from "../lib/ux.js";
import {
  isPrinterSupported, listPairedPrinters, savedPrinter, savePrinter, printReceiptBluetooth,
} from "../lib/printer.js";

// Shop details printed on the receipt header.
const SHOP = {
  brand: "NGS",
  name: "Nisha General Store",
  address: "Sultanpur, New Delhi 110030",
  phone: "",
};

export default function OrdersAdmin() {
  const orders = useOrders();
  const partners = usePartners();
  // Who handled a step: a staff member (name + employee ID), or the owner
  // ("Admin") when there's no partner. `happened` = the step actually occurred.
  const handlerLabel = (uid, happened) => {
    if (uid) {
      const p = partners.find((x) => x.userId === uid);
      if (p) return p.empCode ? `${p.fullName} · ${p.empCode}` : p.fullName;
      return "Admin"; // a non-partner user = the owner handled it themselves
    }
    return happened ? "Admin" : null;
  };
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  // Doorstep QR state (for the detail view).
  const [qrFor, setQrFor] = useState(null);
  const [qrState, setQrState] = useState({ loading: false, url: "", verified: false });

  // Keep the open detail in sync with live order updates (payment turning green,
  // status changes) by looking the order up fresh each render.
  const selected = selectedId ? orders.find((o) => o.id === selectedId) : null;

  const shown = filter === "all" ? orders : orders.filter((o) => o.status === filter);

  async function openQr(order) {
    if (qrFor === order.id) { setQrFor(null); return; }
    setQrFor(order.id);
    setQrState({ loading: true, url: "", verified: false });
    try {
      const { imageUrl, imageDataUrl } = await createOrderQr(order.dbId);
      const cleanQr = await cleanUpiQrFromImage(imageDataUrl);
      setQrState({ loading: false, url: cleanQr || imageDataUrl || imageUrl, verified: true });
    } catch {
      const upi = qrDataUri(buildUpiLink({ amount: order.total, note: `NGS ${order.id}` }));
      setQrState({ loading: false, url: upi, verified: false });
    }
  }

  // Marking Delivered on an unpaid order means the cash was taken → record it.
  async function changeStatus(order, status) {
    await withMinTime(async () => {
      await updateOrderStatus(order, status);
      if (status === "Delivered" && order.paymentStatus !== "paid") {
        await markCashReceived(order);
      }
    }, 550, 1100);
  }

  function closeDetail() {
    setSelectedId(null);
    setQrFor(null);
  }
  useBackGuard(!!selectedId, closeDetail);

  // ── Thermal printing ──────────────────────────────────────────────────────
  const [printMsg, setPrintMsg] = useState("");
  const [picker, setPicker] = useState(null); // { order, devices } when choosing a printer
  useBackGuard(!!picker, () => setPicker(null));

  async function printReceipt(order) {
    // On the web admin (or any non-app), use the browser print dialog.
    if (!isPrinterSupported()) { window.print(); return; }
    const saved = savedPrinter();
    if (!saved) return openPicker(order);
    await sendToPrinter(order, saved.address);
  }

  async function openPicker(order) {
    setPrintMsg("Looking for paired printers…");
    try {
      const devices = await listPairedPrinters();
      setPrintMsg("");
      if (!devices || devices.length === 0) {
        setPrintMsg("No paired device. Turn on Bluetooth and pair your printer in phone Settings first.");
        return;
      }
      setPicker({ order, devices });
    } catch {
      setPrintMsg("Turn on Bluetooth and allow the permission, then try again.");
    }
  }

  async function choosePrinter(dev) {
    savePrinter(dev);
    const order = picker.order;
    setPicker(null);
    await sendToPrinter(order, dev.address);
  }

  async function sendToPrinter(order, address) {
    setPrintMsg("Printing…");
    try {
      await printReceiptBluetooth(order, SHOP, address);
      setPrintMsg("Sent to printer");
      setTimeout(() => setPrintMsg(""), 2500);
    } catch (e) {
      setPrintMsg("" + (e.message || "Print failed. Check the printer is on and paired."));
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="filter-chips">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>All</Chip>
          {ORDER_STATUSES.map((s) => (
            <Chip key={s} active={filter === s} onClick={() => setFilter(s)}>{s}</Chip>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <section className="panel">
          <p className="panel-empty">No orders in this view yet.</p>
        </section>
      ) : (
        <div className="order-rows">
          {shown.map((o) => {
            const isNew = o.accepted === false && o.status !== "Cancelled";
            return (
              <button className="order-row" key={o.id} onClick={() => setSelectedId(o.id)}>
                <div className="order-row-top">
                  <span className="order-row-id">
                    {o.isReturn && <span className="row-return">↩︎ RETURN</span>} #{o.id}
                  </span>
                  <span className="order-row-total">₹{o.total}</span>
                </div>
                <div className="order-row-bottom">
                  <span className="order-row-time">{formatTime(o.createdAt)}</span>
                  <span className="order-row-tags">
                    {isNew && !o.isReturn && <span className="row-new">● NEW</span>}
                    {!o.isReturn && o.paymentStatus === "paid" && <span className="row-paid">paid</span>}
                    <StatusPill status={o.status} />
                  </span>
                </div>
                {o.status === "Delivered" && (
                  <div className="order-row-rider">{handlerLabel(o.riderId, true)}</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <AdminPortal>
          <OrderDetail
            order={selected}
            deliveredBy={handlerLabel(selected.riderId, selected.status === "Delivered" || !!selected.deliveredAt)}
            packedBy={handlerLabel(selected.pickerId, !!selected.packedAt || ["Packed", "Out for delivery", "Delivered"].includes(selected.status))}
            onClose={closeDetail}
            qrFor={qrFor}
            qrState={qrState}
            openQr={openQr}
            changeStatus={changeStatus}
            onPrint={printReceipt}
            onChangePrinter={() => openPicker(selected)}
            printMsg={printMsg}
          />
        </AdminPortal>
      )}

      {picker && (
        <AdminPortal>
          <div className="od-overlay" onClick={() => setPicker(null)}>
            <div className="printer-pick" onClick={(e) => e.stopPropagation()}>
              <h3>Choose your printer</h3>
              <p className="od-muted">Paired Bluetooth devices:</p>
              <div className="printer-list">
                {picker.devices.map((d) => (
                  <button key={d.address} className="printer-item" onClick={() => choosePrinter(d)}>
                    {d.name || d.address}
                    <span>{d.address}</span>
                  </button>
                ))}
              </div>
              <button className="printer-cancel" onClick={() => setPicker(null)}>Cancel</button>
            </div>
          </div>
        </AdminPortal>
      )}
    </>
  );
}

function OrderDetail({ order: o, deliveredBy, packedBy, onClose, qrFor, qrState, openQr, changeStatus, onPrint, onChangePrinter, printMsg }) {
  const curIdx = ORDER_STATUSES.indexOf(o.status);
  // The owner does a track only when no staff partner is assigned to it.
  const ownerPacks = !o.pickerId;
  const ownerDelivers = !o.riderId;
  const [statusBusy, setStatusBusy] = useState(null);
  async function doChange(s) { setStatusBusy(s); try { await changeStatus(o, s); } finally { setStatusBusy(null); } }
  const bill = [
    ["Items total", o.itemTotal],
    o.couponDiscount > 0 && [`Coupon (${o.couponCode})`, -o.couponDiscount],
    o.pointsDiscount > 0 && [`Points used${o.pointsRedeemed ? ` (${o.pointsRedeemed} pts)` : ""}`, -o.pointsDiscount],
    o.deliveryFee > 0 && ["Delivery fee", o.deliveryFee],
    o.handling > 0 && ["Handling", o.handling],
    o.surgeFee > 0 && ["Surge", o.surgeFee],
    o.walletUsed > 0 && ["NGS Wallet used", -o.walletUsed],
  ].filter(Boolean);

  return (
    <div className="od-overlay" onClick={onClose}>
      <div className="od-panel" onClick={(e) => e.stopPropagation()}>
        <div className="od-head">
          <button className="back-btn small" onClick={onClose} aria-label="Back">←</button>
          <div className="od-head-title">
            <span className="order-id">#{o.id}</span>
            <span className="order-time">{formatTime(o.createdAt)}</span>
          </div>
          <StatusPill status={o.status} />
        </div>

        <div className="od-body">
          <div className="od-payline"><PaymentTag order={o} /></div>
          {(deliveredBy || packedBy) && (
            <div className="od-handled">
              {packedBy && <div className="od-handled-row"><span>Packed by</span><strong>{packedBy}</strong></div>}
              {deliveredBy && (
                <div className="od-handled-row">
                  <span>Delivered by</span>
                  <strong>{deliveredBy}{o.deliveredAt ? ` · ${formatTime(o.deliveredAt)}` : ""}</strong>
                </div>
              )}
            </div>
          )}
          {o.needsOwner && o.status !== "Delivered" && o.status !== "Cancelled" && (
            <div className="od-needs-owner">No delivery partner was available — this one's on you. Pack it and deliver, or wait for a partner to come online.</div>
          )}

          <section className="od-section">
            <h4>Customer</h4>
            <div className="od-row">
              <strong>{o.customer || "Customer"}</strong>
              {o.member && <span className="member-chip">Prime</span>}
            </div>
            {o.userPhone && (
              <a className="od-call" href={`tel:+91${o.userPhone}`}>Call +91 {o.userPhone}</a>
            )}
          </section>

          <section className="od-section">
            <h4>Delivery</h4>
            <div className="od-row">{o.address || "No address given"}</div>
            {o.location ? (
              <a className="od-map" href={googleMapsLink(o.location)} target="_blank" rel="noopener noreferrer">
                Open location in Google Maps →
              </a>
            ) : (
              <div className="od-muted">No location shared</div>
            )}
            {o.distanceKm != null && <div className="od-muted">{o.distanceKm} km from shop</div>}
          </section>

          <section className="od-section">
            <h4>Items ({o.count})</h4>
            <div className="order-items">
              {o.items.map((it) => (
                <div className="order-item" key={it.id}>
                  <span className="order-item-icon">
                    <ProductThumb image={it.image} name={it.name} category={it.category} size={28} radius={6} />
                  </span>
                  <span className="order-item-name">{it.name}</span>
                  <span className="order-item-qty">× {it.qty}</span>
                  <span className="order-item-price">₹{it.price * it.qty}</span>
                </div>
              ))}
            </div>
            <div className="od-bill">
              {bill.map(([label, amt]) => (
                <div className="od-bill-row" key={label}>
                  <span>{label}</span>
                  <span className={amt < 0 ? "free" : ""}>{amt < 0 ? `−₹${-amt}` : `₹${amt}`}</span>
                </div>
              ))}
              <div className="od-bill-row total"><span>Total</span><span>₹{o.total}</span></div>
              {o.refundedAmount > 0 && (
                <div className="od-bill-row"><span>↩︎ Refunded to wallet</span><span className="free">₹{o.refundedAmount}</span></div>
              )}
              {o.pointsEarned > 0 && (
                <div className="od-bill-row"><span>Points earned</span><span>{o.pointsEarned}</span></div>
              )}
            </div>
            <button className="print-btn" onClick={() => onPrint(o)}>
              Print receipt (thermal printer)
            </button>
            <div className="print-sub">
              <button className="print-change" onClick={onChangePrinter}>Change printer</button>
              {savedPrinter() && <span className="print-saved">{savedPrinter().name}</span>}
            </div>
            {printMsg && <p className="print-msg">{printMsg}</p>}
          </section>

          {o.paymentStatus !== "paid" && o.status !== "Cancelled" && (
            <section className="od-section">
              <h4>Collect payment</h4>
              <button className="collect-btn" onClick={() => openQr(o)}>
                {qrFor === o.id ? "▲ Hide payment QR" : "Show UPI QR (scan & pay)"}
              </button>
              {qrFor === o.id && (
                <div className="collect-qr">
                  {qrState.loading && <p>Creating UPI QR…</p>}
                  {qrState.url && (
                    <>
                      <img src={qrState.url} alt="UPI payment QR code" />
                      <p>
                        Scan with <strong>any UPI app</strong> to pay <strong>₹{o.total}</strong>
                        <br /><span>Pays directly · confirms automatically</span>
                      </p>
                    </>
                  )}
                </div>
              )}
              <p className="od-muted">Taking cash instead? Just tap <strong>Delivered</strong> below — it records as paid cash.</p>
            </section>
          )}

          <section className="od-section">
            <h4>{o.isReturn ? "Return status" : "Update order"}</h4>
            {o.isReturn ? (
              <div className="od-role-wait">
                {o.status === "Returned"
                  ? "✓ Return complete — item collected, customer refunded to wallet."
                  : o.riderId
                    ? "A delivery partner is collecting the return…"
                    : "Waiting for a delivery partner to collect the return…"}
              </div>
            ) : (
             <>
            {o.accepted === false && o.status !== "Cancelled" && (
              <div className="od-accept-row">
                <button className="od-accept" onClick={() => acceptOrder(o)}>Accept order</button>
                <button className="od-reject" onClick={() => rejectOrder(o)}>✖ Reject</button>
              </div>
            )}
            {o.status === "Cancelled" ? (
              <div className="order-cancel-tag">✖ Cancelled</div>
            ) : o.status === "Delivered" ? (
              <div className="order-done-tag">✓ Delivered — order complete</div>
            ) : (
              // Role-scoped: you only act on the track no staff partner is
              // covering. A staff picker owns packing (picker_id set); a staff
              // driver owns delivery (rider_id set) — those steps are theirs.
              <div className="od-role-actions">
                {/* Packing step (before Packed) */}
                {curIdx < 1 && (
                  ownerPacks ? (
                    <button className="od-status current" disabled={!!statusBusy} onClick={() => doChange("Packed")}>
                      {statusBusy === "Packed" ? <span className="ngs-spin" /> : "Mark packed"}
                    </button>
                  ) : (
                    <div className="od-role-wait">Picker is packing this order…</div>
                  )
                )}
                {/* Delivery step (after Packed) */}
                {curIdx >= 1 && (
                  ownerDelivers ? (
                    o.status === "Packed" ? (
                      <button className="od-status current" disabled={!!statusBusy} onClick={() => doChange("Out for delivery")}>
                        {statusBusy === "Out for delivery" ? <span className="ngs-spin" /> : "Out for delivery"}
                      </button>
                    ) : (
                      <button className="od-status current" disabled={!!statusBusy} onClick={() => doChange("Delivered")}>
                        {statusBusy === "Delivered" ? <span className="ngs-spin" /> : "✓ Mark delivered"}
                      </button>
                    )
                  ) : (
                    <div className="od-role-wait">
                      {o.status === "Out for delivery" ? "Driver is on the way…" : "Waiting for the driver to pick up…"}
                    </div>
                  )
                )}
              </div>
            )}
             </>
            )}
          </section>

          <ReturnSection order={o} />
          <RefundSection order={o} />
        </div>
      </div>
      {/* Hidden on screen; the print stylesheet reveals only this at 58mm. */}
      <Receipt order={o} shop={SHOP} />
    </div>
  );
}

// Start a driver-collected return for a delivered order. Dispatches a delivery
// partner to the customer's address; on their confirmation the order total is
// refunded to the wallet and earned points reversed — all automatic.
function ReturnSection({ order }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState(false);
  // qty to return per item id (defaults to the full ordered qty).
  const [pick, setPick] = useState(() =>
    Object.fromEntries((order.items || []).map((it) => [it.id, it.qty]))
  );

  if (order.isReturn) return null;
  const returned = order.status === "Returned";
  if (order.status !== "Delivered" && !returned) return null;

  // Returns are only allowed within 24h of delivery.
  const RETURN_WINDOW_MS = 24 * 60 * 60 * 1000;
  const deliveredAt = order.deliveredAt || order.createdAt;
  const windowClosed = deliveredAt && (Date.now() - new Date(deliveredAt).getTime() > RETURN_WINDOW_MS);

  const selectedQty = (it) => pick[it.id] ?? 0;
  const setQty = (id, q, max) => setPick((p) => ({ ...p, [id]: Math.max(0, Math.min(max, q)) }));
  const items = order.items || [];
  const totalPicked = items.reduce((s, it) => s + selectedQty(it), 0);
  const refundEstimate = items.reduce((s, it) => s + selectedQty(it) * it.price, 0);
  const allSelected = items.every((it) => selectedQty(it) === it.qty);

  async function create() {
    const picks = items.filter((it) => selectedQty(it) > 0).map((it) => ({ id: it.id, qty: selectedQty(it) }));
    if (!picks.length) { setErr("Select at least one item to return."); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      // Send null when the whole order is selected → refunds fees too.
      await adminCreateReturn(order.dbId, allSelected ? null : picks);
      setMsg("Return created — a delivery partner will be sent to collect the item(s). The refund happens automatically once they confirm the pickup.");
      setConfirming(false);
    } catch (e) {
      setErr(e.message || "Couldn't create the return.");
    } finally { setBusy(false); }
  }

  return (
    <section className="od-section">
      <h4>Return pickup</h4>
      {returned ? (
        <div className="od-refunded">↩︎ Returned · ₹{(order.refundedAmount || 0).toFixed(2)} refunded to NGS Wallet</div>
      ) : windowClosed ? (
        <p className="od-muted">⌛ The 24-hour return window has passed — this order can no longer be returned.</p>
      ) : (
        <>
          {(order.refundedAmount || 0) > 0 && (
            <div className="od-refunded" style={{ marginBottom: 8 }}>
              ↩︎ ₹{(order.refundedAmount || 0).toFixed(2)} already refunded (partial return)
            </div>
          )}
          {msg ? (
            <div className="od-refund-ok">{msg}</div>
          ) : !confirming ? (
            <button className="od-refund-btn" onClick={() => { setConfirming(true); setErr(""); }}>
              ↩︎ Create return — send a driver to collect
            </button>
          ) : (
            <div className="od-refund-form">
              <p className="od-muted">Choose what's coming back. Reduce the quantity to return only some.</p>
              <div className="od-return-items">
                {items.map((it) => (
                  <div className="od-return-item" key={it.id}>
                    <span className="od-return-name">{it.name}</span>
                    <div className="od-qty-step">
                      <button type="button" onClick={() => setQty(it.id, selectedQty(it) - 1, it.qty)} disabled={selectedQty(it) <= 0}>−</button>
                      <span>{selectedQty(it)} / {it.qty}</span>
                      <button type="button" onClick={() => setQty(it.id, selectedQty(it) + 1, it.qty)} disabled={selectedQty(it) >= it.qty}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="od-muted">
                {allSelected
                  ? `Full return — ₹${(order.total || 0).toFixed(2)} (incl. fees) refunded to the customer's NGS Wallet.`
                  : `Partial return — about ₹${refundEstimate.toFixed(2)} (goods value) refunded to the customer's NGS Wallet.`}
                {" "}Earned points are reversed{allSelected ? "" : " in proportion"}. A driver is dispatched to collect the item(s).
              </p>
              {err && <div className="auth-error">{err}</div>}
              <div className="od-refund-actions">
                <button className="ghost-btn" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
                <button className="primary-btn" onClick={create} disabled={busy || totalPicked === 0}>
                  {busy ? "Creating…" : "Create return"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Refund / return → credits the customer's NGS wallet (store credit), never the
// bank. The owner enters the amount (defaults to what's left to refund).
function RefundSection({ order }) {
  // A fully-returned order is already settled through the return flow — no
  // separate manual refund (avoids double-refunding).
  if (order.isReturn || order.status === "Returned") return null;
  const already = order.refundedAmount || 0;
  const remaining = Math.max(0, (order.total || 0) - already);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(remaining));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function refund() {
    const amt = Number(amount);
    if (!(amt > 0)) { setErr("Enter an amount."); return; }
    if (amt > remaining) { setErr(`Max ₹${remaining.toFixed(2)} left to refund.`); return; }
    setBusy(true); setErr(""); setMsg("");
    try {
      await adminRefundToWallet(order.dbId, amt, "Refund for order " + order.id);
      setMsg(`₹${amt.toFixed(2)} added to the customer's NGS Wallet.`);
      setOpen(false);
    } catch (e) {
      setErr(e.message || "Couldn't process the refund.");
    } finally { setBusy(false); }
  }

  return (
    <section className="od-section od-refund">
      <h4>Return &amp; refund</h4>
      {already > 0 && (
        <div className="od-refunded">↩︎ Refunded ₹{already.toFixed(2)} to NGS Wallet</div>
      )}
      {msg && <div className="od-refund-ok">{msg}</div>}
      {remaining <= 0 ? (
        <p className="od-muted">Fully refunded.</p>
      ) : !open ? (
        <button className="od-refund-btn" onClick={() => { setOpen(true); setAmount(String(remaining)); setErr(""); }}>
          ↩︎ Refund to NGS Wallet
        </button>
      ) : (
        <div className="od-refund-form">
          <p className="od-muted">Refunds go to the customer's NGS Wallet — usable on their next order.</p>
          <div className="od-refund-row">
            <span>₹</span>
            <input type="number" min="0" max={remaining} value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          {err && <div className="auth-error">{err}</div>}
          <div className="od-refund-actions">
            <button className="ghost-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="primary-btn" onClick={refund} disabled={busy}>
              {busy ? "Refunding…" : `Refund ₹${Number(amount) || 0}`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Payment badge: paid online (has Razorpay id) vs paid cash (no id) vs to-collect.
function PaymentTag({ order }) {
  if (order.paymentStatus === "paid") {
    return order.razorpayPaymentId ? (
      <span className="order-pay-tag paid">PAID online · ₹{order.total}</span>
    ) : (
      <span className="order-pay-tag paidcash">PAID cash · ₹{order.total}</span>
    );
  }
  const method = order.paymentMethod || order.payment;
  if (method === "cod") {
    return <span className="order-pay-tag cod">COLLECT ₹{order.total} (cash or UPI)</span>;
  }
  if (method === "razorpay" || method === "online" || method === "card") {
    return <span className="order-pay-tag unpaid">⏳ Online — payment pending</span>;
  }
  return <span className="order-pay-tag">₹{order.total}</span>;
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>{children}</button>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}
