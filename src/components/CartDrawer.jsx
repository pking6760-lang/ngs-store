import { useEffect, useRef, useState } from "react";
import { ActionOverlay } from "./Motion.jsx";
import { withMinTime } from "../lib/ux.js";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useProducts, useSettings, useCategories, useCoupons, useWallet } from "../lib/hooks.js";
import { saveOrder, applyCouponFrom, decrementStock, getShopLocations } from "../lib/store.js";
import * as api from "../lib/api.js";
import { getCurrentLocation, googleMapsLink, distanceKm, reverseGeocode, searchAddress } from "../lib/location.js";
import { buildUpiLink, qrDataUri, SHOP_UPI_ID, RAZORPAY_ENABLED, loadRazorpay, cleanUpiQrFromImage, decodeUpiFromQr } from "../lib/payments.js";
import { tierUnitPrice, bulkUnitPrice } from "../lib/bulk.js";
import { useBackGuard } from "../lib/useBackGuard.js";
import ProductThumb from "./ProductThumb.jsx";
import MapPicker from "./MapPicker.jsx";
import SubscribeSheet from "./SubscribeSheet.jsx";
import gpayLogo from "../assets/upi/gpay.png";
import phonepeLogo from "../assets/upi/phonepe.png";
import paytmLogo from "../assets/upi/paytm.png";
import bhimLogo from "../assets/upi/bhim.png";
import {
  pointsForSpend,
  redeemableRupees,
} from "../lib/rewards.js";

// Persist the delivery address + phone the customer typed, so a page refresh
// doesn't wipe them (the cart itself is already saved by CartContext).
const DRAFT_KEY = "ngs-checkout-draft-v1";

// Amount → Indian rupees in words ("Rupees One Hundred Ninety Six Only"),
// like the confirmation line on a UPI payment screen.
function rupeesInWords(amount) {
  let num = Math.round(Number(amount) || 0);
  if (num === 0) return "Rupees Zero Only";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  let w = "";
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  if (crore) w += two(crore) + " Crore ";
  if (lakh) w += two(lakh) + " Lakh ";
  if (thousand) w += two(thousand) + " Thousand ";
  if (num) w += three(num);
  return "Rupees " + w.trim() + " Only";
}

// iOS has no UPI "app chooser" like Android — a raw upi:// link opens whatever
// single app claimed the scheme (often WhatsApp), so on iPhone/iPad we route
// UPI through Razorpay's sheet instead of firing the intent directly.
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|ad|od)/.test(navigator.userAgent || "") ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1));

// UPI apps shown as direct buttons on the pay screen. Each opens that specific
// app with the amount pre-filled: on Android via an intent:// URL targeting the
// package; on iOS via the app's own URL scheme (targeting a specific app avoids
// the generic upi:// link being grabbed by the wrong handler like WhatsApp).
const UPI_APPS = [
  { id: "gpay", name: "Google Pay", logo: gpayLogo, scheme: "tez://upi/pay" },
  { id: "phonepe", name: "PhonePe", logo: phonepeLogo, scheme: "phonepe://pay" },
  { id: "paytm", name: "Paytm", logo: paytmLogo, scheme: "paytmmp://pay" },
  { id: "bhim", name: "BHIM UPI", logo: bhimLogo, scheme: "upi://pay" },
];
// Use each app's own URL scheme (works from both the Capacitor WebView and a
// mobile browser). intent:// is avoided because the in-app WebView can't launch
// it; the app packages are declared in AndroidManifest <queries> so Android 11+
// is allowed to open them.
function upiAppHref(upiIntent, app) {
  if (!upiIntent || upiIntent.indexOf("?") < 0) return "#";
  const q = upiIntent.slice(upiIntent.indexOf("?") + 1);
  return `${app.scheme}?${q}`;
}

// Tap-to-add delivery instructions shown on the checkout page.
const DELIVERY_NOTES = [
  { icon: "🔕", label: "Don't ring the bell" },
  { icon: "🚪", label: "Leave at the door" },
  { icon: "📵", label: "Avoid calling" },
  { icon: "🤝", label: "Hand it to me" },
];
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); }
  catch { return {}; }
}

