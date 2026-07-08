import { useState, useEffect, useCallback, Component } from "react";
import {
  db, DEFAULT_PRODUCTS, formatINR, genId, searchProducts,
  buildUpiLink, buildUpiQrUrl, S_ORDER, S_LABEL, css,
} from "../shared/core.js";

// ─────────────────────────────────────────────────────────────────────────────
// NGS STORE — CUSTOMER APP
// Shoppers browse products, add to cart, and place orders. Orders are written to
// the shared Supabase database (see ../shared/core.js), where the separate NGS
// Store Admin app picks them up. This app contains NO admin/manager features.
// ─────────────────────────────────────────────────────────────────────────────

function ShopView({ products, cart, cat, setCat, setCart, storeOpen }) {
  const [search, setSearch] = useState("");
  const cats = ["All", ...Array.from(new Set(products.map(p => p.category)))];
  const categoryFiltered = cat === "All" ? products : products.filter(p => p.category === cat);
  const filtered = search.trim() ? searchProducts(categoryFiltered, search) : categoryFiltered;
  return (
    <div className="main">
      {!storeOpen && <div className="store-closed-banner">🔒 Store is currently closed — not accepting orders</div>}
      <div className="hero-band">
        <h2>Fresh from the Market</h2>
        <p>Quality groceries, delivered to your door</p>
        <div className="hero-leaf">🌿</div>
      </div>
      <div className="search-box">
        <span className="search-icon">🔍</span>
        <input
          className="search-input"
          placeholder="Search products..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")}>✕</button>
        )}
      </div>
      <div className="cats">
        {cats.map(c => <button key={c} className={"cat-pill" + (cat === c ? " active" : "")} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      {search.trim() && (
        <div className="search-results-info">
          {filtered.length} result{filtered.length !== 1 ? "s" : ""} for "{search}"
        </div>
      )}
      {!search.trim() && <div className="sec-head">Products</div>}
      {filtered.length === 0 ? (
        <div className="search-no-results">
          <div className="big">🔍</div>
          <p style={{ color: "var(--bark-light)", fontWeight: 500 }}>No products found</p>
          <p style={{ fontSize: 13, color: "var(--bark-light)", marginTop: 4 }}>Try a different search term</p>
        </div>
      ) : (
      <div className="pgrid">
        {filtered.map(p => {
          const qty = cart[p.id] || 0;
          return (
            <div className="pcard" key={p.id}>
              <div className="pcard-emoji">{p.emoji}</div>
              <div className="pcard-name">{p.name}</div>
              <div className="pcard-cat">{p.category}</div>
              <div className="pcard-price">{formatINR(p.price)} <span>/{p.unit}</span></div>
              {p.mrp && p.mrp > p.price && (
                <div className="mrp-row">
                  <span className="mrp-strike">MRP {formatINR(p.mrp)}</span>
                  <span className="discount-badge">{Math.round((p.mrp - p.price) / p.mrp * 100)}% OFF</span>
                </div>
              )}
              {p.slabs && p.slabs.length > 0 && (
                <div className="slab-box">
                  <div className="slab-heading">🏷️ Bulk Deals</div>
                  {p.slabs.map((s,i) => {
                    const saving = Math.round(((p.price - s.price) / p.price) * 100);
                    const isActive = qty >= s.qty && (i === p.slabs.length-1 || qty < p.slabs[i+1].qty);
                    return (
                      <div key={i} className={"slab-row"+(isActive?" active-slab":"")} onClick={()=>setCart(c=>({...c,[p.id]:s.qty}))}>
                        <span className="slab-qty">Buy {s.qty}+</span>
                        <span className="slab-price">₹{s.price}/{p.unit}</span>
                        {saving > 0 && <span className="slab-save">Save {saving}%</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {qty === 0
                ? <button className="add-btn" onClick={() => setCart(c => ({ ...c, [p.id]: 1 }))}>+ Add</button>
                : <div className="qty-row">
                    <button className="qty-btn" onClick={() => setCart(c => { const n={...c}; n[p.id]>1?n[p.id]--:delete n[p.id]; return n; })}>−</button>
                    <span className="qty-n">{qty}</span>
                    <button className="qty-btn" onClick={() => setCart(c => ({ ...c, [p.id]: (c[p.id]||0)+1 }))}>+</button>
                  </div>
              }
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

const CUSTOMER_PROFILE_KEY = "ngs_profile";

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(CUSTOMER_PROFILE_KEY) || "null"); } catch { return null; }
}
function saveProfile(data) {
  try { localStorage.setItem(CUSTOMER_PROFILE_KEY, JSON.stringify(data)); } catch {}
}

function CartView({ products, cart, setCart, onOrderPlaced, setTab, success, setSuccess, storeOpen, charges }) {
  const profile = loadProfile();
  const [name, setName] = useState(profile?.name || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [address, setAddress] = useState(profile?.address || "");
  const [location, setLocation] = useState(profile?.location || null);
  const [locLoading, setLocLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [profileSaved, setProfileSaved] = useState(!!profile);
  const [paymentMethod, setPaymentMethod] = useState("cod"); // "cod" | "upi"
  const [showPaymentScreen, setShowPaymentScreen] = useState(false);
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); };
  const getEffectivePrice = (p, qty) => {
    if (!p.slabs || p.slabs.length === 0) return p.price;
    const applicable = [...p.slabs].reverse().find(s => qty >= s.qty);
    return applicable ? applicable.price : p.price;
  };
  const cartTotal = Object.entries(cart).reduce((s, [id, qty]) => {
    const p = products.find(x => x.id === Number(id));
    if (!p) return s;
    return s + getEffectivePrice(p, qty) * qty;
  }, 0);

  const activeCharges = (charges || []).filter(c => c.active);
  const chargesTotal = activeCharges.reduce((s, c) => s + Number(c.price), 0);
  const grandTotal = cartTotal + chargesTotal;

  const getLocation = () => {
    if (!navigator.geolocation) { showToast("⚠️ Location not supported"); return; }
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
        const data = await res.json();
        const addr = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        setAddress(addr); setLocation({ lat, lng, label: addr }); showToast("📍 Location captured!");
      } catch { setAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`); setLocation({ lat, lng }); }
      setLocLoading(false);
    }, () => { showToast("❌ Location denied"); setLocLoading(false); });
  };

  const buildOrder = () => {
    const items = Object.entries(cart).map(([id, qty]) => ({ ...products.find(x => x.id === Number(id)), qty }));
    return {
      id: genId(), timestamp: Date.now(), items, total: grandTotal, subtotal: cartTotal,
      charges: activeCharges, customer: { name, phone, address, location: location||null },
      status: "pending",
      payment: { method: paymentMethod, status: paymentMethod === "cod" ? "cod" : "awaiting_confirmation" },
    };
  };

  const finalizeOrder = async (order) => {
    saveProfile({ name, phone, address, location: location||null });
    setProfileSaved(true);
    await onOrderPlaced(order, phone);
    setCart({});
  };

  const handlePlaceOrder = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) { showToast("⚠️ Fill all fields"); return; }
    const order = buildOrder();
    if (paymentMethod === "upi") {
      setPendingOrder(order);
      setShowPaymentScreen(true);
      return;
    }
    await finalizeOrder(order);
  };

  const handleConfirmUpiPayment = async () => {
    if (!pendingOrder) return;
    const paidOrder = { ...pendingOrder, payment: { ...pendingOrder.payment, status: "customer_confirmed_paid" } };
    setPaymentConfirmed(true);
    await finalizeOrder(paidOrder);
  };

  const handleClearProfile = () => {
    localStorage.removeItem(CUSTOMER_PROFILE_KEY);
    setName(""); setPhone(""); setAddress(""); setLocation(null);
    setProfileSaved(false);
    showToast("🗑️ Details cleared");
  };

  if (success) return (
    <div className="main success-wrap">
      <div className="s-ico">🎊</div>
      <h2>Order Placed!</h2>
      <p>NGS Store will confirm and deliver soon</p>
      <div className="oid-tag">#{success}</div><br />
      <button className="go-track" onClick={() => { setSuccess(null); setTab("orders"); }}>Track Order →</button>
    </div>
  );

  const items = Object.entries(cart).map(([id, qty]) => ({ ...products.find(p => p.id === Number(id)), qty }));
  if (!items.length) return <div className="main empty-box"><div className="big">🛒</div><p>Your cart is empty</p></div>;

  return (
    <div className="main">
      {toast && <div className="toast">{toast}</div>}
      <div className="sec-head">Your Cart</div>
      {items.map(item => (
        <div className="citem" key={item.id}>
          <span className="citem-emoji">{item.emoji}</span>
          <div className="citem-info">
            <div className="citem-name">{item.name}</div>
            <div className="citem-sub">
              {(() => {
                const ep = (!item.slabs||!item.slabs.length) ? item.price : ([...item.slabs].reverse().find(s=>item.qty>=s.qty)||{price:item.price}).price;
                const isBulk = ep < item.price;
                const hasMrpDeal = item.mrp && item.mrp > item.price;
                return (
                  <span>
                    {formatINR(ep)} × {item.qty}
                    {isBulk && <span style={{color:"var(--spice)",fontWeight:700,fontSize:11,marginLeft:4}}>Bulk deal!</span>}
                    {!isBulk && hasMrpDeal && <span style={{color:"var(--spice)",fontWeight:700,fontSize:11,marginLeft:4}}>{Math.round((item.mrp-item.price)/item.mrp*100)}% off MRP</span>}
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="citem-total">{formatINR(item.price * item.qty)}</div>
        </div>
      ))}
      <div className="cart-summary-box">
        <div className="cs-row"><span>Subtotal</span><span>{formatINR(cartTotal)}</span></div>
        {activeCharges.map((c,i) => (
          <div className="charge-row-bill" key={i}><span>{c.name}</span><span>+{formatINR(c.price)}</span></div>
        ))}
        {activeCharges.length === 0 && <div className="cs-row"><span>Delivery</span><span style={{color:"var(--leaf)"}}>FREE</span></div>}
        <div className="cs-row total"><span>Total</span><span>{formatINR(grandTotal)}</span></div>
      </div>
      <div className="chk-form">
        <h3>Delivery Details</h3>
        {profileSaved && (
          <div style={{background:"var(--leaf-pale)",border:"1.5px solid var(--leaf-light)",borderRadius:12,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:13,color:"var(--leaf)",fontWeight:600}}>✅ Using your saved details</span>
            <button onClick={handleClearProfile} style={{background:"none",border:"none",color:"var(--bark-light)",fontSize:12,cursor:"pointer",fontWeight:600,fontFamily:"'DM Sans',sans-serif"}}>Change</button>
          </div>
        )}
        <div className="fgrp"><label>Full Name</label><input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} /></div>
        <div className="fgrp"><label>Phone</label><input type="tel" placeholder="+91 98765 43210" value={phone} onChange={e=>setPhone(e.target.value)} /></div>
        <div className="fgrp">
          <label>Delivery Address</label>
          <textarea placeholder="House no., street, landmark..." value={address} onChange={e=>setAddress(e.target.value)} />
          <button className="loc-btn" onClick={getLocation} disabled={locLoading}>
            {locLoading ? "⏳ Getting location..." : "📍 Use My Current Location"}
          </button>
          {location && <div className="loc-preview"><span>📌</span><span>GPS: {location.lat?.toFixed(5)}, {location.lng?.toFixed(5)}</span></div>}
        </div>
        <div className="fgrp">
          <label>Payment Method</label>
          <div className="pay-method-row">
            <button
              type="button"
              className={"pay-method-btn" + (paymentMethod === "cod" ? " active" : "")}
              onClick={() => setPaymentMethod("cod")}
            >
              💵 Cash on Delivery
            </button>
            <button
              type="button"
              className={"pay-method-btn" + (paymentMethod === "upi" ? " active" : "")}
              onClick={() => setPaymentMethod("upi")}
            >
              📲 Pay by UPI
            </button>
          </div>
        </div>
        {storeOpen
          ? <button className="place-btn" onClick={handlePlaceOrder}>
              {paymentMethod === "upi" ? "Continue to Pay — " : "Place Order — "}{formatINR(grandTotal)}
            </button>
          : <div className="store-closed-checkout">
              <div className="closed-ico">🔒</div>
              <h3>Store is Closed</h3>
              <p>We are not accepting orders right now. Please check back soon!</p>
            </div>
        }
      </div>

      {showPaymentScreen && pendingOrder && (
        <div className="upi-overlay">
          <div className="upi-modal">
            <div className="upi-modal-header">
              <h3>Scan & Pay</h3>
              <button className="upi-close" onClick={() => { setShowPaymentScreen(false); setPendingOrder(null); }}>✕</button>
            </div>
            <div className="upi-amount-lock">
              <div className="upi-amount-lock-label">Amount to pay</div>
              <div className="upi-amount-lock-value">{formatINR(grandTotal)}</div>
              <div className="upi-amount-lock-note">🔒 Fixed amount — cannot be changed</div>
            </div>
            <img className="upi-qr-img" src={buildUpiQrUrl(buildUpiLink(grandTotal, pendingOrder.id))} alt="UPI QR Code" />
            <div className="upi-or-divider"><span>OR</span></div>
            <a
              className="upi-tap-btn"
              href={buildUpiLink(grandTotal, pendingOrder.id)}
            >
              📲 Tap to Pay with UPI App
            </a>
            <p className="upi-hint">Scan the QR with any UPI app, or tap the button above on your phone to open Google Pay / PhonePe / Paytm directly.</p>
            <button
              className="upi-confirm-btn"
              onClick={handleConfirmUpiPayment}
              disabled={paymentConfirmed}
            >
              {paymentConfirmed ? "✅ Payment Confirmed" : "✅ I've Completed the Payment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OrdersView({ orders, myPhone }) {
  const mine = orders
    .filter(o => myPhone && o.customer?.phone === myPhone)
    .sort((a,b) => b.timestamp - a.timestamp);
  if (!myPhone) return (
    <div className="main empty-box">
      <div className="big">📋</div>
      <p>Your order history will appear here</p>
      <p style={{fontSize:13,color:"var(--bark-light)",marginTop:6}}>Place your first order to get started</p>
    </div>
  );
  if (!mine.length) return (
    <div className="main empty-box">
      <div className="big">📋</div>
      <p>No orders yet</p>
    </div>
  );
  return (
    <div className="main">
      <div className="sec-head">My Orders ({mine.length})</div>
      {mine.map(o => {
        const si = S_ORDER.indexOf(o.status);
        return (
          <div className="ocard" key={o.id}>
            <div className="ocard-top">
              <div><div className="o-id">#{o.id}</div><div className="o-date">{new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</div></div>
              <span className={"sbadge s-"+o.status}>{S_LABEL[o.status]}</span>
            </div>
            <div className="progress-track">
              {S_ORDER.map((s,i) => (
                <div key={s} style={{display:"contents"}}>
                  <div className="prog-step">
                    <div className={"prog-dot"+(i<si?" done":i===si?" current":"")}></div>
                    <div className="prog-label">{S_LABEL[s]}</div>
                  </div>
                  {i<S_ORDER.length-1 && <div className={"prog-line"+(i<si?" done":"")}></div>}
                </div>
              ))}
            </div>
            <div className="o-items">{(o.items||[]).map(i=>`${i.emoji} ${i.name} ×${i.qty}`).join("  ·  ")}</div>
            <div className="o-total">{formatINR(o.total)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP (customer only)
// ─────────────────────────────────────────────────────────────────────────────
function AppInner() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState(DEFAULT_PRODUCTS);
  const [storeOpen, setStoreOpen] = useState(true);
  const [charges, setCharges] = useState([]);
  const [toast, setToast] = useState(null);

  // Customer state
  const [tab, setTab] = useState("shop");
  const [cart, setCart] = useState({});
  const [cat, setCat] = useState("All");
  const [success, setSuccess] = useState(null);
  const [myPhone, setMyPhone] = useState(() => {
    try { const p = JSON.parse(localStorage.getItem(CUSTOMER_PROFILE_KEY) || "null"); return p?.phone || ""; } catch { return ""; }
  });

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(()=>setToast(null), 3000); }, []);

  // Load data from Supabase + poll every 4s so products, prices and store status
  // set by the admin app stay in sync on every customer's phone.
  useEffect(() => {
    const load = async () => {
      try {
        const [pr, or, so, ch] = await Promise.all([
          db.getProducts().catch(()=>null),
          db.getOrders().catch(()=>null),
          db.getStoreOpen().catch(()=>null),
          db.getCharges().catch(()=>null),
        ]);
        if (pr && pr.length) setProducts(pr);
        if (or) setOrders(or);
        if (so !== null && so !== undefined) setStoreOpen(so);
        if (ch) setCharges(ch);
      } catch {}
    };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  const handleOrderPlaced = async (order, phone) => {
    setOrders([order, ...orders]);
    setSuccess(order.id);
    setMyPhone(phone);
    // Save order to shared database — the admin app will see it within seconds.
    try { await db.saveOrder(order); } catch (e) { showToast("⚠️ Order may not have saved — check internet"); }

    // Save/update customer record in database
    try {
      const prevCustomers = await db.getCustomers().catch(()=>[]);
      const existing = prevCustomers.find(c => c.phone === order.customer.phone);
      const record = {
        phone: order.customer.phone,
        name: order.customer.name,
        address: order.customer.address,
        location: order.customer.location || null,
        firstOrder: existing ? existing.firstOrder : order.timestamp,
        lastOrder: order.timestamp,
        totalOrders: existing ? existing.totalOrders + 1 : 1,
        totalSpent: existing ? existing.totalSpent + order.total : order.total,
      };
      await db.saveCustomer(record);
    } catch {}
  };

  const cartCount = Object.values(cart).reduce((a,b)=>a+b,0);

  return (
    <>
      <style>{css}</style>
      {toast && <div className="toast">{toast}</div>}
      <div className="hdr">
        <div className="hdr-logo">
          NGS<sup>store</sup>
        </div>
        {cartCount > 0 && (
          <button className="hdr-cart" onClick={()=>setTab("cart")}>
            🛒 Cart <span className="cart-bubble">{cartCount}</span>
          </button>
        )}
      </div>
      {tab==="shop" && <ShopView products={products} cart={cart} cat={cat} setCat={setCat} setCart={setCart} storeOpen={storeOpen} />}
      {tab==="cart" && <CartView products={products} cart={cart} setCart={setCart} onOrderPlaced={handleOrderPlaced} setTab={setTab} success={success} setSuccess={setSuccess} storeOpen={storeOpen} charges={charges} />}
      {tab==="orders" && <OrdersView orders={orders} myPhone={myPhone} />}
      <div className="bnav">
        {[["shop","🏪","Shop"],["cart","🛒","Cart"],["orders","📋","Orders"]].map(([v,ico,lbl])=>(
          <button key={v} className={"bnav-btn"+(tab===v?" active":"")} onClick={()=>setTab(v)}>
            <span className="ico">{ico}</span>
            {lbl}{v==="cart"&&cartCount>0?` (${cartCount})`:""}
          </button>
        ))}
      </div>
    </>
  );
}

// ── ERROR BOUNDARY: keeps the screen from going blank if anything errors ──────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, msg: "" }; }
  static getDerivedStateFromError(error) { return { hasError: true, msg: String(error && error.message || error) }; }
  componentDidCatch(error, info) { console.error("App error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "sans-serif", background: "#f5f0e8", color: "#3d2b1f", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
          <h2 style={{ marginBottom: 8 }}>NGS Store</h2>
          <p style={{ fontSize: 14, color: "#6b4c3b", marginBottom: 16 }}>Something went wrong loading the page. Please refresh.</p>
          <div style={{ fontSize: 11, color: "#a07858", marginBottom: 16, maxWidth: 320, wordBreak: "break-word", fontFamily: "monospace", background: "#ede7d9", padding: 10, borderRadius: 8 }}>{this.state.msg}</div>
          <button onClick={() => window.location.reload()} style={{ padding: "10px 22px", background: "#3d2b1f", color: "#f5f0e8", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 600 }}>Refresh</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
