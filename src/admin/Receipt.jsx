// A thermal-printer receipt (58mm). Rendered hidden on screen; the print
// stylesheet in admin.css shows ONLY this when the browser/Android print dialog
// runs, sized for a 58mm roll. Works with Android print services / thermal
// printer apps (e.g. RawBT) and Bluetooth POS printers.
export default function Receipt({ order, shop }) {
  if (!order) return null;
  const paid =
    order.paymentStatus === "paid"
      ? order.razorpayPaymentId ? "PAID ONLINE" : "PAID (CASH)"
      : "TO PAY";
  const when = fmt(order.createdAt);

  return (
    <div className="receipt-print" id="receipt-print">
      <div className="rc-brand">{shop.brand}</div>
      <div className="rc-shop">{shop.name}</div>
      <div className="rc-addr">{shop.address}</div>
      {shop.phone && <div className="rc-addr">Ph: {shop.phone}</div>}
      <div className="rc-hr" />

      <div className="rc-kv"><span>Bill No</span><span>{order.id}</span></div>
      <div className="rc-kv"><span>Date</span><span>{when}</span></div>
      {order.customer && <div className="rc-kv"><span>Name</span><span>{order.customer}</span></div>}
      {order.userPhone && <div className="rc-kv"><span>Phone</span><span>{order.userPhone}</span></div>}
      <div className="rc-hr" />

      <div className="rc-item rc-item-head">
        <span className="rc-i-name">Item</span>
        <span className="rc-i-qty">Qty</span>
        <span className="rc-i-amt">Amt</span>
      </div>
      {order.items.map((it) => (
        <div className="rc-item" key={it.id}>
          <span className="rc-i-name">{it.name}</span>
          <span className="rc-i-qty">{it.qty}</span>
          <span className="rc-i-amt">{Math.round(it.price * it.qty)}</span>
        </div>
      ))}
      <div className="rc-hr" />

      <div className="rc-kv"><span>Subtotal</span><span>{money(order.itemTotal)}</span></div>
      {order.couponDiscount > 0 && <div className="rc-kv"><span>Coupon {order.couponCode || ""}</span><span>-{money(order.couponDiscount)}</span></div>}
      {order.pointsDiscount > 0 && <div className="rc-kv"><span>Points disc.</span><span>-{money(order.pointsDiscount)}</span></div>}
      {order.deliveryFee > 0 && <div className="rc-kv"><span>Delivery</span><span>{money(order.deliveryFee)}</span></div>}
      {order.handling > 0 && <div className="rc-kv"><span>Handling</span><span>{money(order.handling)}</span></div>}
      {order.surgeFee > 0 && <div className="rc-kv"><span>Surge</span><span>{money(order.surgeFee)}</span></div>}
      {order.walletUsed > 0 && <div className="rc-kv"><span>NGS Wallet</span><span>-{money(order.walletUsed)}</span></div>}
      <div className="rc-hr" />

      <div className="rc-kv rc-total"><span>TOTAL</span><span>{money(order.total)}</span></div>
      <div className="rc-kv"><span>Payment</span><span>{paid}</span></div>
      <div className="rc-hr" />

      <div className="rc-thanks">Thank you! Visit again</div>
      <div className="rc-thanks">— {shop.brand} —</div>
    </div>
  );
}

function money(v) {
  return "Rs " + Math.round(Number(v) || 0);
}
function fmt(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return "";
  }
}
