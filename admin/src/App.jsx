import { useState, useEffect, useCallback, useRef, Component } from "react";
import { db, formatINR, S_ORDER, S_LABEL_A, css } from "../../shared/core.js";

// ─────────────────────────────────────────────────────────────────────────────
// NGS STORE — ADMIN APP
// The store owner's manager app: view/advance orders, manage products & prices,
// customers, extra charges, store open/closed, and print receipts. It reads and
// writes the SAME Supabase database as the customer app (see ../../shared/core.js),
// which is how the two apps stay connected.
// ─────────────────────────────────────────────────────────────────────────────

// ── SECURITY LAYER ────────────────────────────────────────────────────────────
// Only the SHA-256 hash of the password is stored — never the plain text.
const PWD_HASH = "3a07108f6aa8e69f76a740e29e0e5523cdb8a6d2b05fc10faad5d8f91be7f47a";

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── FINGERPRINT / FACE UNLOCK (WebAuthn) ──────────────────────────────────────
// Uses the phone's built-in fingerprint/face sensor via the browser. The
// credential ID is stored locally; the actual biometric data never leaves the
// device. (Not available inside the native app WebView — falls back to password.)
const BIOMETRIC_KEY = "_bio";

function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function isBiometricAvailable() {
  try {
    if (!window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

function hasBiometricRegistered() {
  try { return !!localStorage.getItem(BIOMETRIC_KEY); } catch { return false; }
}

async function registerBiometric() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "NGS Store Admin" },
      user: { id: userId, name: "admin", displayName: "Store Admin" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  if (!cred) throw new Error("No credential created");
  localStorage.setItem(BIOMETRIC_KEY, bufToBase64(cred.rawId));
  return true;
}

async function verifyBiometric() {
  const storedId = localStorage.getItem(BIOMETRIC_KEY);
  if (!storedId) throw new Error("No fingerprint registered");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [{ id: base64ToBuf(storedId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  return !!assertion;
}

function clearBiometric() {
  try { localStorage.removeItem(BIOMETRIC_KEY); } catch {}
}

const SESSION_KEY = "_s";
const LOCKOUT_KEY = "_lk";
const MAX_ATTEMPTS = 3;
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes

function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (s && s.v === 1) return s;
  } catch {}
  return null;
}
function setSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ t: Date.now(), v: 1 }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
function getLockout() {
  try { return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || "null"); } catch { return null; }
}
function setLockout(attempts) {
  localStorage.setItem(LOCKOUT_KEY, JSON.stringify({ attempts, time: Date.now() }));
}
function clearLockout() { localStorage.removeItem(LOCKOUT_KEY); }
function isLockedOut() {
  const lk = getLockout();
  if (!lk) return false;
  if (lk.attempts >= MAX_ATTEMPTS) {
    if (Date.now() - lk.time < LOCKOUT_DURATION) return true;
    clearLockout(); return false;
  }
  return false;
}
function lockoutRemainingMins() {
  const lk = getLockout();
  if (!lk) return 0;
  return Math.ceil((LOCKOUT_DURATION - (Date.now() - lk.time)) / 60000);
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────
function BarcodeField({ value, onChange }) {
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const stopScan = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setScanning(false);
  };

  const startScan = async () => {
    if (!("BarcodeDetector" in window)) {
      const manual = prompt("Camera barcode scanning isn't supported on this browser. Enter the barcode number manually:");
      if (manual) onChange(manual.trim());
      return;
    }
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new window.BarcodeDetector({
        formats: ["ean_13","ean_8","upc_a","upc_e","code_128","code_39","codabar","itf"]
      });
      const scan = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0) {
            onChange(codes[0].rawValue);
            stopScan();
            return;
          }
        } catch {}
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (err) {
      setScanning(false);
      const manual = prompt("Could not open camera. Enter the barcode number manually:");
      if (manual) onChange(manual.trim());
    }
  };

  useEffect(() => () => stopScan(), []);

  return (
    <>
      <div className="barcode-field">
        <input value={value} onChange={e=>onChange(e.target.value)} placeholder="Barcode number" />
        <button type="button" className="barcode-scan-btn" onClick={startScan}>📷</button>
      </div>
      {scanning && (
        <div className="scanner-overlay">
          <div className="scanner-frame">
            <video ref={videoRef} className="scanner-video" playsInline muted></video>
            <div className="scanner-reticle"></div>
          </div>
          <div className="scanner-hint">Point your camera at the product barcode</div>
          <button className="scanner-close" onClick={stopScan}>Cancel</button>
          <button className="scanner-manual" onClick={()=>{ stopScan(); const m = prompt("Enter barcode manually:"); if(m) onChange(m.trim()); }}>Enter manually instead</button>
        </div>
      )}
    </>
  );
}

