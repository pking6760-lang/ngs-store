import { IS_IOS, UPI_APPS, upiAppHref, rupeesInWords } from "../lib/upi.js";

// The shared premium UPI pay screen used by checkout AND membership: merchant
// header, big amount + amount-in-words, a professional loader, the QR, direct
// UPI-app buttons, and a card / other-methods fallback.
export default function UpiPayScreen({
  amount,
  qrSrc,
  upiIntent,
  onRazorpay,
  loading = false,
  error = "",
  note = "After you pay, this screen confirms automatically — you don't need to do anything else.",
}) {
  return (
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

      <div className="pay-big">₹{Number(amount).toFixed(2)}</div>
      <div className="pay-words">{rupeesInWords(amount)}</div>

      {loading ? (
        <div className="pay-loading">
          <span className="pay-spinner" aria-hidden="true" />
          <span>Setting up a secure payment…</span>
        </div>
      ) : (
        <>
          {qrSrc && (
            <div className="upi-qr-wrap">
              <img className="upi-qr clean" src={qrSrc} alt="UPI payment QR code" />
              <p className="upi-hint">Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) — pays directly</p>
            </div>
          )}

          {upiIntent ? (
            <>
              <div className="upi-apps-label">Pay by UPI app</div>
              <div className="upi-apps">
                {UPI_APPS.map((app) => (
                  <a className="upi-app" key={app.id} href={upiAppHref(upiIntent, app)}>
                    <span className="upi-app-ic"><img src={app.logo} alt={app.name} /></span>
                    <span className="upi-app-name">{app.name}</span>
                  </a>
                ))}
              </div>
              {onRazorpay && (
                <button className="pay-paid-link" onClick={onRazorpay}>
                  Pay by card / other methods
                </button>
              )}
            </>
          ) : (
            onRazorpay && (
              <button className="pay-proceed" onClick={onRazorpay}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l8 3v6c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V5z" /><path d="M9 12l2 2 4-4" /></svg>
                Pay ₹{Number(amount).toFixed(2)}
              </button>
            )
          )}
        </>
      )}

      {error && <div className="auth-error">{error}</div>}
      {!loading && <p className="upi-note">{note}</p>}
    </div>
  );
}
