import { useEffect, useMemo, useState } from "react";
import { addToDelivery, walletBalance } from "../lib/api.js";
import { toast } from "../lib/toast.js";

// Add the current cart to the customer's next subscription delivery. Prepaid from
// the NGS Wallet (no cash), delivery follows the normal free-over-₹199 rule, and
// there's NO handling — the subscription's convenience fee already covers the trip.
export default function AddToDeliverySheet({
  open, onClose, upcoming, dayLabel, items, summaryProducts, itemsTotal, delivery, total, freeAbove, onAdded,
}) {
  const [walletBal, setWalletBal] = useState(null);
  const [busy, setBusy] = useState(false);

  const summary = useMemo(() => {
    const byId = Object.fromEntries((summaryProducts || []).map((p) => [p.id, p]));
    return (items || []).map((it) => ({ name: byId[it.id]?.name || "Item", qty: it.qty }));
  }, [items, summaryProducts]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setWalletBal(null);
    walletBalance().then((b) => { if (alive) setWalletBal(Number(b) || 0); }).catch(() => { if (alive) setWalletBal(0); });
    return () => { alive = false; };
  }, [open]);

  if (!open || !upcoming) return null;
  const itemsR = Math.round(itemsTotal || 0);
  const delR = Math.round(delivery || 0);
  const totalR = Math.round(total || 0);
  const enough = walletBal == null || walletBal >= totalR;
  const shortForFree = delR > 0 ? Math.max(0, Math.round((freeAbove || 199) - itemsR)) : 0;

  async function confirm() {
    if (busy) return;
    if (!items || items.length === 0) { toast("Your cart is empty."); return; }
    if (walletBal != null && walletBal < totalR) { toast("Not enough wallet balance — add money first."); return; }
    setBusy(true);
    try {
      await addToDelivery(items);
      toast(`Added to your ${dayLabel} delivery 🛵`);
      onAdded && onAdded();
    } catch (e) {
      toast(e.message || "Couldn't add to your delivery.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sub-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sub-head">
          <h3>Add to your {dayLabel} delivery 🥛</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sub-body">
          <p className="atd-intro">These items will arrive <strong>together with your {dayLabel} delivery</strong> — no separate trip.</p>

          <div className="sub-items">
            {summary.map((s, i) => (
              <span key={i} className="sub-item-chip">{s.name} × {s.qty}</span>
            ))}
          </div>

          <div className="sub-total">
            <div className="sub-total-line"><span>Items</span><span>₹{itemsR}</span></div>
            <div className="sub-total-line">
              <span>Delivery</span>
              <span>{delR === 0 ? "FREE" : `₹${delR}`}</span>
            </div>
            <div className="sub-total-line"><span>Handling</span><span>₹0 · covered</span></div>
            <div className="sub-total-row"><span>Pay from wallet</span><strong>₹{totalR}</strong></div>
            {shortForFree > 0 && (
              <div className="sub-total-note">Add ₹{shortForFree} more of regular items to get free delivery.</div>
            )}
          </div>

          {walletBal != null && (
            <p className={`atd-wallet ${enough ? "" : "low"}`}>
              NGS Wallet balance: ₹{Math.round(walletBal)}{enough ? "" : " — not enough, add money in Account → Wallet."}
            </p>
          )}
        </div>

        <div className="sub-foot">
          <button className="sub-start" disabled={busy || !enough} onClick={confirm}>
            {busy ? "Adding…" : `Pay ₹${totalR} from wallet & add`}
          </button>
          <p className="sub-cancel-hint">Paid from your NGS Wallet — no cash on delivery.</p>
        </div>
      </div>
    </div>
  );
}
