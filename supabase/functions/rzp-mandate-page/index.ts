// Supabase Edge Function: rzp-mandate-page  (UPI Autopay mandate approval)
// A tiny HTML page that runs Razorpay Checkout for a UPI Autopay MANDATE, opened
// in the customer's SYSTEM browser (not the app's WebView). Razorpay's web
// Checkout can't complete UPI inside an Android WebView — it can't launch the
// UPI app — which is why the in-app popup showed "No appropriate payment method
// found". A real browser can, so we open this page there instead.
//
// It charges nobody: it only collects the one-time mandate approval. The webhook
// (razorpay-webhook → confirm_upi_mandate) stores the token and activates the
// plan server-side; the app polls the order and closes on success.
//
// Params (all non-secret Razorpay ids / the public key): key, order_id,
// customer_id. Served without JWT since it opens in a plain browser tab.
const esc = (s: string) =>
  s.replace(/[^A-Za-z0-9_@.\-]/g, ""); // ids/keys are alphanumeric-ish; strip anything else

Deno.serve((req) => {
  const u = new URL(req.url);
  const key = esc(u.searchParams.get("key") ?? "");
  const orderId = esc(u.searchParams.get("order_id") ?? "");
  const customerId = esc(u.searchParams.get("customer_id") ?? "");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>NGS Nisha General Store — UPI Autopay</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
    background:#f4f7f5; color:#0f2417; display:flex; align-items:center; justify-content:center;
    min-height:100vh; padding:24px; }
  .card { background:#fff; border-radius:20px; padding:28px 22px; max-width:420px; width:100%;
    box-shadow:0 12px 40px rgba(10,50,30,.12); text-align:center; }
  .brand { font-weight:800; font-size:18px; color:#0a9155; margin-bottom:4px; }
  .ic { width:64px; height:64px; margin:8px auto 14px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { font-size:14.5px; line-height:1.55; color:#41564a; margin:0 0 18px; }
  .btn { display:inline-block; background:#0a9155; color:#fff; border:0; border-radius:12px;
    font-size:16px; font-weight:700; padding:14px 22px; width:100%; font-family:inherit; }
  .btn.sec { background:#eef3f0; color:#0a9155; margin-top:10px; }
  .spin { width:40px; height:40px; border:4px solid #d9e7df; border-top-color:#0a9155;
    border-radius:50%; animation:sp 1s linear infinite; margin:20px auto; }
  @keyframes sp { to { transform:rotate(360deg); } }
  .hide { display:none; }
</style></head>
<body>
  <div class="card">
    <div class="brand">NGS Nisha General Store</div>

    <div id="loading">
      <div class="spin"></div>
      <p>Opening secure UPI Autopay approval…</p>
    </div>

    <div id="ok" class="hide">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#0a9155" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-6"/></svg>
      <h1>Autopay set up!</h1>
      <p>Your UPI Autopay is active. You can close this tab and go back to the NGS app — your first delivery is scheduled.</p>
    </div>

    <div id="fail" class="hide">
      <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="#c62828" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16h.01"/></svg>
      <h1>Not completed</h1>
      <p id="failmsg">The UPI Autopay setup wasn't completed.</p>
      <button class="btn" onclick="startPay()">Try again</button>
      <button class="btn sec" onclick="window.close()">Close</button>
    </div>
  </div>

<script>
  var show = function(id){ ["loading","ok","fail"].forEach(function(x){ document.getElementById(x).className = (x===id?"":"hide"); }); };
  function startPay(){
    show("loading");
    var rzp = new Razorpay({
      key: ${JSON.stringify(key)},
      order_id: ${JSON.stringify(orderId)},
      customer_id: ${JSON.stringify(customerId)},
      recurring: "1",
      name: "NGS Nisha General Store",
      description: "Daily subscription — UPI Autopay",
      theme: { color: "#0a9155" },
      handler: function(){ show("ok"); },
      modal: { ondismiss: function(){ document.getElementById("failmsg").textContent =
        "You closed the approval. Your plan isn't active yet — tap Try again to set up autopay."; show("fail"); } }
    });
    rzp.on("payment.failed", function(r){
      document.getElementById("failmsg").textContent = (r && r.error && r.error.description) || "The bank couldn't set up autopay. Please try again.";
      show("fail");
    });
    rzp.open();
  }
  if (!${JSON.stringify(!!(key && orderId))}) {
    document.getElementById("failmsg").textContent = "This link is missing details. Please start again from the NGS app.";
    show("fail");
  } else if (window.Razorpay) { startPay(); }
  else { window.addEventListener("load", startPay); }
</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});