export default function CartDrawer({ open, onClose, onRequireLogin }) {
  const { items, add, remove, deleteItem, clear, setQty } = useCart();
  const { user, isLoggedIn, updateProfile, applyRewards } = useAuth();
  const products = useProducts();
  const settings = useSettings();
  const categories = useCategories();
  const allCoupons = useCoupons();

  const BACKEND = api.isBackendConfigured;
  const [step, setStep] = useState("cart"); // cart | checkout | pay | done
  const [placed, setPlaced] = useState(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState("");
  const [subOpen, setSubOpen] = useState(false);   // "get this daily" sheet
  const [address, setAddress] = useState(() => loadDraft().address || "");
  const [phone, setPhone] = useState(() => loadDraft().phone || "");
  const [location, setLocation] = useState(() => loadDraft().location || null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  // Optional delivery instructions the customer taps — passed to the rider on
  // the order (appended to the address the partner sees).
  const [deliveryNotes, setDeliveryNotes] = useState([]);
  // "Leave at the door" and "Hand it to me" are opposites — picking one clears
  // the other. The rest can be combined freely.
  const toggleNote = (n) =>
    setDeliveryNotes((v) => {
      if (v.includes(n)) return v.filter((x) => x !== n);
      const OPPOSITES = ["Leave at the door", "Hand it to me"];
      const base = OPPOSITES.includes(n) ? v.filter((x) => !OPPOSITES.includes(x)) : v;
      return [...base, n];
    });
  // Address stored on the ORDER (with any delivery instructions) — the saved
  // profile address stays clean (notes are per-order).
  const orderAddress = () =>
    address.trim() + (deliveryNotes.length ? `  •  ${deliveryNotes.join(", ")}` : "");
  // razorpay (verified online) | upi (legacy QR, unverified) | cod. When online
  // payments are enabled we default to them and drop the unverified QR option.
  const [payment, setPayment] = useState(RAZORPAY_ENABLED ? "razorpay" : "upi");
  const [usePoints, setUsePoints] = useState(false);
  const [useWalletCredit, setUseWalletCredit] = useState(false);
  const [addMembership, setAddMembership] = useState(false); // buy NGS Prime with this order
  const wallet = useWallet(user?.id);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [showCoupons, setShowCoupons] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [payLink, setPayLink] = useState(null); // { url, order, count } for online QR pay
  const searchTimer = useRef();
  const submitLock = useRef(false); // prevents double order submission

  const lines = Object.entries(items)
    .map(([id, qty]) => {
      const product = products.find((p) => p.id === id);
      if (!product) return null;
      // Tier price: the discount lives in the price itself (mirrors the server).
      return { product, qty, unit: tierUnitPrice(product, qty, user, settings.rewards) };
    })
    .filter(Boolean);

  // Self-heal: if a cart quantity is above what's now in stock (e.g. stock
  // dropped after it was added), clamp it down so checkout can't fail.
  useEffect(() => {
    lines.forEach(({ product, qty }) => {
      if (typeof product.stock === "number" && qty > product.stock) {
        setQty(product.id, product.stock);
      }
    });
  }, [lines, setQty]);

  const itemTotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  // Subscriptions bill at the STANDARD price (never member/Prime price), matching
  // the server (bulk_unit_price). Use this for the subscribe sheet's daily total.
  const subItemsTotal = lines.reduce((sum, l) => sum + bulkUnitPrice(l.product, l.qty) * l.qty, 0);
  // Minimum order value — checkout is blocked below it (server enforces too).
  const minOrder = Number(settings.rewards?.minOrderValue) || 0;
  const belowMin = itemTotal > 0 && itemTotal < minOrder;
  const minShortfall = belowMin ? Math.ceil(minOrder - itemTotal) : 0;
  // Ultra-low-margin items (milk, curd, bread) don't count toward the
  // free-delivery minimum. They're still in the cart total — just excluded here.
  const qualifyingTotal = lines.reduce(
    (sum, l) => sum + (l.product.freeDeliveryExempt ? 0 : l.unit * l.qty),
    0
  );
  const savings = lines.reduce(
    (sum, l) => sum + (l.product.mrp - l.unit) * l.qty,
    0
  );

  // ── Reward redemption ──────────────────────────────────
  const isMember = !!user?.member;
  const isSurge = settings.deliveryMode === "surge";
  const rewardsCfg = settings.rewards;
  const redeemPer = rewardsCfg?.redeemPer || 10;
  const maxRedeemPct = rewardsCfg?.maxRedeemPct ?? 20;
  const availablePoints = user?.points || 0;
  // Redeemable ₹ = the points' value, capped at maxRedeemPct% of the item total
  // (mirrors the server, which is authoritative). Never more than the items cost.
  const maxRedeemRupees = Math.min(
    redeemableRupees(availablePoints, rewardsCfg),
    Math.floor((itemTotal * maxRedeemPct) / 100),
    itemTotal
  );
  const canRedeem = isLoggedIn && maxRedeemRupees > 0;
  const discount = usePoints && canRedeem ? maxRedeemRupees : 0;
  const pointsUsed = discount * redeemPer; // points to actually spend

  // Per-category subtotals + a name lookup, so coupons can require a certain
  // product type or a minimum amount.
  const catTotals = {};
  for (const { product, qty, unit } of lines) {
    catTotals[product.category] =
      (catTotals[product.category] || 0) + unit * qty;
  }
  const catName = (id) => categories.find((c) => c.id === id)?.name || id;
  const couponCtx = { itemTotal, catTotals, catName };
  const activeCoupons = allCoupons.filter((c) => c.active);

  // Coupon — re-validated against the current cart each render so it stays
  // correct if items are added/removed.
  const couponResult = appliedCode ? applyCouponFrom(allCoupons, appliedCode, couponCtx) : null;
  const couponDiscount = couponResult?.ok
    ? Math.min(couponResult.discount, itemTotal - discount)
    : 0;
  const couponInvalid = appliedCode && couponResult && !couponResult.ok;

  const netItems = Math.max(0, itemTotal - discount - couponDiscount);

  // ── Delivery fee (admin-controlled, with membership + surge rules) ──
  const DELIVERY_FEE = settings.deliveryFee ?? 25;
  const FREE_DELIVERY_ABOVE = settings.freeDeliveryAbove ?? 199;
  const HANDLING_FEE = settings.handlingFee ?? 5;
  const SURGE_FEE = settings.surgeFee ?? 0;
  let deliveryFee =
    qualifyingTotal >= FREE_DELIVERY_ABOVE || itemTotal === 0 ? 0 : DELIVERY_FEE;
  let freeReason = deliveryFee === 0 && itemTotal > 0 ? "order" : null;
  if (isMember && itemTotal > 0 && deliveryFee > 0) {
    deliveryFee = 0;
    freeReason = "member";
  }

  // Members pay no handling charge (part of the Prime bundle).
  const handling = itemTotal === 0 || isMember ? 0 : HANDLING_FEE;
  // Surge / bad-weather premium — applies to everyone while surge mode is on.
  const surgeFee = isSurge && itemTotal > 0 ? SURGE_FEE : 0;

  // ── NGS Prime — buy the membership along with this order ──
  const memPlan = settings.rewards?.membership || {};
  const memEnabled = memPlan.enabled ?? true;
  const memPrice = memPlan.price ?? 99;
  const memMrp = memPlan.mrp ?? 199;
  // Offered only to signed-in non-members, on a real order, when enabled.
  const canJoinPrime = BACKEND && isLoggedIn && memEnabled && !isMember && lines.length > 0;
  const memberFee = addMembership && canJoinPrime ? memPrice : 0;
  // Drop the tick if it stops being offered (member joined, cart emptied, etc.).
  useEffect(() => {
    if (addMembership && !canJoinPrime) setAddMembership(false);
  }, [addMembership, canJoinPrime]);

  const grandTotal = netItems + deliveryFee + handling + surgeFee + memberFee;
  const pointsEarned = pointsForSpend(netItems, rewardsCfg);

  // ── NGS Wallet (store credit) ──────────────────────────
  // The customer can apply their wallet balance to this order. The server caps
  // it at the balance and the total; we mirror that here for the bill display.
  const walletBal = isLoggedIn ? Math.max(0, wallet.balance || 0) : 0;
  const walletCap = Math.min(walletBal, grandTotal);
  const walletApplied = useWalletCredit ? walletCap : 0;
  const payable = Math.max(0, grandTotal - walletApplied);

  // ── Cash-on-delivery cap ───────────────────────────────
  // Above this the rider would carry too much cash, so COD is disabled and the
  // customer must pay online. 0/blank = no cap. Enforced again on the server.
  const COD_LIMIT = settings.codCustomerLimit ?? 1000;
  // COD is unavailable above the cash cap, OR when buying NGS Prime with the order
  // (membership must be prepaid — it activates on payment, not on cash delivery).
  const codBlocked = (COD_LIMIT > 0 && payable > COD_LIMIT) || memberFee > 0;
  // If COD becomes unavailable while it's selected, bump them to online.
  useEffect(() => {
    if (codBlocked && payment === "cod") {
      setPayment(RAZORPAY_ENABLED ? "razorpay" : "upi");
    }
  }, [codBlocked, payment]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delivery area (distance to the nearest shop) ───────
  const maxKm = settings.maxDistanceKm || 0;
  const shops = getShopLocations(settings);
  const areaEnforced = shops.length > 0 && maxKm > 0;
  const dist =
    location && shops.length
      ? Math.round(Math.min(...shops.map((s) => distanceKm(location, s))) * 10) / 10
      : null;
  const outOfArea = areaEnforced && dist != null && dist > maxKm;
  const needsLocation = areaEnforced && !location;

  // Prefill from the saved profile when the field is still empty.
  useEffect(() => {
    if (step !== "checkout") return;
    if (user?.address && !address) setAddress(user.address);
    if (user?.phone && !phone) setPhone(user.phone);
  }, [step, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull the saved default address's coordinates into checkout so an address
  // saved with a map pin carries its location into the order — otherwise the
  // partner has no spot to navigate to and the live map never appears.
  useEffect(() => {
    if (step !== "checkout" || !BACKEND || location) return;
    let alive = true;
    (async () => {
      try {
        const addrs = await api.fetchMyAddresses();
        const def = addrs.find((a) => a.isDefault) || addrs[0];
        if (!alive || !def) return;
        if (def.location && def.location.lat != null) setLocation(def.location);
        if (def.address && !address) setAddress(def.address);
      } catch { /* fall back to typed address */ }
    })();
    return () => { alive = false; };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember the address, phone AND captured GPS location across refreshes, so
  // the customer never has to re-enter them or re-share their location.
  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ address, phone, location })); }
    catch { /* ignore */ }
  }, [address, phone, location]);

  // While the online-payment QR is showing, poll the order until the webhook
  // marks it paid, then jump to the success screen.
  useEffect(() => {
    if (step !== "payqr" || !payLink?.order) return;
    let alive = true;
    const iv = setInterval(async () => {
      try {
        const st = await api.fetchOrderState(payLink.order.dbId);
        if (alive && st?.payment_status === "paid") {
          clearInterval(iv);
          setPlaced({
            total: payLink.order.total, count: payLink.count, eta: 12,
            payment: "razorpay", pointsEarned: payLink.order.pointsEarned, code: payLink.order.id,
          });
          clear();
          setUsePoints(false);
          setUseWalletCredit(false);
          setAddMembership(false);
          setAppliedCode(null);
          setPayLink(null);
          setStep("done");
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, [step, payLink]); // eslint-disable-line react-hooks/exhaustive-deps

  function goToCheckout() {
    if (!settings.storeOpen) return;
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setStep("checkout");
  }

  // As the customer types their address, look up matching places (debounced).
  function onAddressChange(value) {
    setAddress(value);
    clearTimeout(searchTimer.current);
    if (value.trim().length < 3) { setSuggestions([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const shop = getShopLocations(settings)[0];
        const res = await searchAddress(value, shop ? { lat: shop.lat, lng: shop.lng } : null);
        setSuggestions(res);
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 500);
  }

  // Customer picks a place → fill the address and capture its coordinates.
  function pickSuggestion(s) {
    setAddress(s.label);
    setLocation({ lat: s.lat, lng: s.lng, accuracy: null });
    setSuggestions([]);
    setLocError("");
  }

  async function useMyLocation() {
    setLocating(true);
    setLocError("");
    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
      // Auto-fill the address box with the customer's current street address.
      try {
        const addr = await reverseGeocode(loc.lat, loc.lng);
        if (addr) setAddress(addr);
      } catch { /* keep the captured coords even if the lookup fails */ }
    } catch (err) {
      setLocError(err.message);
    } finally {
      setLocating(false);
    }
  }

  function applyCouponCode(code) {
    const res = applyCouponFrom(allCoupons, code ?? couponInput, couponCtx);
    if (res.ok) {
      setAppliedCode(res.code);
      setCouponInput("");
      setCouponError("");
      setShowCoupons(false);
    } else {
      setCouponError(res.error);
    }
  }

  function removeCoupon() {
    setAppliedCode(null);
    setCouponError("");
  }

  const cleanPhone = phone.replace(/\D/g, "");

  async function proceedFromCheckout() {
    // Re-entrancy lock: block a double-tap during the (async) profile save
    // before `placing` is set, so we never create two orders / double-debit.
    if (submitLock.current || placing) return;
    if (!address.trim()) {
      setLocError("Please enter a delivery address.");
      return;
    }
    if (cleanPhone.length !== 10) {
      setLocError("Please enter a valid 10-digit phone number so we can call about your delivery.");
      return;
    }
    // Location is optional — a customer who can't/won't share it can still
    // order using their typed address. The out-of-area block only applies to
    // customers who DID share location and are beyond the delivery radius.
    if (outOfArea) return; // button is disabled, but guard anyway
    // COD is disabled above the cap, but guard anyway (server also enforces).
    if (payment === "cod" && codBlocked) {
      setLocError(`Cash on delivery isn't available above ₹${COD_LIMIT}. Please pay online.`);
      return;
    }
    setLocError("");
    submitLock.current = true;
    try {
      // Save address + phone to the profile. Await it so the server has the phone
      // when place_order records the order (needed to call the customer).
      if (address.trim() !== user?.address || cleanPhone !== user?.phone) {
        await updateProfile({ address: address.trim(), phone: cleanPhone });
      }
      // Wallet covers the whole order → nothing to pay online, place it directly.
      if (payable === 0) await placeOrder();
      else if (payment === "razorpay") await startRazorpay();
      else if (payment === "upi") setStep("pay");
      else await placeOrder();
    } finally {
      submitLock.current = false;
    }
  }

  // Verified online payment. Flow: create a HELD order on the server (real total
  // computed there) → create a Razorpay payment link → show the customer a QR
  // (scan from a computer / another phone) AND a "Pay now" button (opens the
  // secure Razorpay page on this phone). When they pay, the webhook confirms the
  // order server-side and we poll for it. Nothing is confirmed on the phone's
  // word — only a real, verified payment turns the order live.
  async function startRazorpay() {
    setPlacing(true);
    setPlaceError("");
    try {
      const order = await api.placeOrder({
        items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
        coupon: appliedCode || null,
        location: location ? { ...location, distanceKm: dist } : null,
        payment: "razorpay",
        address: orderAddress(),
        wallet: walletApplied,
        redeemPoints: pointsUsed,
        membership: memberFee > 0,
      });
      // Verified native UPI QR shown ON our page (scan with any app → pays
      // directly → auto-confirms via webhook). No redirect to any gateway page.
      // Redraw it as a plain, clean QR (no branded card).
      const { imageUrl, imageDataUrl } = await api.createOrderQr(order.dbId);
      const cleanQr = await cleanUpiQrFromImage(imageDataUrl);
      // Pull the UPI intent string out of the QR so tapping "Pay" can open the
      // customer's UPI app directly (no gateway screen), like a big q-commerce app.
      const upiIntent = await decodeUpiFromQr(imageDataUrl);
      setPayLink({
        imageUrl, imageDataUrl, cleanQr, upiIntent,
        order, count: lines.reduce((a, l) => a + l.qty, 0),
      });
      setStep("payqr");
    } catch (e) {
      setPlaceError(e.message || "Couldn't start the payment. Please try again.");
    } finally {
      setPlacing(false);
    }
  }

  // "Pay on this phone" — opens Razorpay's IN-PAGE checkout overlay (stays on
  // ngsstore.in, branded as the store; no redirect to the gateway's own page).
  // The webhook + the polling effect confirm the order either way.
  async function payOnThisPhone() {
    if (!payLink?.order) return;
    setPlaceError("");
    try {
      const order = payLink.order;
      const rp = await api.createRazorpayOrder(order.dbId);
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: rp.keyId,
        order_id: rp.orderId,
        amount: rp.amount,
        currency: rp.currency || "INR",
        name: "NGS Nisha General Store",
        description: `Order ${order.id}`,
        prefill: {
          name: user?.name || "",
          email: user?.email || "",
          contact: cleanPhone || user?.phone || "",
        },
        theme: { color: "#0a9155" },
        handler: async (resp) => {
          try {
            await api.verifyRazorpayPayment({
              orderId: order.dbId,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            });
          } catch { /* the polling effect / webhook will still confirm it */ }
        },
      });
      rzp.on("payment.failed", (r) =>
        setPlaceError(r?.error?.description || "Payment failed. Please try again."));
      rzp.open();
    } catch (e) {
      setPlaceError(e.message || "Couldn't open payment. Please try again.");
    }
  }

  // Backend checkout: the SERVER recomputes prices, coupon, delivery, total and
  // points via place_order(). The phone only sends product ids + quantities.
  async function placeOrderBackend() {
    setPlacing(true);
    setPlaceError("");
    // If the wallet covers everything, there's nothing to pay online.
    const pay = payable === 0 ? "wallet" : payment;
    try {
      const order = await withMinTime(() => api.placeOrder({
        items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
        coupon: appliedCode || null,
        location: location ? { ...location, distanceKm: dist } : null,
        payment: pay,
        address: orderAddress(),
        wallet: walletApplied,
        redeemPoints: pointsUsed,
        membership: memberFee > 0,
      }), 900, 1800);
      setPlaced({
        // place_order returns only the order row (no joined items), so count
        // the cart we just sent rather than order.count (which would be 0).
        total: order.total,
        count: lines.reduce((a, l) => a + l.qty, 0),
        eta: 12, payment: pay,
        pointsEarned: order.pointsEarned, code: order.id,
        memberSavings: order.memberSavings || 0,
      });
      clear();
      setUsePoints(false);
      setUseWalletCredit(false);
      setAddMembership(false);
      setAppliedCode(null);
      setStep("done");
    } catch (e) {
      setPlaceError(e.message || "Couldn't place the order. Please try again.");
      setStep("checkout");
    } finally {
      setPlacing(false);
    }
  }

  function placeOrder() {
    if (BACKEND) return placeOrderBackend();
    const count = lines.reduce((a, l) => a + l.qty, 0);
    const order = {
      id: "NGS" + Math.floor(1000 + Math.random() * 9000),
      createdAt: new Date().toISOString(),
      userId: user?.id,
      customer: user?.name || "You",
      userPhone: cleanPhone || user?.phone || "",
      address: orderAddress(),
      location,
      distanceKm: dist,
      payment,
      member: isMember,
      priority: isMember, // members get first priority
      accepted: false, // waits for admin to accept on the incoming screen
      status: "Placed",
      items: lines.map(({ product, qty }) => ({
        id: product.id,
        name: product.name,
        image: product.image,
        category: product.category,
        qty,
        price: product.price,
      })),
      itemTotal,
      discount,
      couponCode: couponDiscount > 0 ? appliedCode : null,
      couponDiscount,
      pointsUsed,
      pointsEarned,
      deliveryFee,
      handling,
      surgeFee,
      total: grandTotal,
      count,
    };
    saveOrder(order);
    decrementStock(order.items); // keep inventory / low-stock alerts in sync
    // Update the customer's points: earn on what they paid, spend what they used.
    applyRewards({ earned: pointsEarned, used: pointsUsed });
    setPlaced({ total: grandTotal, count, eta: 12, payment, pointsEarned });
    clear();
    setUsePoints(false);
    setAppliedCode(null);
    setStep("done");
  }

  // Leaving the online-payment screen without paying: cancel the still-unpaid
  // order so it doesn't linger. Nothing was charged (points/wallet debit only
  // at confirmation), so this is just cleanup.
  function abandonPayQrIfAny() {
    if (step === "payqr" && payLink?.order?.dbId) {
      api.cancelPendingOrder(payLink.order.dbId).catch(() => {});
    }
  }

  function leaveStep() {
    if (step === "payqr") abandonPayQrIfAny();
    setStep(step === "pay" || step === "payqr" ? "checkout" : "cart");
  }

  function handleClose() {
    abandonPayQrIfAny();
    setStep("cart");
    setPlaced(null);
    setPayLink(null);
    setLocError("");
    onClose();
  }

  // Back button / gesture: step back through checkout → cart → close, instead
  // of falling through to the website home.
  useBackGuard(open, handleClose);
  useBackGuard(open && (step === "checkout" || step === "pay" || step === "payqr"), () => setStep("cart"));
  useBackGuard(open && (step === "pay" || step === "payqr"), leaveStep);

  const upiLink = buildUpiLink({ amount: payable, note: "NGS Store order" });
  const storeClosed = !settings.storeOpen;

  return (
    <>
      {placing && <ActionOverlay variant="customer" mode="processing" title="Placing your order…" sub="Just a moment" accent="#0AA25F" />}
      <div className={`drawer-overlay ${open ? "show" : ""}`} onClick={handleClose} />
      <aside className={`cart-drawer ${open ? "open" : ""}`}>
        <div className="drawer-head">
          {step !== "cart" && step !== "done" && (
            <button
              className="back-btn small"
              onClick={leaveStep}
              aria-label="Back"
            >
              ←
            </button>
          )}
          <h2>
            {step === "done"
              ? "Order placed"
              : step === "pay"
              ? "Pay with UPI"
              : step === "payqr"
              ? "Pay online"
              : step === "checkout"
              ? "Checkout"
              : "My Cart"}
          </h2>
          <button className="drawer-close" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {step === "done" && placed ? (
          <div className="order-success">
            <svg className="ov-check success-anim" viewBox="0 0 72 72" aria-hidden="true" style={{ "--ov-accent": "#0AA25F" }}>
              <circle cx="36" cy="36" r="27" />
              <path d="M23 37 l9 9 l17 -19" />
            </svg>
            <h3>Order confirmed!</h3>
            <p>
              {placed.count} item{placed.count > 1 ? "s" : ""} • ₹{placed.total}
            </p>
            <p className="success-pay">
              {placed.payment === "razorpay"
                ? "Paid online"
                : placed.payment === "upi"
                ? "Paid via UPI"
                : placed.payment === "wallet"
                ? "Paid with NGS Wallet"
                : "Cash on delivery"}
            </p>
            {placed.memberSavings > 0 && (
              <p className="success-savings">
                You saved <strong>₹{Math.round(placed.memberSavings)}</strong> with NGS Prime
              </p>
            )}
            {placed.pointsEarned > 0 && (
              <p className="success-points">
                You earned <strong>{placed.pointsEarned} points</strong>
              </p>
            )}
            <p className="success-eta">
              Arriving in <strong>{placed.eta} minutes</strong>
            </p>
            <button className="checkout-btn" onClick={handleClose}>
              Continue shopping
            </button>
          </div>
        ) : step === "payqr" && payLink ? (
          <div className="pay-step pay-pro">
            <div className="pay-merchant">
              <span className="pay-merchant-av">N</span>
              <span className="pay-merchant-name">
                NGS · Nisha General Store
                <svg className="pay-verified" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="11" fill="#2a9bf0" />
                  <path d="M7 12.3l3.2 3.2L17 8.7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="pay-merchant-vpa">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5z" /></svg>
                Secured by Razorpay
              </span>
            </div>

            <div className="pay-big">₹{Number(payLink.order.total).toFixed(2)}</div>
            <div className="pay-words">{rupeesInWords(payLink.order.total)}</div>

            <div className="upi-qr-wrap">
              <img
                className={`upi-qr ${payLink.cleanQr ? "clean" : ""}`}
                src={payLink.cleanQr || payLink.imageDataUrl || payLink.imageUrl}
                alt="UPI payment QR code"
              />
              <p className="upi-hint">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) — pays directly</p>
            </div>

            {/* Tap your UPI app to pay — opens that app directly with the amount
                pre-filled (targeting a specific app avoids the generic upi:// link
                being grabbed by the wrong handler). Falls back to Razorpay's sheet
                for cards / any other method, or if an app isn't installed. */}
            {payLink.upiIntent ? (
              <>
                <div className="upi-apps-label">Pay by UPI app</div>
                <div className="upi-apps">
                  {UPI_APPS.map((app) => (
                    <a className="upi-app" key={app.id} href={upiAppHref(payLink.upiIntent, app)}>
                      <span className="upi-app-ic">
                        <img src={app.logo} alt={app.name} />
                      </span>
                      <span className="upi-app-name">{app.name}</span>
                    </a>
                  ))}
                </div>
                <button className="pay-paid-link" onClick={payOnThisPhone}>
                  Pay by card / other methods
                </button>
              </>
            ) : (
              <button className="pay-proceed" onClick={payOnThisPhone}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5z" /><path d="M9 12l2 2 4-4" /></svg>
                Pay ₹{Number(payLink.order.total).toFixed(2)}
              </button>
            )}
            <p className="upi-note">
              After you pay, this screen confirms automatically — you don't need
              to do anything else.
            </p>
            {placeError && <div className="auth-error">{placeError}</div>}
          </div>
        ) : step === "pay" ? (
          <div className="pay-step pay-pro">
            <div className="pay-merchant">
              <span className="pay-merchant-av">N</span>
              <span className="pay-merchant-name">
                NGS · Nisha General Store
                <svg className="pay-verified" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="11" fill="#2a9bf0" />
                  <path d="M7 12.3l3.2 3.2L17 8.7" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="pay-merchant-vpa">🇮🇳 {SHOP_UPI_ID}</span>
            </div>

            <div className="pay-big">₹{payable.toFixed(2)}</div>
            <div className="pay-words">{rupeesInWords(payable)}</div>

            <div className="upi-qr-wrap">
              <img className="upi-qr" src={qrDataUri(upiLink)} alt="UPI QR code" />
              <p className="upi-hint">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM)</p>
            </div>

            <div className="upi-id-row">
              <span>Or pay to UPI ID</span>
              <code>{SHOP_UPI_ID}</code>
            </div>
            {placeError && <div className="auth-error">{placeError}</div>}
            <a className="pay-proceed" href={upiLink}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5z" /><path d="M9 12l2 2 4-4" /></svg>
              Proceed Securely · ₹{payable.toFixed(2)}
            </a>
            <button className="pay-paid-link" onClick={placeOrder} disabled={placing}>
              {placing ? "Placing…" : "I've already paid — place my order"}
            </button>
            <p className="upi-note">
              Your order is confirmed once the payment goes through.
            </p>
          </div>
        ) : step === "checkout" ? (
          <div className="checkout-step">
            {/* Delivery ETA + order review — mirrors a quick-commerce checkout. */}
            <div className="co-eta">
              <span className="co-eta-ic">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
              </span>
              <div className="co-eta-txt">
                <strong>Delivery in ~12 minutes</strong>
                <small>{lines.reduce((a, l) => a + l.qty, 0)} item{lines.reduce((a, l) => a + l.qty, 0) === 1 ? "" : "s"} in your order</small>
              </div>
            </div>

            <div className="checkout-section co-items-sec">
              <h4>Your order</h4>
              {lines.map(({ product, qty, unit }) => (
                <div className="co-item" key={product.id}>
                  <ProductThumb image={product.image} name={product.name} category={product.category} size={42} radius={9} />
                  <div className="co-item-main">
                    <span className="co-item-name">{product.name}</span>
                    {product.unit && <span className="co-item-unit">{product.unit}</span>}
                  </div>
                  <div className="co-item-qty">
                    <button type="button" onClick={() => remove(product.id)} aria-label="Remove one">−</button>
                    <span>{qty}</span>
                    <button type="button" onClick={() => add(product.id, product.stock)} aria-label="Add one">+</button>
                  </div>
                  <span className="co-item-price">₹{unit * qty}</span>
                </div>
              ))}
            </div>

            {/* Subscribe: prominent, right under the order — not buried at the end */}
            {isLoggedIn && !belowMin && !outOfArea && !needsLocation && (
              <button
                type="button"
                className="sub-promo"
                onClick={() => setSubOpen(true)}
                disabled={placing}
              >
                <span className="sub-promo-ic">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v4h-4" />
                  </svg>
                </span>
                <span className="sub-promo-text">
                  <strong>Get this delivered daily</strong>
                  <span>Subscribe &amp; prepay — milk at your door every morning</span>
                </span>
                <span className="sub-promo-arrow">→</span>
              </button>
            )}

            <div className="checkout-section">
              <h4>Delivery address</h4>

              {/* Hero action: one tap captures the customer's exact GPS spot —
                  the fastest and most accurate way for a home delivery. */}
              <button className="gps-hero" onClick={useMyLocation} disabled={locating}>
                <span className="gps-hero-ic">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
                </span>
                <span className="gps-hero-txt">
                  <strong>{locating ? "Getting your location…" : "Use my current location"}</strong>
                  <small>Fastest &amp; most accurate — one tap</small>
                </span>
              </button>

              <div className="loc-or"><span>or type it below</span></div>

              <div className="address-autocomplete">
                <textarea
                  className="checkout-address"
                  rows={3}
                  value={address}
                  onChange={(e) => onAddressChange(e.target.value)}
                  placeholder="House / flat no, building, street, area, landmark"
                />
                {(searching || suggestions.length > 0) && (
                  <div className="address-suggest">
                    {searching && suggestions.length === 0 && (
                      <div className="address-suggest-loading">Searching the map…</div>
                    )}
                    {suggestions.map((s, i) => (
                      <button
                        type="button"
                        className="address-suggest-item"
                        key={i}
                        onClick={() => pickSuggestion(s)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="location-btn wide" onClick={() => setShowMap(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s7-6.3 7-12A7 7 0 0 0 5 10c0 5.7 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg>
                Pin exact spot on map
              </button>
              <p className="address-hint">
                Tip: tap <strong>Use my current location</strong> if you're at
                home — it's the most reliable. Then add your house / flat number.
              </p>
              <div className="checkout-phone">
                <span className="checkout-phone-cc">+91</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  placeholder="Phone number (for delivery calls)"
                />
              </div>
              {needsLocation && (
                <div className="area-hint">
                  Tip: pin your exact spot on the map so delivery reaches the
                  right door. You can still order without it.
                </div>
              )}
              {location && (
                <div className={`location-captured ${outOfArea ? "bad" : ""}`}>
                  <span>
                    Location captured
                    <br />
                    <small>
                      {location.lat}, {location.lng}
                      {dist != null ? ` · ${dist} km from shop` : ""}
                    </small>
                  </span>
                  <a
                    href={googleMapsLink(location)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="view-map-link"
                  >
                    View on Google Maps →
                  </a>
                </div>
              )}
              {outOfArea && (
                <div className="area-blocked">
                  Sorry, you're about <strong>{dist} km</strong> away — we
                  currently deliver within <strong>{maxKm} km</strong>.
                  <br />
                  We're coming to your area soon.
                </div>
              )}
              {dist != null && !outOfArea && (
                <div className="area-ok">We deliver to your area</div>
              )}
              {locError && <div className="auth-error">{locError}</div>}
            </div>

            <div className="checkout-section pay-sec">
              <h4>Payment method</h4>

              <div className="pay-group-label">Recommended</div>
              {RAZORPAY_ENABLED ? (
                <label className={`pay-row ${payment === "razorpay" ? "sel" : ""}`}>
                  <input type="radio" name="pay" checked={payment === "razorpay"} onChange={() => setPayment("razorpay")} />
                  <span className="pay-row-ic online">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/></svg>
                  </span>
                  <span className="pay-row-txt">
                    <strong>Pay online</strong>
                    <small>Secure &amp; instant — via Razorpay</small>
                    <span className="pay-chips"><span>UPI</span><span>Cards</span><span>Wallets</span><span>Netbanking</span></span>
                  </span>
                  <span className="pay-radio" aria-hidden="true" />
                </label>
              ) : (
                <label className={`pay-row ${payment === "upi" ? "sel" : ""}`}>
                  <input type="radio" name="pay" checked={payment === "upi"} onChange={() => setPayment("upi")} />
                  <span className="pay-row-ic online">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>
                  </span>
                  <span className="pay-row-txt">
                    <strong>UPI</strong>
                    <small>GPay, PhonePe, Paytm, BHIM</small>
                  </span>
                  <span className="pay-radio" aria-hidden="true" />
                </label>
              )}

              {walletBal > 0 && (
                <>
                  <div className="pay-group-label">Wallet</div>
                  <label className={`pay-row ${useWalletCredit ? "sel" : ""}`}>
                    <input type="checkbox" checked={useWalletCredit} onChange={(e) => setUseWalletCredit(e.target.checked)} />
                    <span className="pay-row-ic wallet">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M16 12h3"/><path d="M2.5 9h14a2 2 0 0 1 2 2"/></svg>
                    </span>
                    <span className="pay-row-txt">
                      <strong>NGS Wallet</strong>
                      <small>Balance ₹{walletBal.toFixed(2)} · use ₹{walletCap.toFixed(2)} on this order</small>
                    </span>
                    <span className="pay-check" aria-hidden="true" />
                  </label>
                </>
              )}

              <div className="pay-group-label">Pay on delivery</div>
              <label className={`pay-row ${payment === "cod" ? "sel" : ""} ${codBlocked ? "disabled" : ""}`}>
                <input
                  type="radio"
                  name="pay"
                  checked={payment === "cod"}
                  disabled={codBlocked}
                  onChange={() => !codBlocked && setPayment("cod")}
                />
                <span className="pay-row-ic cod">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.5"/></svg>
                </span>
                <span className="pay-row-txt">
                  <strong>Cash on delivery</strong>
                  <small>
                    {memberFee > 0
                      ? "Not available with NGS Prime — please pay online"
                      : codBlocked
                      ? `Not available above ₹${COD_LIMIT} — please pay online`
                      : "Pay when your order arrives"}
                  </small>
                </span>
                <span className="pay-radio" aria-hidden="true" />
              </label>
            </div>

            {canJoinPrime && (
              <PrimeAddon price={memPrice} mrp={memMrp} checked={addMembership}
                onToggle={() => setAddMembership((v) => !v)} />
            )}

            <div className="checkout-section">
              <h4>Delivery instructions <span className="co-optional">optional</span></h4>
              <div className="co-notes">
                {DELIVERY_NOTES.map((n) => (
                  <button
                    type="button"
                    key={n.label}
                    className={`co-note ${deliveryNotes.includes(n.label) ? "on" : ""}`}
                    onClick={() => toggleNote(n.label)}
                  >
                    <span className="co-note-ic" aria-hidden="true">{n.icon}</span>
                    {n.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Fees (delivery / handling / surge) were already itemised on the
                cart's Bill details — don't repeat them here. Only show the
                adjustments the customer makes on this screen (points, coupon,
                Prime, wallet) and the final amount to pay. */}
            <div className="bill compact">
              {discount > 0 && (
                <div className="bill-row">
                  <span>Points discount</span>
                  <span className="free">−₹{discount}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="bill-row">
                  <span>Coupon ({appliedCode})</span>
                  <span className="free">−₹{couponDiscount}</span>
                </div>
              )}
              {memberFee > 0 && (
                <div className="bill-row">
                  <span>NGS Prime membership</span>
                  <span>₹{memberFee}</span>
                </div>
              )}
              {walletApplied > 0 && (
                <div className="bill-row">
                  <span>NGS Wallet</span>
                  <span className="free">−₹{walletApplied.toFixed(2)}</span>
                </div>
              )}
              <div className="bill-row total">
                <span>To pay</span>
                <span>₹{payable.toFixed(2)}</span>
              </div>
            </div>

            <div className="co-policy">
              <strong>Cancellation policy</strong>
              <p>
                You can cancel free of charge before your order is packed. Once
                the rider is on the way it may not be cancellable. Prepaid refunds
                go back to your NGS Wallet.
              </p>
            </div>

            {placeError && <div className="auth-error">{placeError}</div>}
            <button
              className="checkout-btn place"
              onClick={proceedFromCheckout}
              disabled={outOfArea || placing}
            >
              {placing
                ? "Placing…"
                : outOfArea
                ? "Outside delivery area"
                : payable === 0
                ? "Place order • ₹0 (Wallet)"
                : payment === "razorpay"
                ? `Pay ₹${payable.toFixed(2)} securely`
                : payment === "upi"
                ? `Pay ₹${payable.toFixed(2)} with UPI`
                : `Place order • ₹${payable.toFixed(2)}`}
            </button>
          </div>
        ) : lines.length === 0 ? (
          <div className="cart-empty">
            <div className="empty-icon" aria-hidden="true">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="21" r="1" />
                <circle cx="19" cy="21" r="1" />
                <path d="M2.5 3h2l2.2 12.4a1.6 1.6 0 0 0 1.6 1.3h9.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7H6" />
              </svg>
            </div>
            <p>Your cart is empty</p>
            <span>Add items to get started</span>
            <button className="checkout-btn" onClick={handleClose}>
              Browse products
            </button>
          </div>
        ) : (
          <>
            {storeClosed ? (
              <div className="store-closed-note">
                <span className="status-dot closed" aria-hidden="true" />
                The store is currently <strong>closed</strong>. You can build
                your cart, and ordering resumes the moment we reopen.
              </div>
            ) : (
              <div className="delivery-note">
                <span className="status-dot live" aria-hidden="true" />
                Arriving in <strong>12 minutes</strong>
                {isSurge && (
                  <span className="surge-tag"> · Surge pricing in effect</span>
                )}
              </div>
            )}

            <div className="cart-lines">
              {lines.map(({ product, qty, unit }) => {
                const nextTier = (product.bulkTiers || []).find((t) => t.q > qty);
                const bulkOn = unit < product.price;
                const lineMrp = Math.max(Number(product.mrp) || 0, unit);
                return (
                <div className="cart-line" key={product.id}>
                  <div className="cart-line-icon">
                    <ProductThumb
                      image={product.image}
                      name={product.name}
                      category={product.category}
                      size={44}
                    />
                  </div>
                  <div className="cart-line-info">
                    <div className="cart-line-name">{product.name}</div>
                    <div className="cart-line-unit">
                      {product.unit}
                      {bulkOn && <span className="cart-line-bulk"> · ₹{unit}/ea bulk</span>}
                    </div>
                    {nextTier && (
                      <div className="cart-line-nudge">
                        Add {nextTier.q - qty} more → ₹{nextTier.price}/ea
                      </div>
                    )}
                  </div>
                  <div className="cart-line-right">
                    <div className="qty-stepper small">
                      <button onClick={() => remove(product.id)}>−</button>
                      <span>{qty}</span>
                      <button
                        onClick={() => add(product.id, product.stock)}
                        disabled={typeof product.stock === "number" && qty >= product.stock}
                      >+</button>
                    </div>
                    {typeof product.stock === "number" && qty >= product.stock && (
                      <div className="cart-line-max">Only {product.stock} in stock</div>
                    )}
                    <div className="cart-line-price">
                      ₹{unit * qty}
                      {lineMrp > unit && <span className="cart-line-was">₹{lineMrp * qty}</span>}
                    </div>
                    <button
                      className="line-delete"
                      onClick={() => deleteItem(product.id)}
                      aria-label="Remove item"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 5v6m4-6v6" />
                      </svg>
                    </button>
                  </div>
                </div>
                );
              })}
            </div>

            {canRedeem && isLoggedIn && availablePoints > 0 && maxRedeemRupees > 0 && (
              <label className="use-points">
                <input
                  type="checkbox"
                  checked={usePoints}
                  onChange={(e) => setUsePoints(e.target.checked)}
                />
                <span>
                  Redeem {maxRedeemRupees * redeemPer} points for{" "}
                  <strong>₹{maxRedeemRupees} off</strong>
                  <small>{availablePoints} points available</small>
                </span>
              </label>
            )}

            {/* Coupon */}
            <div className="coupon-box">
              {appliedCode && couponDiscount > 0 ? (
                <div className="coupon-applied">
                  <span>
                    <strong>{appliedCode}</strong> applied — ₹{couponDiscount} off
                  </span>
                  <button className="coupon-remove" onClick={removeCoupon}>
                    Remove
                  </button>
                </div>
              ) : (
                <>
                  <div className="coupon-input-row">
                    <input
                      className="coupon-input"
                      value={couponInput}
                      onChange={(e) => {
                        setCouponInput(e.target.value.toUpperCase());
                        setCouponError("");
                      }}
                      placeholder="Coupon code"
                    />
                    <button
                      className="coupon-apply"
                      onClick={() => applyCouponCode()}
                    >
                      Apply
                    </button>
                  </div>
                  {(couponError || couponInvalid) && (
                    <div className="coupon-error">
                      {couponError || couponResult.error}
                    </div>
                  )}

                  {activeCoupons.length > 0 && (
                    <button
                      className="coupon-browse-toggle"
                      onClick={() => setShowCoupons((s) => !s)}
                    >
                      {showCoupons ? "Hide coupons" : "View available coupons"}
                    </button>
                  )}

                  {showCoupons && (
                    <div className="coupon-list">
                      {activeCoupons.map((c) => {
                        const ev = applyCouponFrom(allCoupons, c.code, couponCtx);
                        const off =
                          c.type === "percent"
                            ? `${c.value}% OFF`
                            : `₹${c.value} OFF`;
                        const cond = [
                          c.category ? `on ${catName(c.category)}` : null,
                          c.minOrder > 0 ? `min ₹${c.minOrder}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <div className="coupon-card" key={c.code}>
                            <div className="coupon-card-left">
                              <div className="coupon-card-code">
                                {c.code}
                                <span className="coupon-card-off">{off}</span>
                              </div>
                              {cond && (
                                <div className="coupon-card-cond">{cond}</div>
                              )}
                              {!ev.ok && (
                                <div className="coupon-card-reason">{ev.error}</div>
                              )}
                            </div>
                            <button
                              className="coupon-card-apply"
                              disabled={!ev.ok}
                              onClick={() => applyCouponCode(c.code)}
                            >
                              {ev.ok ? "Apply" : "—"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            <AddonSuggestions lines={lines} onAdd={add} user={user} rewardsCfg={settings.rewards} />

            {canJoinPrime && (
              <PrimeAddon price={memPrice} mrp={memMrp} checked={addMembership}
                onToggle={() => setAddMembership((v) => !v)} />
            )}

            <div className="bill">
              <h4>Bill details</h4>
              <div className="bill-row">
                <span>Item total</span>
                <span>₹{itemTotal}</span>
              </div>
              {discount > 0 && (
                <div className="bill-row">
                  <span>Points discount</span>
                  <span className="free">−₹{discount}</span>
                </div>
              )}
              {couponDiscount > 0 && (
                <div className="bill-row">
                  <span>Coupon ({appliedCode})</span>
                  <span className="free">−₹{couponDiscount}</span>
                </div>
              )}
              <div className="bill-row">
                <span>Delivery fee</span>
                <span>
                  {deliveryFee === 0 ? (
                    <span className="free">
                      FREE{freeReason === "member" ? " · Prime" : ""}
                    </span>
                  ) : (
                    `₹${deliveryFee}`
                  )}
                </span>
              </div>
              <div className="bill-row">
                <span>Handling charge</span>
                <span>{handling === 0 && isMember ? <span className="free">FREE · Prime</span> : `₹${handling}`}</span>
              </div>
              {surgeFee > 0 && (
                <div className="bill-row">
                  <span>Surge charge <small>(bad weather / peak)</small></span>
                  <span>₹{surgeFee}</span>
                </div>
              )}
              {memberFee > 0 && (
                <div className="bill-row">
                  <span>NGS Prime membership</span>
                  <span>₹{memberFee}</span>
                </div>
              )}
              <div className="bill-row total">
                <span>To pay</span>
                <span>₹{grandTotal}</span>
              </div>
              {savings > 0 && (
                <div className="savings-pill">You save ₹{savings} on this order</div>
              )}
              {!isMember && itemTotal > 0 && (
                <div className="free-progress">
                  <div className="free-progress-top">
                    {qualifyingTotal >= FREE_DELIVERY_ABOVE ? (
                      <span className="free-progress-done">Free delivery unlocked</span>
                    ) : (
                      <span>
                        Add <strong>₹{Math.max(0, FREE_DELIVERY_ABOVE - qualifyingTotal)}</strong> more for FREE delivery
                      </span>
                    )}
                  </div>
                  <div className="free-progress-bar">
                    <span
                      style={{
                        width: `${Math.min(100, Math.round((qualifyingTotal / FREE_DELIVERY_ABOVE) * 100))}%`,
                      }}
                    />
                  </div>
                  {itemTotal > qualifyingTotal && qualifyingTotal < FREE_DELIVERY_ABOVE && (
                    <small className="free-hint-note">milk, curd &amp; bread don't count toward this</small>
                  )}
                </div>
              )}
              {itemTotal > 0 && (
                <div className="earn-hint">
                  You'll earn reward points on this order
                </div>
              )}
            </div>

            {belowMin && (
              <div className="min-order-note">
                Minimum order is ₹{minOrder} — add ₹{minShortfall} more to check out.
              </div>
            )}
            <button
              className="checkout-btn place"
              onClick={goToCheckout}
              disabled={storeClosed || belowMin}
            >
              {storeClosed
                ? "Store closed"
                : belowMin
                ? `Add ₹${minShortfall} more`
                : `Proceed to checkout • ₹${grandTotal}`}
            </button>
          </>
        )}
      </aside>
      <MapPicker
        open={showMap}
        initial={location || getShopLocations(settings)[0] || null}
        onClose={() => setShowMap(false)}
        onConfirm={(lat, lng, addr) => {
          setLocation({ lat, lng, accuracy: null });
          if (addr) setAddress(addr);
          setSuggestions([]);
          setLocError("");
          setShowMap(false);
        }}
      />
      <SubscribeSheet
        open={subOpen}
        onClose={() => setSubOpen(false)}
        items={lines.map(({ product, qty }) => ({ id: product.id, qty }))}
        summaryProducts={lines.map((l) => l.product)}
        dailyTotal={subItemsTotal}
        deliveryFee={settings.subDeliveryFee ?? 10}
        address={orderAddress ? orderAddress() : address}
        location={location ? { ...location, distanceKm: dist } : null}
        user={user}
      />
    </>
  );
}

// "Add something extra" — high-margin add-ons the customer can tap into the cart
// right before checkout. Ranked by our margin server-side (cost stays private).
function AddonSuggestions({ lines, onAdd, user, rewardsCfg }) {
  const [items, setItems] = useState([]);
  const ids = lines.map((l) => l.product.id).sort().join(",");
  useEffect(() => {
    let alive = true;
    const exclude = ids ? ids.split(",") : [];
    // Ask for a few extra so we still show ~10 after any client-side gaps.
    api.fetchAddonSuggestions(exclude, 12).then((s) => { if (alive) setItems(s); }).catch(() => {});
    return () => { alive = false; };
  }, [ids]);
  if (!items.length) return null;
  return (
    <div className="addons">
      <div className="addons-head">You might also want</div>
      <div className="addons-row">
        {items.map((p) => {
          const price = tierUnitPrice(p, 1, user, rewardsCfg); // this shopper's price
          return (
            <div className="addon-card" key={p.id}>
              <ProductThumb image={p.image} name={p.name} category={p.category} size={56} radius={10} />
              <div className="addon-name">{p.name}</div>
              <div className="addon-price">₹{price}{p.mrp > price ? <s>₹{p.mrp}</s> : null}</div>
              <button className="addon-add" onClick={() => onAdd(p.id)}>ADD</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Checkout upsell — a tick to add NGS Prime to this order. Shows the crossed
// original price so the deal reads as a saving. Toggling it flows the fee into
// the bill/total; the server activates the plan when the order is confirmed.
function PrimeAddon({ price, mrp, checked, onToggle }) {
  return (
    <button
      type="button"
      className={`prime-addon ${checked ? "on" : ""}`}
      onClick={onToggle}
      aria-pressed={checked}
    >
      <span className={`prime-addon-tick ${checked ? "on" : ""}`} aria-hidden="true">
        {checked ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        ) : null}
      </span>
      <span className="prime-addon-body">
        <span className="prime-addon-title">
          Add <b>NGS Prime</b> to this order
          <span className="prime-addon-badge">FREE delivery</span>
        </span>
        <span className="prime-addon-sub">Free delivery &amp; member deals for 30 days</span>
      </span>
      <span className="prime-addon-price">
        {mrp > price && <s>₹{mrp}</s>}
        <b>₹{price}</b>
      </span>
    </button>
  );
}