function SlabEditor({ slabs, setSlabs }) {
  const [qtyInput, setQtyInput] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const addSlab = () => {
    if (!qtyInput || !priceInput) return;
    const updated = [...slabs, { qty: Number(qtyInput), price: Number(priceInput) }]
      .sort((a,b) => a.qty - b.qty);
    setSlabs(updated);
    setQtyInput(""); setPriceInput("");
  };
  return (
    <div className="admin-slabs-box">
      <div className="slab-label">Bulk Deal / Slab Pricing</div>
      {slabs.map((s, i) => (
        <div className="admin-slab-row" key={i}>
          <span style={{fontSize:12,color:"var(--bark-mid)",whiteSpace:"nowrap"}}>Buy {s.qty}+</span>
          <span style={{fontSize:12,color:"var(--leaf)",fontWeight:700}}>₹{s.price} each</span>
          <button className="remove-slab-btn" onClick={()=>setSlabs(slabs.filter((_,j)=>j!==i))}>✕</button>
        </div>
      ))}
      <div className="admin-slab-row">
        <input type="number" placeholder="Min qty (e.g. 4)" value={qtyInput} onChange={e=>setQtyInput(e.target.value)} />
        <input type="number" placeholder="Price each (₹)" value={priceInput} onChange={e=>setPriceInput(e.target.value)} />
        <button className="add-slab-btn" onClick={addSlab}>+ Add</button>
      </div>
    </div>
  );
}

function EditProductForm({ product, onSave, onCancel }) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(String(product.price));
  const [emoji, setEmoji] = useState(product.emoji);
  const [unit, setUnit] = useState(product.unit);
  const [category, setCategory] = useState(product.category);
  const [slabs, setSlabs] = useState(product.slabs || []);
  const [mrp, setMrp] = useState(product.mrp ? String(product.mrp) : "");
  const [barcode, setBarcode] = useState(product.barcode || "");
  return (
    <div className="edit-product-box">
      <div className="edit-product-title">✏️ Editing: {product.name}</div>
      <div className="fgrp"><label>Product Name</label><input value={name} onChange={e=>setName(e.target.value)} /></div>
      <div className="fgrp"><label>Selling Price (₹)</label><input type="number" value={price} onChange={e=>setPrice(e.target.value)} /></div>
      <div className="fgrp"><label>MRP ₹ (original price, optional)</label><input type="number" value={mrp} onChange={e=>setMrp(e.target.value)} placeholder="Leave blank if no discount" /></div>
      <div className="fgrp"><label>Emoji</label><input value={emoji} onChange={e=>setEmoji(e.target.value)} /></div>
      <div className="fgrp"><label>Unit</label><input value={unit} onChange={e=>setUnit(e.target.value)} /></div>
      <div className="fgrp"><label>Category</label><input value={category} onChange={e=>setCategory(e.target.value)} /></div>
      <div className="fgrp"><label>Barcode</label><BarcodeField value={barcode} onChange={setBarcode} /></div>
      <SlabEditor slabs={slabs} setSlabs={setSlabs} />
      <div style={{display:"flex",gap:8,marginTop:12}}>
        <button className="save-edit-btn" onClick={()=>onSave({name,price,emoji,unit,category,slabs,mrp:mrp?Number(mrp):null,barcode})}>✅ Save Changes</button>
        <button className="cancel-edit-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ProductsTab({ products, onAdd, onDelete, onEdit }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [emoji, setEmoji] = useState("🛒");
  const [unit, setUnit] = useState("pack");
  const [category, setCategory] = useState("Biscuit");
  const [editingId, setEditingId] = useState(null);

  const [addSlabs, setAddSlabs] = useState([]);
  const [addMrp, setAddMrp] = useState("");
  const [addBarcode, setAddBarcode] = useState("");
  const handleAdd = async () => {
    await onAdd({ name, price, emoji, unit, category, slabs: addSlabs, mrp: addMrp ? Number(addMrp) : null, barcode: addBarcode });
    setName(""); setPrice(""); setEmoji("🛒"); setUnit("pack"); setCategory("Biscuit"); setAddSlabs([]); setAddMrp(""); setAddBarcode("");
  };

  const handleSaveEdit = async (id, updated) => {
    await onEdit(id, updated);
    setEditingId(null);
  };

  return (
    <>
      <div className="addp-box">
        <h3>Add New Product</h3>
        <div className="fgrp"><label>Product Name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Parle-G" /></div>
        <div className="fgrp"><label>Selling Price (₹)</label><input type="number" value={price} onChange={e=>setPrice(e.target.value)} placeholder="e.g. 20" /></div>
        <div className="fgrp"><label>MRP ₹ (original price, optional)</label><input type="number" value={addMrp} onChange={e=>setAddMrp(e.target.value)} placeholder="Leave blank if no discount" /></div>
        <div className="fgrp"><label>Emoji</label><input value={emoji} onChange={e=>setEmoji(e.target.value)} placeholder="🍪" /></div>
        <div className="fgrp"><label>Unit</label><input value={unit} onChange={e=>setUnit(e.target.value)} placeholder="pack / kg / L" /></div>
        <div className="fgrp"><label>Category</label><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="e.g. Biscuit, Dairy..." /></div>
        <div className="fgrp"><label>Barcode</label><BarcodeField value={addBarcode} onChange={setAddBarcode} /></div>
        <SlabEditor slabs={addSlabs} setSlabs={setAddSlabs} />
        <button className="add-prod-btn" onClick={handleAdd} style={{marginTop:10}}>+ Add Product</button>
      </div>
      {products.map(p => (
        <div key={p.id}>
          {editingId === p.id
            ? <EditProductForm
                product={p}
                onSave={(updated) => handleSaveEdit(p.id, updated)}
                onCancel={() => setEditingId(null)}
              />
            : <div className="prod-list-item">
                <div className="pli-left">
                  <span style={{fontSize:30}}>{p.emoji}</span>
                  <div>
                    <div className="pli-name">{p.name}</div>
                    <div className="pli-sub">{p.category} · {formatINR(p.price)}/{p.unit}</div>
                    {p.barcode && <div className="pli-sub" style={{fontSize:11}}>🔖 {p.barcode}</div>}
                  </div>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button className="edit-btn" onClick={()=>setEditingId(p.id)}>✏️ Edit</button>
                  <button className="del-btn" onClick={()=>onDelete(p.id)}>✕</button>
                </div>
              </div>
          }
        </div>
      ))}
    </>
  );
}

