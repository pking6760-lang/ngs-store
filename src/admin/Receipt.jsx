// The browser-print receipt (58mm), used by the WEB admin. The Android app
// prints ESC/POS bytes instead — see buildReceiptBytes in lib/printer.js. The
// two are deliberately the same document: same bands, same columns, same
// wording, so a bill looks like an NGS bill whichever way it came out.
export default function Receipt({ order, shop }) {
  if (!order) return null;
  const paid = order.paymentStatus === "paid";
  const badge = paid ? (order.razorpayPaymentId ? "PAID ONLINE" : "PAID · CASH") : "TO PAY";
  const count = (order.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);

  return (
    <div className="receipt-print" id="receipt-print">
      <div className="rc-brand">{shop.brand}</div>
      <div className="rc-shop">{shop.name}</div>
      <div className="rc-addr">{shop.address}</div>
      {shop.phone && <div className="rc-addr">Ph: {shop.phone}</div>}

      <div className="rc-hr thick" />
      <div className="rc-kv"><span>BILL NO</span><b>{order.id}</b></div>
      <div className="rc-kv"><span>DATE</span><span>{fmt(order.createdAt)}</span></div>
      {order.customer && <div className="rc-kv"><span>CUSTOMER</span><span>{order.customer}</span></div>}
      {order.userPhone && <div className="rc-kv"><span>PHONE</span><span>{order.userPhone}</span></div>}
      {order.deliverySlot && <div className="rc-kv"><span>SLOT</span><span>{order.deliverySlot}</span></div>}
      {order.address && (
        <>
          <div className="rc-kv"><span>DELIVER TO</span><span /></div>
          <div className="rc-addr-line">{order.address}</div>
        </>
      )}

      <div className="rc-hr thick" />
      <div className="rc-item rc-item-head">
        <span className="rc-i-name">ITEM</span>
        <span className="rc-i-qty">QTY</span>
        {/* The rate column the old receipt left out — without it nothing on the
            bill can be checked. */}
        <span className="rc-i-rate">RATE</span>
        <span className="rc-i-amt">AMT</span>
      </div>
      <div className="rc-hr" />
      {(order.items || []).map((it) => {
        const figures = (
          <>
            <span className="rc-i-qty">{it.qty}</span>
            <span className="rc-i-rate">{Math.round(it.price)}</span>
            <span className="rc-i-amt">{Math.round(it.price * it.qty)}</span>
          </>
        );
        // A long name gets the full width and its figures on the line beneath —
        // the same shape the thermal printer produces. Squeezing it into the
        // name column instead turns "Fortune Sunlite Refined Sunflower Oil"
        // into four ragged words against one lonely row of numbers.
        return String(it.name || "").length > 15 ? (
          <div key={it.id}>
            <div className="rc-i-long">{it.name}</div>
            <div className="rc-item"><span className="rc-i-name" />{figures}</div>
          </div>
        ) : (
          <div className="rc-item" key={it.id}>
            <span className="rc-i-name">{it.name}</span>
            {figures}
          </div>
        );
      })}
      <div className="rc-hr" />

      <div className="rc-kv"><span>{count} {count === 1 ? "item" : "items"}</span><span>{money(order.itemTotal)}</span></div>
      {order.couponDiscount > 0 && <div className="rc-kv"><span>Coupon {order.couponCode || ""}</span><span>-{money(order.couponDiscount)}</span></div>}
      {order.pointsDiscount > 0 && <div className="rc-kv"><span>Points discount</span><span>-{money(order.pointsDiscount)}</span></div>}
      {order.deliveryFee > 0 && <div className="rc-kv"><span>Delivery</span><span>{money(order.deliveryFee)}</span></div>}
      {order.handling > 0 && <div className="rc-kv"><span>Handling</span><span>{money(order.handling)}</span></div>}
      {order.surgeFee > 0 && <div className="rc-kv"><span>Surge</span><span>{money(order.surgeFee)}</span></div>}
      {order.walletUsed > 0 && <div className="rc-kv"><span>NGS Wallet</span><span>-{money(order.walletUsed)}</span></div>}

      <div className="rc-hr thick" />
      <div className="rc-kv rc-total"><span>TOTAL</span><span>{money(order.total)}</span></div>
      <div className="rc-hr thick" />

      {/* Reversed out, because an unpaid bill is the one line on this paper
          that must not be skimmed past. */}
      <div className={`rc-badge ${paid ? "" : "due"}`}>{badge}</div>
      {order.memberSavings > 0 && (
        <div className="rc-thanks">NGS Prime saved you {money(order.memberSavings)}</div>
      )}

      <div className="rc-hr" />
      <div className="rc-thanks strong">Thank you! Visit again</div>
      <div className="rc-thanks">Groceries delivered in 12 min</div>
      {shop.site && <div className="rc-thanks site">Order again: {shop.site}</div>}
    </div>
  );
}

function money(v) {
  return "Rs " + Math.round(Number(v) || 0);
}
function fmt(iso) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).replace(",", "");
  } catch {
    return "";
  }
}
