import { useAuth } from "../context/AuthContext.jsx";
import { useWallet } from "../lib/hooks.js";

// A premium NGS Wallet card for the home screen — shows the live balance and a
// quick "Add money" action; tapping the card opens the wallet. Only rendered
// for signed-in customers (the wallet needs an account).
export default function HomeWallet({ onOpen }) {
  const { user, isLoggedIn } = useAuth();
  const { balance } = useWallet(user?.id);
  if (!isLoggedIn) return null;

  return (
    <button className="home-wallet" onClick={onOpen}>
      <span className="hw-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-3M3 7h16a1 1 0 0 1 1 1v3h-4a2 2 0 0 0 0 4h4" />
        </svg>
      </span>
      <span className="hw-mid">
        <span className="hw-lbl">NGS Wallet</span>
        <span className="hw-bal">₹{(balance || 0).toFixed(2)}</span>
      </span>
      <span className="hw-add">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        Add money
      </span>
    </button>
  );
}
