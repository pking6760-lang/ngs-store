import { useEffect, useRef, useState } from "react";
import * as api from "../lib/api.js";
import * as kyc from "../lib/kyc.js";
import PartnerTerms, { TERMS_VERSION } from "./PartnerTerms.jsx";
import LivenessCapture from "./LivenessCapture.jsx";
import { Ic } from "./AdminIcons.jsx";

// A document number field with live ✓/✗ feedback once enough is typed.
function NumField({ label, value, onChange, valid, hint, placeholder }) {
  const touched = value && value.length > 3;
  return (
    <label className="preg-field">
      <span>{label}</span>
      <input value={value} onChange={onChange} placeholder={placeholder}
        autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        className={touched ? (valid ? "num-ok" : "num-bad") : ""} />
      {touched && (
        <em className={valid ? "num-hint ok" : "num-hint bad"}>
          {valid ? `✓ ${hint}` : "✗ Doesn't look right — please re-check"}
        </em>
      )}
    </label>
  );
}

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
          <Ic name="camera" size={16} /> Add photo
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
    bankAccount: "", bankAccount2: "", bankIfsc: "", bankHolder: "",
  });
  const [usesEv, setUsesEv] = useState(false);
  const [docs, setDocs] = useState({}); // { aadhaar_front, aadhaar_back, pan, dl } → File
  const [nums, setNums] = useState({ aadhaar: "", pan: "", dl: "" });
  const [agreeAuth, setAgreeAuth] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [selfie, setSelfie] = useState(null); // { photoBlob, videoBlob, photoUrl }
  const [showLive, setShowLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // IFSC lookup: null = idle, "loading", "invalid", or {bank, branch, city, state}
  const [bankInfo, setBankInfo] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const pick = (kind) => (file) => setDocs((d) => ({ ...d, [kind]: file }));
  const isDelivery = role === "delivery";
  const needDL = isDelivery && !usesEv;

  // Digits only, 9–18 long (the range Indian bank account numbers fall in).
  const setAccount = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value.replace(/\D/g, "").slice(0, 18) }));
  const setIfsc = (e) =>
    setForm((f) => ({ ...f, bankIfsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11) }));

  const setAadhaarNo = (e) => setNums((n) => ({ ...n, aadhaar: kyc.formatAadhaar(e.target.value) }));
  const setPanNo = (e) => setNums((n) => ({ ...n, pan: kyc.cleanPan(e.target.value) }));
  const setDlNo = (e) => setNums((n) => ({ ...n, dl: kyc.cleanDl(e.target.value) }));
  const aadhaarOk = kyc.aadhaarValid(nums.aadhaar);
  const panOk = kyc.panValid(nums.pan);
  const dlOk = kyc.dlValid(nums.dl);

  // Whenever a full 11-char IFSC is present, resolve its bank + branch live.
  useEffect(() => {
    const code = form.bankIfsc;
    if (!api.IFSC_RE.test(code)) { setBankInfo(code ? "invalid" : null); return; }
    let alive = true;
    setBankInfo("loading");
    api.lookupIfsc(code).then((info) => {
      if (alive) setBankInfo(info || "invalid");
    });
    return () => { alive = false; };
  }, [form.bankIfsc]);

  function goDetails(r) { setRole(r); setError(""); setStep(2); }

  function toDocs() {
    setError("");
    if (!form.fullName.trim()) return setError("Please enter your full name.");
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) return setError("Enter a valid 10-digit phone number.");
    if (!form.address.trim()) return setError("Please enter your home address.");
    if (form.bankAccount.length < 9) return setError("Enter a valid bank account number (9–18 digits).");
    if (form.bankAccount !== form.bankAccount2) return setError("The two account numbers don't match. Please re-check.");
    if (!api.IFSC_RE.test(form.bankIfsc)) return setError("Enter a valid IFSC code, e.g. SBIN0001234.");
    if (bankInfo === "loading") return setError("Checking the IFSC code — one moment.");
    if (!bankInfo || bankInfo === "invalid") return setError("We couldn't find that IFSC code. Please re-check it.");
    if (!form.bankHolder.trim()) return setError("Enter the account holder's name (as printed in the passbook).");
    setStep(3);
  }

  async function submit() {
    setError("");
    if (!docs.aadhaar_front || !docs.aadhaar_back) return setError("Add both sides of your Aadhaar card.");
    if (!aadhaarOk) return setError("Enter a valid 12-digit Aadhaar number.");
    if (!docs.pan) return setError("Add your PAN card photo.");
    if (!panOk) return setError("Enter a valid PAN number, e.g. ABCDE1234F.");
    if (needDL && !docs.dl) return setError("Add your driving licence, or tick the EV option below.");
    if (needDL && !dlOk) return setError("Enter a valid driving licence number.");
    if (!selfie) return setError("Please complete the live selfie verification.");
    if (!agreeAuth || !agreeTerms) return setError("Please tick both boxes to declare your details are genuine and accept the Terms & Conditions.");
    setBusy(true);
    try {
      const paths = {};
      for (const kind of Object.keys(docs)) {
        if (docs[kind]) paths[kind] = await api.uploadPartnerDoc(docs[kind], kind);
      }
      const selfiePath = await api.uploadPartnerMedia(selfie.photoBlob, "selfie");
      let livenessPath = null;
      try {
        if (selfie.videoBlob) livenessPath = await api.uploadPartnerMedia(selfie.videoBlob, "liveness");
      } catch { /* video is best-effort; the selfie + liveness gate already passed */ }
      await api.registerPartner({
        selfie: selfiePath, livenessVideo: livenessPath,
        role, fullName: form.fullName.trim(), phone: form.phone.replace(/\D/g, ""),
        email, address: form.address.trim(),
        bankAccount: form.bankAccount.trim(), bankIfsc: form.bankIfsc.trim().toUpperCase(),
        bankHolder: form.bankHolder.trim() || form.fullName.trim(),
        bankName: (bankInfo && bankInfo !== "invalid" && bankInfo !== "loading") ? bankInfo.bank : null,
        bankBranch: (bankInfo && bankInfo !== "invalid" && bankInfo !== "loading")
          ? [bankInfo.branch, bankInfo.city].filter(Boolean).join(", ") : null,
        aadhaarNumber: kyc.cleanAadhaar(nums.aadhaar), panNumber: kyc.cleanPan(nums.pan),
        dlNumber: needDL ? kyc.cleanDl(nums.dl) : null,
        termsAccepted: true, termsVersion: TERMS_VERSION,
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
              <span className="role-emoji"><Ic name="basket" size={26} /></span>
              <span><strong>Picker</strong><small>Pack orders at the shop</small></span>
            </button>
            <button className="role-card" onClick={() => goDetails("delivery")}>
              <span className="role-emoji"><Ic name="scooter" size={26} /></span>
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
              <input inputMode="numeric" type="tel" value={form.bankAccount} onChange={setAccount("bankAccount")}
                placeholder="9–18 digits" /></label>
            <label className="preg-field"><span>Confirm account number</span>
              <input inputMode="numeric" type="tel" value={form.bankAccount2} onChange={setAccount("bankAccount2")}
                placeholder="Re-enter to avoid mistakes"
                onPaste={(e) => e.preventDefault()} />
              {form.bankAccount2 && form.bankAccount !== form.bankAccount2 && (
                <em className="preg-inline-warn">Doesn't match yet</em>
              )}</label>
            <label className="preg-field"><span>IFSC code</span>
              <input value={form.bankIfsc} onChange={setIfsc} autoCapitalize="characters"
                autoCorrect="off" spellCheck={false} placeholder="e.g. SBIN0001234" /></label>
            {bankInfo === "loading" && <div className="ifsc-hint">Checking IFSC…</div>}
            {bankInfo === "invalid" && form.bankIfsc.length === 11 && (
              <div className="ifsc-hint bad"><Ic name="alert" size={14} /> We couldn't find that IFSC code — please re-check.</div>
            )}
            {bankInfo && bankInfo !== "loading" && bankInfo !== "invalid" && (
              <div className="ifsc-hint ok">
                <Ic name="bank" size={15} /> <strong>{bankInfo.bank}</strong>
                <span>{[bankInfo.branch, bankInfo.city, bankInfo.state].filter(Boolean).join(", ")}</span>
              </div>
            )}
            <label className="preg-field"><span>Account holder name</span>
              <input value={form.bankHolder} onChange={set("bankHolder")} placeholder="Name exactly as in the passbook" /></label>
            {error && <div className="preg-error">{error}</div>}
            <button className="preg-next" onClick={toDocs}>Continue</button>
          </>
        )}

        {step === 3 && (
          <>
            <h2>Documents &amp; ID numbers</h2>
            <p className="preg-sub">Clear photos, and type each number exactly as printed.</p>
            <DocPhoto label="Aadhaar — front" file={docs.aadhaar_front} onPick={pick("aadhaar_front")} />
            <DocPhoto label="Aadhaar — back" file={docs.aadhaar_back} onPick={pick("aadhaar_back")} />
            <NumField label="Aadhaar number" value={nums.aadhaar} onChange={setAadhaarNo}
              valid={aadhaarOk} hint="12 digits · verified" placeholder="1234 5678 9012" />
            <DocPhoto label="PAN card" file={docs.pan} onPick={pick("pan")} />
            <NumField label="PAN number" value={nums.pan} onChange={setPanNo}
              valid={panOk} hint="Valid PAN" placeholder="ABCDE1234F" />
            {isDelivery && (
              <>
                <label className="preg-ev">
                  <input type="checkbox" checked={usesEv} onChange={(e) => setUsesEv(e.target.checked)} />
                  <span>I ride a low-speed / rental EV (no driving licence needed)</span>
                </label>
                {needDL && (
                  <>
                    <DocPhoto label="Driving licence" file={docs.dl} onPick={pick("dl")} />
                    <NumField label="Licence number" value={nums.dl} onChange={setDlNo}
                      valid={dlOk} hint="Valid licence" placeholder="DL0420110012345" />
                  </>
                )}
              </>
            )}

            <div className="preg-selfie">
              <div className="preg-selfie-head">
                <strong>Live selfie verification</strong>
                <span>A quick face check with live motion — confirms it's really you.</span>
              </div>
              {selfie ? (
                <div className="preg-selfie-done">
                  <img src={selfie.photoUrl} alt="Your selfie" />
                  <div className="preg-selfie-ok">✓ Face verified</div>
                  <button type="button" className="preg-selfie-redo" onClick={() => setShowLive(true)}>Retake</button>
                </div>
              ) : (
                <button type="button" className="preg-selfie-btn" onClick={() => setShowLive(true)}>
                  <Ic name="camera" size={16} /> Start live selfie
                </button>
              )}
            </div>

            <div className="preg-consent">
              <label className="preg-check">
                <input type="checkbox" checked={agreeAuth} onChange={(e) => setAgreeAuth(e.target.checked)} />
                <span>I declare that all details and documents I have given are <strong>genuine and belong to me</strong>, and are not fake or tampered.</span>
              </label>
              <label className="preg-check">
                <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} />
                <span>I have read and accept the{" "}
                  <button type="button" className="terms-link" onClick={() => setShowTerms(true)}>Terms &amp; Conditions</button>.
                </span>
              </label>
            </div>

            {error && <div className="preg-error">{error}</div>}
            <button className="preg-next" onClick={submit} disabled={busy || !agreeAuth || !agreeTerms || !selfie}>
              {busy ? "Uploading…" : "Submit for approval"}
            </button>
            {!busy && (!agreeAuth || !agreeTerms || !selfie) && (
              <p className="preg-note">
                {!selfie ? "Complete the live selfie, then " : ""}tick both boxes above to enable submission.
              </p>
            )}
            <p className="preg-note">The store will review your details and approve you before you start.</p>
          </>
        )}
      </div>

      {showTerms && <PartnerTerms onClose={() => setShowTerms(false)} />}
      {showLive && (
        <div className="live-kyc-overlay">
          <LivenessCapture
            onCancel={() => setShowLive(false)}
            onComplete={({ photoBlob, videoBlob }) => {
              if (selfie?.photoUrl) URL.revokeObjectURL(selfie.photoUrl);
              setSelfie({ photoBlob, videoBlob, photoUrl: URL.createObjectURL(photoBlob) });
              setShowLive(false);
              setError("");
            }}
          />
        </div>
      )}
    </div>
  );
}
