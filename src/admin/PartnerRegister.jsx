import { useRef, useState } from "react";
import * as api from "../lib/api.js";

// A photo field — tap to pick from camera or gallery, shows a preview.
function DocPhoto({ label, hint, file, onPick }) {
  const ref = useRef();
  return (
    <div className="doc-photo">
      <div className="doc-photo-label">
        <strong>{label}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <input
        ref={ref} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }}
      />
      {file ? (
        <button type="button" className="doc-thumb" onClick={() => ref.current.click()}>
          <img src={URL.createObjectURL(file)} alt={label} />
          <span>Change</span>
        </button>
      ) : (
        <button type="button" className="doc-add" onClick={() => ref.current.click()}>
          📷 Add photo
        </button>
      )}
    </div>
  );
}

// Multi-step KYC registration for the NGS Partner app.
//  1) role → 2) your details + bank → 3) documents → submit (pending review)
export default function PartnerRegister({ email, onDone }) {
  const [step, setStep] = useState(1);
  const [role, setRole] = useState("");
  const [form, setForm] = useState({
    fullName: "", phone: "", address: "",
    bankAccount: "", bankIfsc: "", bankHolder: "",
  });
  const [usesEv, setUsesEv] = useState(false);
  const [docs, setDocs] = useState({}); // { aadhaar_front, aadhaar_back, pan, dl } → File
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pick = (kind) => (file) => setDocs((d) => ({ ...d, [kind]: file }));
  const isDelivery = role === "delivery";
  const needDL = isDelivery && !usesEv;

  function goDetails(r) { setRole(r); setError(""); setStep(2); }

  function toDocs() {
    setError("");
    if (!form.fullName.trim()) return setError("Please enter your full name.");
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) return setError("Enter a valid 10-digit phone number.");
    if (!form.address.trim()) return setError("Please enter your home address.");
    if (!form.bankAccount.trim() || !form.bankIfsc.trim()) return setError("Please enter your bank account number and IFSC.");
    setStep(3);
  }

  async function submit() {
    setError("");
    if (!docs.aadhaar_front || !docs.aadhaar_back) return setError("Add both sides of your Aadhaar card.");
    if (!docs.pan) return setError("Add your PAN card photo.");
    if (needDL && !docs.dl) return setError("Add your driving licence, or tick the EV option below.");
    setBusy(true);
    try {
      const paths = {};
      for (const kind of Object.keys(docs)) {
        if (docs[kind]) paths[kind] = await api.uploadPartnerDoc(docs[kind], kind);
      }
      await api.registerPartner({
        role, fullName: form.fullName.trim(), phone: form.phone.replace(/\D/g, ""),
        email, address: form.address.trim(),
        bankAccount: form.bankAccount.trim(), bankIfsc: form.bankIfsc.trim().toUpperCase(),
        bankHolder: form.bankHolder.trim() || form.fullName.trim(),
        usesEv, aadhaarFront: paths.aadhaar_front, aadhaarBack: paths.aadhaar_back,
        pan: paths.pan, dl: paths.dl || null,
      });
      onDone();
    } catch (e) {
      setError(e.message || "Couldn't submit. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="preg">
      <header className="preg-head">
        {step > 1 && !busy && (
          <button className="back-btn small" onClick={() => setStep(step - 1)} aria-label="Back">←</button>
        )}
        <div className="preg-title">
          <span className="admin-logo">NGS</span>
          <span className="admin-logo-sub">partner</span>
        </div>
        <span className="preg-step">Step {step} / 3</span>
      </header>

      <div className="preg-body">
        {step === 1 && (
          <>
            <h2>What is your work?</h2>
            <p className="preg-sub">Choose the role you're registering for.</p>
            <button className="role-card" onClick={() => goDetails("picker")}>
              <span className="role-emoji">🧺</span>
              <span><strong>Picker</strong><small>Pack orders at the shop</small></span>
            </button>
            <button className="role-card" onClick={() => goDetails("delivery")}>
              <span className="role-emoji">🛵</span>
              <span><strong>Delivery partner</strong><small>Deliver orders to customers</small></span>
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Your details</h2>
            <p className="preg-sub">Registering as <strong>{isDelivery ? "Delivery partner" : "Picker"}</strong></p>
            <label className="preg-field"><span>Full name</span>
              <input value={form.fullName} onChange={set("fullName")} placeholder="As on Aadhaar" /></label>
            <label className="preg-field"><span>Phone number</span>
              <input type="tel" inputMode="numeric" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                placeholder="10-digit mobile" /></label>
            <label className="preg-field"><span>Home address</span>
              <textarea rows={2} value={form.address} onChange={set("address")} placeholder="Where you live" /></label>
            <h3 className="preg-h3">Bank details (for payment)</h3>
            <label className="preg-field"><span>Account number</span>
              <input inputMode="numeric" value={form.bankAccount} onChange={set("bankAccount")} placeholder="Bank account number" /></label>
            <label className="preg-field"><span>IFSC code</span>
              <input value={form.bankIfsc} onChange={set("bankIfsc")} placeholder="e.g. SBIN0001234" /></label>
            <label className="preg-field"><span>Account holder name <em>(optional)</em></span>
              <input value={form.bankHolder} onChange={set("bankHolder")} placeholder="If different from your name" /></label>
            {error && <div className="preg-error">{error}</div>}
            <button className="preg-next" onClick={toDocs}>Continue</button>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Upload documents</h2>
            <p className="preg-sub">Clear photos — from camera or gallery.</p>
            <DocPhoto label="Aadhaar — front" file={docs.aadhaar_front} onPick={pick("aadhaar_front")} />
            <DocPhoto label="Aadhaar — back" file={docs.aadhaar_back} onPick={pick("aadhaar_back")} />
            <DocPhoto label="PAN card" file={docs.pan} onPick={pick("pan")} />
            {isDelivery && (
              <>
                <label className="preg-ev">
                  <input type="checkbox" checked={usesEv} onChange={(e) => setUsesEv(e.target.checked)} />
                  <span>I ride a low-speed / rental EV (no driving licence needed)</span>
                </label>
                {needDL && <DocPhoto label="Driving licence" file={docs.dl} onPick={pick("dl")} />}
              </>
            )}
            {error && <div className="preg-error">{error}</div>}
            <button className="preg-next" onClick={submit} disabled={busy}>
              {busy ? "Uploading…" : "Submit for approval"}
            </button>
            <p className="preg-note">The store will review your details and approve you before you start.</p>
          </>
        )}
      </div>
    </div>
  );
}