function CustomersTab({ customers }) {
  if (!customers.length) return (
    <div className="empty-box"><div className="big">👥</div><p>No customers yet</p></div>
  );
  return (
    <div className="customers-tab-grid">
      {customers.map(c => (
        <div className="customer-card" key={c.phone}>
          <div className="customer-card-top">
            <div>
              <div className="customer-name-big">👤 {c.name}</div>
              <div className="customer-phone">📞 {c.phone}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:11,color:"var(--bark-light)"}}>Last order</div>
              <div style={{fontSize:12,fontWeight:600,color:"var(--bark-mid)"}}>{new Date(c.lastOrder).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div>
            </div>
          </div>
          <div className="customer-stats">
            <span className="customer-stat-pill">🛒 {c.totalOrders} order{c.totalOrders!==1?"s":""}</span>
            <span className="customer-stat-pill green">💰 {formatINR(c.totalSpent)} spent</span>
          </div>
          <div className="customer-address">
            <span>📍</span>
            <span>{c.address}</span>
          </div>
          {c.location && (
            <a className="map-link" style={{marginTop:8,display:"inline-flex"}}
              href={`https://www.google.com/maps?q=${c.location.lat},${c.location.lng}`}
              target="_blank" rel="noopener noreferrer">
              🗺️ Open in Google Maps
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function ChargesTab({ charges, onAddCharge, onToggleCharge, onDeleteCharge }) {
  const [chName, setChName] = useState("");
  const [chPrice, setChPrice] = useState("");
  const handleAdd = () => {
    if (!chName.trim() || !chPrice) return;
    onAddCharge({ name: chName, price: Number(chPrice) });
    setChName(""); setChPrice("");
  };
  return (
    <>
      <div className="add-charge-box">
        <h3>Add Extra Charge</h3>
        <div className="charge-input-row">
          <input placeholder="e.g. Delivery, Rain Charge" value={chName} onChange={e=>setChName(e.target.value)} />
          <input type="number" placeholder="₹" value={chPrice} onChange={e=>setChPrice(e.target.value)} style={{maxWidth:80}} />
          <button className="charge-add-btn" onClick={handleAdd}>+ Add</button>
        </div>
        <p style={{fontSize:12,color:"var(--bark-light)",marginTop:10}}>Turn a charge ON to apply it to all customer orders.</p>
      </div>
      {charges.length === 0
        ? <div className="empty-box"><div className="big">🧾</div><p>No charges added yet</p></div>
        : charges.map(c => (
          <div className={"charge-card"+(c.active?" active-charge":"")} key={c.id}>
            <div className="charge-info">
              <div className="charge-name">{c.name}</div>
              <div className="charge-price">{formatINR(c.price)}</div>
            </div>
            <div className="charge-actions">
              <label className="toggle-switch">
                <input type="checkbox" checked={c.active} onChange={()=>onToggleCharge(c.id)} />
                <span className="toggle-slider"></span>
              </label>
              <button className="charge-del" onClick={()=>onDeleteCharge(c.id)}>✕</button>
            </div>
          </div>
        ))
      }
    </>
  );
}

function HistoryTab({ orders }) {
  const [openDay, setOpenDay] = useState(null);
  // Group orders by calendar date
  const groups = {};
  [...orders].sort((a,b)=>b.timestamp-a.timestamp).forEach(o => {
    const d = new Date(o.timestamp);
    const key = d.toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
    if (!groups[key]) groups[key] = [];
    groups[key].push(o);
  });
  const dayKeys = Object.keys(groups);

  if (dayKeys.length === 0) return (
    <div className="empty-box"><div className="big">📅</div><p>No order history yet</p></div>
  );

  return (
    <div>
      {dayKeys.map(day => {
        const dayOrders = groups[day];
        const dayRevenue = dayOrders.filter(o=>o.status==="delivered").reduce((s,o)=>s+o.total,0);
        const isOpen = openDay === day;
        return (
          <div className="history-day" key={day}>
            <div className="history-day-header" onClick={()=>setOpenDay(isOpen?null:day)}>
              <div>
                <div className="history-date">{day}</div>
                <div className="history-day-stats">{dayOrders.length} order{dayOrders.length!==1?"s":""} · {dayOrders.filter(o=>o.status==="delivered").length} delivered</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="history-day-revenue">{formatINR(dayRevenue)}</div>
                <span className={"history-chevron"+(isOpen?" open":"")}>▼</span>
              </div>
            </div>
            {isOpen && (
              <div className="history-orders">
                {dayOrders.map(o => (
                  <div className="history-order" key={o.id}>
                    <div className="history-order-top">
                      <span className="history-order-id">#{o.id} · {new Date(o.timestamp).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"})}</span>
                      <span className={"sbadge s-"+o.status}>{S_LABEL_A[o.status]}</span>
                    </div>
                    <div style={{fontSize:12,color:"var(--bark-mid)",marginBottom:4}}>👤 {o.customer?.name} · {o.customer?.phone}</div>
                    <div className="history-order-items">{(o.items||[]).map(i=>`${i.name} ×${i.qty}`).join(", ")}</div>
                    <div style={{fontWeight:700,fontSize:14,color:"var(--bark)"}}>{formatINR(o.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminPanel({ orders, products, setOrders, setProducts, showToast, onLogout, storeOpen, setStoreOpen, customers, charges, setCharges, bioAvailable, bioRegistered, onSetupBiometric, onRemoveBiometric, bioBusy }) {
  const [tab, setTab] = useState("orders");
  // Today's stats only (resets at midnight, calendar day)
  const startOfToday = (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })();
  const todayOrders = orders.filter(o => o.timestamp >= startOfToday);
  const pending = orders.filter(o=>o.status==="pending").length; // pending stays all-time so you never miss one
  const todayRevenue = todayOrders.filter(o=>o.status==="delivered").reduce((s,o)=>s+o.total,0);
  const todayDelivered = todayOrders.filter(o=>o.status==="delivered").length;

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  const [notifStatus, setNotifStatus] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const prevOrderCount = useRef(orders.length);

  const requestNotifPermission = async () => {
    try {
      if (typeof Notification === "undefined") { showToast("⚠️ Notifications not supported here"); return; }
      const result = await Notification.requestPermission();
      setNotifStatus(result);
      if (result === "granted") showToast("🔔 Notifications enabled!");
    } catch { showToast("⚠️ Could not enable notifications"); }
  };

  const fireNotification = useCallback((order) => {
    try {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      const title = "🛒 New Order — NGS Store!";
      const body = `${order.customer?.name} ordered ${(order.items||[]).map(i=>`${i.name} ×${i.qty}`).join(", ")} • ${formatINR(order.total)}`;
      // On mobile (Android Chrome), `new Notification()` throws "Illegal constructor".
      // Use the service worker registration to show the notification instead.
      if ("serviceWorker" in navigator && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then(reg => reg.showNotification(title, { body, tag: order.id }))
          .catch(() => {});
      } else {
        // Desktop fallback
        try { new Notification(title, { body, tag: order.id }); } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => {
    const newCount = orders.length;
    if (newCount > prevOrderCount.current) {
      const newOrders = orders.slice(0, newCount - prevOrderCount.current);
      newOrders.forEach(o => fireNotification(o));
    }
    prevOrderCount.current = newCount;
  }, [orders.length]);

  const toggleStore = async () => {
    const next = !storeOpen;
    setStoreOpen(next);
    try { await db.setStoreOpen(next); } catch {}
    showToast(next ? "✅ Store is now OPEN" : "🔒 Store is now CLOSED");
  };

  const saveCharges = async (updated) => {
    setCharges(updated);
    try { await db.saveCharges(updated); } catch {}
  };
  const onAddCharge = (ch) => { saveCharges([...charges, { ...ch, id: Date.now(), active: true }]); showToast("✅ Charge added"); };
  const onToggleCharge = (id) => { saveCharges(charges.map(c => c.id===id ? {...c, active: !c.active} : c)); };
  const onDeleteCharge = (id) => { saveCharges(charges.filter(c => c.id!==id)); showToast("🗑️ Charge removed"); };

  const updateStatus = async (id, status) => {
    const updated = orders.map(o=>o.id===id?{...o,status}:o);
    setOrders(updated);
    try { await db.updateOrderStatus(id, status); } catch {}
    showToast(status==="delivered"?"✅ Marked delivered":"📦 Status updated");
  };

  // ── ESC/POS helpers ─────────────────────────────────────────────────────
  const ESC = 0x1B; const GS = 0x1D;
  const enc = new TextEncoder();

  const escPos = {
    init:       [ESC, 0x40],
    bold_on:    [ESC, 0x45, 0x01],
    bold_off:   [ESC, 0x45, 0x00],
    center:     [ESC, 0x61, 0x01],
    left:       [ESC, 0x61, 0x00],
    large:      [GS,  0x21, 0x11],
    normal:     [GS,  0x21, 0x00],
    feed:       [ESC, 0x64, 0x03],
    cut:        [GS,  0x56, 0x41, 0x10],
  };

  const buildReceipt = (o) => {
    const date = new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
    const LINE = "--------------------------------";
    const pad = (l, r, w=32) => { const gap = w - l.length - r.length; return l + (gap > 0 ? " ".repeat(gap) : " ") + r; };

    const chunks = [];
    const add = (bytes) => chunks.push(new Uint8Array(bytes));
    const txt = (str) => chunks.push(enc.encode(str + String.fromCharCode(10)));

    add(escPos.init);
    add(escPos.center);
    add(escPos.large);
    add(escPos.bold_on);
    txt("NGS STORE");
    add(escPos.normal);
    add(escPos.bold_off);
    txt("Fresh Groceries");
    txt("");
    add(escPos.left);
    txt(LINE);
    txt("Order : #" + o.id);
    txt("Date  : " + date);
    txt(LINE);
    add(escPos.bold_on);
    txt("CUSTOMER DETAILS");
    add(escPos.bold_off);
    txt("Name  : " + (o.customer?.name || ""));
    txt("Phone : " + (o.customer?.phone || ""));
    // wrap address at 32 chars
    const addr = o.customer?.address || "";
    for (let i=0; i<addr.length; i+=32) {
      txt((i===0?"Addr  : ":"        ") + addr.slice(i,i+32));
    }
    txt(LINE);
    add(escPos.bold_on);
    txt("ITEMS");
    add(escPos.bold_off);
    const items = Array.isArray(o.items) ? o.items : [];
    if (items.length === 0) {
      txt("(no items)");
    } else {
      items.forEach(i => {
        const qty = Number(i.qty) || 1;
        const basePrice = Number(i.price) || 0;
        const ep = (!i.slabs || !i.slabs.length)
          ? basePrice
          : Number(([...i.slabs].reverse().find(s => qty >= s.qty) || {price: basePrice}).price);
        const lineTotal = ep * qty;
        const rawName = (i.name || "Item").toString();
        const name = rawName.length > 18 ? rawName.slice(0, 18) : rawName;
        txt(pad(name + " x" + qty, "Rs." + lineTotal));
      });
    }
    txt(LINE);
    if (o.charges && o.charges.length > 0) {
      txt(pad("Subtotal", "Rs." + (o.subtotal != null ? o.subtotal : o.total)));
      o.charges.forEach(c => txt(pad(c.name, "Rs." + c.price)));
      txt(LINE);
    }
    add(escPos.bold_on);
    add(escPos.large);
    txt(pad("TOTAL", "Rs." + o.total));
    add(escPos.normal);
    add(escPos.bold_off);
    txt(LINE);
    add(escPos.left);
    txt("Payment: " + (o.payment?.method === "upi" ? "UPI (" + (o.payment.status === "customer_confirmed_paid" ? "Paid" : "Pending") + ")" : "Cash on Delivery"));
    txt(LINE);
    add(escPos.center);
    txt("");
    txt("Thank you for ordering!");
    txt("NGS Store");
    txt("");
    add(escPos.feed);
    add(escPos.cut);

    // Merge all chunks
    const total = chunks.reduce((s,c)=>s+c.length,0);
    const merged = new Uint8Array(total);
    let offset = 0;
    chunks.forEach(c => { merged.set(c, offset); offset += c.length; });
    return merged;
  };

  const printReceipt = async (o) => {
    if (!navigator.bluetooth) {
      showToast("❌ Web Bluetooth not supported on this browser");
      return;
    }
    try {
      showToast("🔍 Searching for printer...");
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: "PT-210" },
          { namePrefix: "Posiflow" },
          { namePrefix: "pos" },
          { namePrefix: "POS" },
          { namePrefix: "Printer" },
          { namePrefix: "printer" },
          { namePrefix: "BT" },
        ],
        optionalServices: [
          "000018f0-0000-1000-8000-00805f9b34fb", // common POS service
          "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // common ESC/POS BT
          "49535343-fe7d-4ae5-8fa9-9fafd205e455", // another common UUID
        ]
      });
      showToast("🔗 Connecting...");
      const server = await device.gatt.connect();
      // Try known ESC/POS service UUIDs
      const serviceUUIDs = [
        "000018f0-0000-1000-8000-00805f9b34fb",
        "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
        "49535343-fe7d-4ae5-8fa9-9fafd205e455",
      ];
      let characteristic = null;
      for (const uuid of serviceUUIDs) {
        try {
          const service = await server.getPrimaryService(uuid);
          const chars = await service.getCharacteristics();
          characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (characteristic) break;
        } catch {}
      }
      if (!characteristic) {
        // fallback: try first available service
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          const chars = await svc.getCharacteristics();
          characteristic = chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
          if (characteristic) break;
        }
      }
      if (!characteristic) { showToast("❌ Could not find printer characteristic"); return; }

      showToast("🖨️ Printing...");
      const data = buildReceipt(o);
      // PT-210 has a small buffer — send in SMALL chunks with pauses,
      // otherwise the middle of the receipt gets dropped.
      const CHUNK = 20;
      for (let i=0; i<data.length; i+=CHUNK) {
        const chunk = data.slice(i, i+CHUNK);
        try {
          if (characteristic.properties.writeWithoutResponse) {
            await characteristic.writeValueWithoutResponse(chunk);
          } else {
            await characteristic.writeValue(chunk);
          }
        } catch (e) {
          // retry once on failure
          await new Promise(r => setTimeout(r, 60));
          try { await characteristic.writeValue(chunk); } catch {}
        }
        await new Promise(r => setTimeout(r, 30));
      }
      await new Promise(r => setTimeout(r, 300)); // let printer finish
      showToast("✅ Printed successfully!");
      device.gatt.disconnect();
    } catch (err) {
      if (err.name === "NotFoundError") showToast("❌ No printer selected");
      else showToast("❌ " + (err.message || "Print failed"));
    }
  };

  const onAdd = async (np) => {
    if (!np.name||!np.price) { showToast("⚠️ Fill name & price"); return; }
    const p = {...np, id:Date.now(), price:Number(np.price), mrp: np.mrp ?? null, barcode: np.barcode ?? "", slabs: np.slabs ?? [], inStock:true};
    setProducts([...products, p]);
    try { await db.saveProduct(p); } catch (e) { showToast("⚠️ Save failed, check connection"); }
    showToast("✅ Product added!");
  };

  const onDelete = async (id) => {
    setProducts(products.filter(p=>p.id!==id));
    try { await db.deleteProduct(id); } catch {}
    showToast("🗑️ Removed");
  };

  const onEdit = async (id, updated) => {
    const editedProducts = products.map(p =>
      p.id === id ? { ...p, ...updated, price: Number(updated.price), mrp: updated.mrp ?? null } : p
    );
    setProducts(editedProducts);
    const edited = editedProducts.find(p => p.id === id);
    try { await db.saveProduct(edited); } catch {}
    showToast("✅ Product updated!");
  };

  return (
    <>
      <div className="ahdr">
        <div><div className="ahdr-title">NGS Dashboard</div><div className="ahdr-sub">Store Manager</div></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {pending>0 && <span className="notif-dot">🔔 {pending}</span>}
<button className="logout-btn" onClick={onLogout}>Logout</button>
        </div>
      </div>
      <div className="atabs">
        <button className={"atab"+(tab==="orders"?" active":"")} onClick={()=>setTab("orders")}>📦 Orders</button>
        <button className={"atab"+(tab==="products"?" active":"")} onClick={()=>setTab("products")}>🏪 Products</button>
      <button className={"atab"+(tab==="customers"?" active":"")} onClick={()=>setTab("customers")}>👥 Customers</button>
      <button className={"atab"+(tab==="history"?" active":"")} onClick={()=>setTab("history")}>📅 History</button>
      <button className={"atab"+(tab==="charges"?" active":"")} onClick={()=>setTab("charges")}>🧾 Charges</button>
      </div>
      <div className="acontent">
        {tab==="orders" && (
          <>
            {notifStatus !== "granted" && notifStatus !== "unsupported" && (
              <div className="notif-permission-bar">
                <p>🔔 Enable notifications to get alerted when new orders arrive</p>
                <button className="notif-enable-btn" onClick={requestNotifPermission}>Enable</button>
              </div>
            )}
            {notifStatus === "granted" && (
              <div style={{background:"var(--leaf-pale)",borderRadius:10,padding:"8px 14px",marginBottom:14,fontSize:13,color:"var(--leaf)",fontWeight:600}}>
                🔔 Notifications are ON — you'll be alerted for every new order
              </div>
            )}
            <div className={"store-toggle-card " + (storeOpen ? "open" : "closed")}>
              <div>
                <div className={"toggle-label " + (storeOpen ? "open" : "closed")}>
                  {storeOpen ? "🟢 Store is Open" : "🔴 Store is Closed"}
                </div>
                <div className="toggle-sub">{storeOpen ? "Accepting orders from customers" : "Customers cannot place orders"}</div>
              </div>
              <label className="toggle-switch">
                <input type="checkbox" checked={storeOpen} onChange={toggleStore} />
                <span className="toggle-slider"></span>
              </label>
            </div>
            {bioAvailable && (
              <div className="store-toggle-card" style={{marginBottom:18}}>
                <div>
                  <div className="toggle-label" style={{color:"var(--bark)"}}>
                    👆 {bioRegistered ? "Fingerprint Login: ON" : "Fingerprint Login: OFF"}
                  </div>
                  <div className="toggle-sub">{bioRegistered ? "Unlock admin without typing your password" : "Skip typing your password next time"}</div>
                </div>
                {bioRegistered
                  ? <button onClick={onRemoveBiometric} style={{padding:"7px 12px",border:"1.5px solid var(--danger)",borderRadius:10,background:"var(--danger-pale)",color:"var(--danger)",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>Turn Off</button>
                  : <button onClick={onSetupBiometric} disabled={bioBusy} style={{padding:"7px 14px",border:"1.5px solid var(--leaf)",borderRadius:10,background:"var(--leaf-pale)",color:"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap"}}>{bioBusy?"Setting up...":"Set Up"}</button>
                }
              </div>
            )}
            <div style={{fontSize:12,color:"var(--bark-light)",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:10}}>📊 Today's Summary</div>
            <div className="stats-grid">
              <div className="stat-box"><div className="stat-num spice">{pending}</div><div className="stat-lbl">Pending (all)</div></div>
              <div className="stat-box"><div className="stat-num">{todayOrders.length}</div><div className="stat-lbl">Orders Today</div></div>
              <div className="stat-box"><div className="stat-num green">{todayDelivered}</div><div className="stat-lbl">Delivered Today</div></div>
              <div className="stat-box"><div className="stat-num green" style={{fontSize:20}}>{formatINR(todayRevenue)}</div><div className="stat-lbl">Revenue Today</div></div>
            </div>
            {orders.length===0
              ? <div className="empty-box"><div className="big">📭</div><p>No orders yet</p></div>
              : orders.map(o=>(
                <div className={"ocard"+(o.status==="pending"?" new-order":"")} key={o.id}>
                  <div className="ocard-top">
                    <div><div className="o-id">#{o.id}</div><div className="o-date">{new Date(o.timestamp).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</div></div>
                    <span className={"sbadge s-"+o.status}>{S_LABEL_A[o.status]}</span>
                  </div>
                  <div className="cust-block">
                    <div className="cust-name">👤 {o.customer?.name}</div>
                    <div className="cust-row"><span>📞</span>{o.customer?.phone}</div>
                    <div className="cust-row"><span>📍</span><span>{o.customer?.address}</span></div>
                    {o.customer?.location && (
                      <a className="map-link" href={`https://www.google.com/maps?q=${o.customer?.location?.lat},${o.customer?.location?.lng}`} target="_blank" rel="noopener noreferrer">🗺️ Open in Google Maps</a>
                    )}
                  </div>
                  <div className="o-items">{o.items?.map(i=>`${i.emoji} ${i.name} ×${i.qty}`).join("  ·  ")}</div>
                  {o.charges && o.charges.length > 0 && (
                    <div style={{fontSize:12,color:"var(--spice)",marginBottom:4}}>
                      {o.subtotal != null && <div style={{color:"var(--bark-light)"}}>Subtotal: {formatINR(o.subtotal)}</div>}
                      {o.charges.map((c,i)=><div key={i}>+ {c.name}: {formatINR(c.price)}</div>)}
                    </div>
                  )}
                  <div className="o-total">{formatINR(o.total)}</div>
                  {o.payment && (
                    <div style={{marginTop:6,marginBottom:6}}>
                      {o.payment.method === "upi"
                        ? <span className="sbadge" style={{background: o.payment.status === "customer_confirmed_paid" ? "var(--leaf-pale)" : "#fff3e0", color: o.payment.status === "customer_confirmed_paid" ? "var(--leaf)" : "#bf360c"}}>
                            📲 UPI: {o.payment.status === "customer_confirmed_paid" ? "Customer says PAID — verify in your bank/UPI app" : "Awaiting payment"}
                          </span>
                        : <span className="sbadge" style={{background:"var(--leaf-pale)",color:"var(--leaf)"}}>💵 Cash on Delivery</span>
                      }
                    </div>
                  )}
                  <select className="status-sel" value={o.status} onChange={e=>updateStatus(o.id,e.target.value)}>
                    {S_ORDER.map(s=><option key={s} value={s}>{S_LABEL_A[s]}</option>)}
                  </select>
                  <button className="print-btn" onClick={()=>printReceipt(o)}>🖨️ Print Receipt</button>
                </div>
              ))
            }
          </>
        )}
        {tab==="products" && <ProductsTab products={products} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} />}
        {tab==="customers" && <CustomersTab customers={customers} />}
        {tab==="history" && <HistoryTab orders={orders} />}
        {tab==="charges" && <ChargesTab charges={charges} onAddCharge={onAddCharge} onToggleCharge={onToggleCharge} onDeleteCharge={onDeleteCharge} />}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT APP (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function AppInner() {
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [storeOpen, setStoreOpen] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [charges, setCharges] = useState([]);
  const [toast, setToast] = useState(null);

  // Security / auth state
  const [mode, setMode] = useState("login"); // "login" | "admin" | "decoy"
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioRegistered, setBioRegistered] = useState(hasBiometricRegistered());
  const [bioBusy, setBioBusy] = useState(false);
  const lastAttemptTime = useRef(0);

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(()=>setToast(null), 3000); }, []);

  // Load data from Supabase + poll every 4s so orders placed in the customer app
  // appear here within seconds, on every manager's phone.
  useEffect(() => {
    const load = async () => {
      try {
        const [pr, or, so, cu, ch] = await Promise.all([
          db.getProducts().catch(()=>null),
          db.getOrders().catch(()=>null),
          db.getStoreOpen().catch(()=>null),
          db.getCustomers().catch(()=>null),
          db.getCharges().catch(()=>null),
        ]);
        if (pr) setProducts(pr);
        if (or) setOrders(or);
        if (so !== null && so !== undefined) setStoreOpen(so);
        if (cu) setCustomers(cu);
        if (ch) setCharges(ch);
      } catch {}
    };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);

  // Check if this device supports fingerprint/face unlock
  useEffect(() => { isBiometricAvailable().then(setBioAvailable); }, []);

  // Restore admin session on mount
  useEffect(() => {
    const s = getSession();
    if (s) setMode("admin");
  }, []);

  const handleBiometricLogin = async () => {
    setBioBusy(true);
    setPwErr("");
    try {
      await verifyBiometric();
      setSession();
      setMode("admin");
    } catch (err) {
      setPwErr("⚠️ Fingerprint not recognized — use password instead");
    }
    setBioBusy(false);
  };

  const handleSetupBiometric = async () => {
    setBioBusy(true);
    try {
      await registerBiometric();
      setBioRegistered(true);
      showToast("✅ Fingerprint login enabled!");
    } catch (err) {
      showToast("⚠️ Could not set up fingerprint");
    }
    setBioBusy(false);
  };

  const handleLogin = async () => {
    // Rate limit: max 1 attempt per 2 seconds
    if (Date.now() - lastAttemptTime.current < 2000) return;
    lastAttemptTime.current = Date.now();

    if (isLockedOut()) {
      setPwErr(`🔒 Too many attempts. Try again in ${lockoutRemainingMins()} minutes.`);
      return;
    }

    const hash = await hashPassword(pw);
    setPw("");

    if (hash === PWD_HASH) {
      clearLockout();
      setSession();
      setMode("admin");
      setPwErr("");
    } else {
      const lk = getLockout();
      const attempts = (lk?.attempts || 0) + 1;
      setLockout(attempts);
      if (attempts >= MAX_ATTEMPTS) {
        // Show decoy panel to confuse an attacker
        setMode("decoy");
        setPwErr("");
      } else {
        setPwErr(`❌ Wrong password. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS-attempts!==1?"s":""} left.`);
      }
    }
  };

  const handleLogout = () => {
    clearSession();
    setMode("login");
  };

  // ── DECOY PANEL (shown after 3 wrong attempts) ────────────────────────────
  if (mode === "decoy") return (
    <>
      <style>{css}</style>
      <div className="decoy-wrap">
        <h2>Nothing here</h2>
        <p>This page does not exist.</p>
        <button onClick={()=>setMode("login")} style={{marginTop:20,background:"none",border:"none",color:"#bbb",cursor:"pointer",fontSize:12}}>Go back</button>
      </div>
    </>
  );

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  if (mode === "login") return (
    <>
      <style>{css}</style>
      <div className="login-wrap">
        <div className="login-card">
          <div className="login-icon">🔐</div>
          <h1>NGS Admin</h1>
          <p>{bioRegistered ? "Use your fingerprint or password" : "Enter your password to continue"}</p>

          {bioAvailable && bioRegistered && (
            <button
              onClick={handleBiometricLogin}
              disabled={bioBusy}
              style={{width:"100%",padding:"14px",marginBottom:14,border:"2px solid var(--leaf)",borderRadius:14,background:"var(--leaf-pale)",color:"var(--leaf)",fontFamily:"'DM Sans',sans-serif",fontWeight:700,fontSize:15,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
            >
              👆 {bioBusy ? "Verifying..." : "Unlock with Fingerprint"}
            </button>
          )}

          <input
            type="password" placeholder="Password" value={pw}
            onChange={e=>setPw(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            autoComplete="off"
          />
          <button className="login-btn" onClick={handleLogin}>Enter Dashboard</button>
          {pwErr && <div className="login-err">{pwErr}</div>}
          {isLockedOut() && (
            <div className="lockout-msg">🔒 Locked out for {lockoutRemainingMins()} minutes</div>
          )}
        </div>
      </div>
    </>
  );

  // ── ADMIN DASHBOARD ───────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      {toast && <div className="toast">{toast}</div>}
      <div id="thermal-receipt"></div>
      <AdminPanel
        orders={orders} products={products}
        setOrders={setOrders} setProducts={setProducts}
        showToast={showToast} onLogout={handleLogout}
        storeOpen={storeOpen} setStoreOpen={setStoreOpen}
        customers={customers}
        charges={charges} setCharges={setCharges}
        bioAvailable={bioAvailable} bioRegistered={bioRegistered}
        onSetupBiometric={handleSetupBiometric}
        onRemoveBiometric={() => { clearBiometric(); setBioRegistered(false); showToast("Fingerprint login removed"); }}
        bioBusy={bioBusy}
      />
    </>
  );
}

// ── ERROR BOUNDARY ────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, msg: "" }; }
  static getDerivedStateFromError(error) { return { hasError: true, msg: String(error && error.message || error) }; }
  componentDidCatch(error, info) { console.error("App error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "sans-serif", background: "#f5f0e8", color: "#3d2b1f", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
          <h2 style={{ marginBottom: 8 }}>NGS Store Admin</h2>
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
