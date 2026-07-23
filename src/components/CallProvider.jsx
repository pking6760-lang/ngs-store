import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../lib/supabase.js";
import * as api from "../lib/api.js";
import { createVoiceCall, isCallSupported } from "../lib/webrtcCall.js";
import "./call.css";

const CallCtx = createContext({ callParty: () => {}, supported: false });
export const useCall = () => useContext(CallCtx);

// A soft repeating ring using WebAudio (no asset needed). Also vibrates on phones.
function makeRinger() {
  let ctx = null, timer = null, stopped = true;
  function beep() {
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.4].forEach((off) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = off ? 480 : 440;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, now + off);
      g.gain.exponentialRampToValueAtTime(0.18, now + off + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.32);
      o.start(now + off); o.stop(now + off + 0.34);
    });
  }
  return {
    start() {
      if (!stopped) return; stopped = false;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
      const tick = () => {
        if (stopped) return;
        beep();
        try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch { /* ignore */ }
        timer = setTimeout(tick, 2400);
      };
      tick();
    },
    stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { navigator.vibrate && navigator.vibrate(0); } catch { /* ignore */ }
      if (ctx) { try { ctx.close(); } catch { /* ignore */ } ctx = null; }
    },
  };
}

export function CallProvider({ children }) {
  const supported = isCallSupported();
  const [uid, setUid] = useState(null);
  // phase: idle | outgoing | incoming | connecting | connected | ended
  const [phase, setPhase] = useState("idle");
  const [peerName, setPeerName] = useState("");
  const [peerRole, setPeerRole] = useState(""); // customer | partner | owner
  const [peerRef, setPeerRef] = useState("");   // customer_code / emp_code
  const [peerPhone, setPeerPhone] = useState("");
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [note, setNote] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [copied, setCopied] = useState(false);

  const engine = useRef(null);
  const callRow = useRef(null);
  const audioRef = useRef(null);
  const ringer = useRef(null);
  const watchRef = useRef(null);
  if (!ringer.current) ringer.current = makeRinger();

  // Who am I (works in both customer & partner apps — call-agnostic auth).
  useEffect(() => {
    let alive = true;
    supabase?.auth.getUser().then(({ data }) => { if (alive) setUid(data?.user?.id || null); });
    const { data: sub } = supabase?.auth.onAuthStateChange((_e, s) => setUid(s?.user?.id || null)) || {};
    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  const cleanup = useCallback(() => {
    ringer.current.stop();
    try { engine.current && engine.current.hangup(); } catch { /* ignore */ }
    engine.current = null;
    if (watchRef.current) { try { supabase.removeChannel(watchRef.current); } catch { /* ignore */ } watchRef.current = null; }
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const finish = useCallback((label, ms) => {
    cleanup();
    setNote(label || "");
    setPhase("ended");
    setMinimized(false);
    setTimeout(() => {
      setPhase("idle"); setPeerName(""); setPeerRole(""); setPeerRef(""); setPeerPhone("");
      setSeconds(0); setMuted(false); setNote(""); setCopied(false);
    }, ms || 1400);
  }, [cleanup]);

  // Watch the call row so we react when the OTHER side declines / hangs up.
  const watchRow = useCallback((callId) => {
    if (watchRef.current) { try { supabase.removeChannel(watchRef.current); } catch { /* ignore */ } }
    watchRef.current = supabase.channel(`call-watch-${callId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${callId}` },
        ({ new: row }) => {
          if (["ended", "declined", "missed", "busy"].includes(row.status)) {
            finish(row.status === "declined" ? "Call declined" : "Call ended");
          }
        })
      .subscribe();
  }, [finish]);

  function attachRemote(stream) {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.play?.().catch(() => {});
    }
  }

  // ── Outgoing: call the other party on an order ────────────────────────────
  const callParty = useCallback(async (orderId, name) => {
    if (!supported) { alert("This device can't make in-app calls. Update your app/browser."); return; }
    if (phase !== "idle") return;
    setPeerName(name || "…"); setPhase("outgoing"); setNote("");
    try {
      const row = await api.callOrderParty(orderId);
      callRow.current = row;
      watchRow(row.id);
      engine.current = createVoiceCall({
        callId: row.id, isCaller: true,
        onStatus: (s) => {
          if (s === "connected") { ringer.current.stop(); setPhase("connected"); }
          else if (s === "failed") finish("Couldn't connect");
          else if (s === "ended") finish("Call ended");
        },
        onRemoteStream: attachRemote,
      });
      ringer.current.start();
      await engine.current.start();
    } catch (e) {
      const busy = /NGS_BUSY/.test(e?.message || "");
      if (busy) {
        finish("They're on another call. Please wait a moment and try again.", 3200);
      } else {
        finish(e.message || "Call failed");
      }
    }
  }, [phase, supported, watchRow, finish]);

  // ── Incoming: a ringing call addressed to me ──────────────────────────────
  const showIncoming = useCallback((row) => {
    if (!row || phase !== "idle") return;
    if (row.caller_id === uid) return;
    callRow.current = row;
    setPeerName(row.caller_name || "Incoming call");
    setPeerRole(row.caller_role || "");
    setPeerRef(row.caller_ref || "");
    setPeerPhone(row.caller_phone || "");
    setPhase("incoming");
    watchRow(row.id);
    ringer.current.start();
  }, [phase, uid, watchRow]);

  const acceptIncoming = useCallback(async () => {
    const row = callRow.current; if (!row) return;
    ringer.current.stop(); setPhase("connecting");
    try {
      await api.setCallStatus(row.id, "accepted");
      engine.current = createVoiceCall({
        callId: row.id, isCaller: false,
        onStatus: (s) => {
          if (s === "connected") setPhase("connected");
          else if (s === "failed") finish("Couldn't connect");
          else if (s === "ended") finish("Call ended");
        },
        onRemoteStream: attachRemote,
      });
      await engine.current.start();
    } catch (e) {
      finish(e.message || "Couldn't answer");
    }
  }, [finish]);

  const declineIncoming = useCallback(async () => {
    const row = callRow.current;
    if (row) { try { await api.setCallStatus(row.id, "declined"); } catch { /* ignore */ } }
    finish("");
  }, [finish]);

  const endCall = useCallback(async () => {
    const row = callRow.current;
    if (row) { try { await api.setCallStatus(row.id, "ended"); } catch { /* ignore */ } }
    finish("");
  }, [finish]);

  // Incoming sources: realtime INSERT (app open) + resume poll + push event.
  useEffect(() => {
    if (!uid || !supported) return;
    const ch = supabase.channel(`my-calls-${uid}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${uid}` },
        ({ new: row }) => { if (row.status === "ringing") showIncoming(row); })
      .subscribe();
    const poll = () => api.fetchRingingCall().then((row) => row && showIncoming(row)).catch(() => {});
    poll();
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    const onPush = () => poll();
    const onSwMsg = (e) => { if (e.data && e.data.type === "ngs-incoming-call") poll(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("ngs-incoming-call", onPush);
    navigator.serviceWorker?.addEventListener?.("message", onSwMsg);
    return () => {
      try { supabase.removeChannel(ch); } catch { /* ignore */ }
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("ngs-incoming-call", onPush);
      navigator.serviceWorker?.removeEventListener?.("message", onSwMsg);
    };
  }, [uid, supported, showIncoming]);

  // In-call timer.
  useEffect(() => {
    if (phase !== "connected") return;
    const iv = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  // Give up after 40s of ringing with no answer / no connection.
  useEffect(() => {
    if (phase !== "outgoing" && phase !== "connecting") return;
    const t = setTimeout(() => {
      const row = callRow.current;
      if (row) { api.setCallStatus(row.id, "missed").catch(() => {}); }
      finish("No answer");
    }, 40000);
    return () => clearTimeout(t);
  }, [phase, finish]);

  function toggleMute() {
    const m = !muted; setMuted(m);
    try { engine.current && engine.current.setMuted(m); } catch { /* ignore */ }
  }

  const active = phase !== "idle";
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const initial = (peerName || "?").trim().charAt(0).toUpperCase() || "?";
  const ROLE_LABEL = { customer: "Customer", partner: "Employee", owner: "Store" };
  const roleLabel = ROLE_LABEL[peerRole] || "";
  // Minimizing is offered once a call is going (not while it's still ringing to
  // be answered), so you can look up the caller's ID without dropping the call.
  const canMinimize = phase === "outgoing" || phase === "connecting" || phase === "connected";
  const statusText =
    phase === "outgoing" ? "Calling…"
    : phase === "incoming" ? "Incoming call"
    : phase === "connecting" ? "Connecting…"
    : phase === "connected" ? mmss
    : (note || "Call ended");

  const copyRef = () => {
    if (!peerRef) return;
    try { navigator.clipboard?.writeText(peerRef); } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  };

  return (
    <CallCtx.Provider value={{ callParty, supported }}>
      {children}
      {active && createPortal(
        <>
          {minimized ? (
            /* ── Minimized: a floating bar; the app stays fully usable ─────── */
            <div className="callmini" onClick={() => setMinimized(false)} role="button" aria-label="Return to call">
              <span className="callmini-av">{initial}</span>
              <span className="callmini-txt">
                <div className="callmini-name">{peerName}</div>
                <div className="callmini-sub">{statusText} · tap to open</div>
              </span>
              <button className="callmini-end" onClick={(e) => { e.stopPropagation(); endCall(); }} aria-label="End call">✕</button>
            </div>
          ) : (
            /* ── Full call screen ──────────────────────────────────────────── */
            <div className="callov">
              <div className="callov-bar">
                {canMinimize && (
                  <button className="callov-min" onClick={() => setMinimized(true)} aria-label="Minimize call">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                )}
                <span className="callov-secure">🔒 Private · numbers hidden</span>
              </div>

              <div className="callov-card">
                <div className={`callov-avatar ${phase === "connected" ? "live" : ""}`}>{initial}</div>
                <div className="callov-name">{peerName}</div>

                {(roleLabel || peerRef) && (
                  <button className="callov-idchip" onClick={copyRef} title="Tap to copy the ID">
                    {roleLabel && <span className="callov-idrole">{roleLabel}</span>}
                    {peerRef && <span className="callov-idcode">#{peerRef}</span>}
                    {peerRef && <span className="callov-idcopy">{copied ? "copied ✓" : "copy"}</span>}
                  </button>
                )}
                {peerPhone && <div className="callov-idphone">{peerPhone}</div>}

                <div className="callov-status">{statusText}</div>

                {phase === "incoming" ? (
                  <div className="callov-actions">
                    <button className="callov-btn decline" onClick={declineIncoming} aria-label="Decline">✕</button>
                    <button className="callov-btn accept" onClick={acceptIncoming} aria-label="Answer">📞</button>
                  </div>
                ) : phase === "connected" ? (
                  <div className="callov-actions">
                    <button className={`callov-btn util ${muted ? "on" : ""}`} onClick={toggleMute} aria-label="Mute">
                      {muted ? "🔇" : "🎙"}
                    </button>
                    <button className="callov-btn end" onClick={endCall} aria-label="End call">✕</button>
                  </div>
                ) : phase === "ended" ? (
                  <div className="callov-actions"><div className="callov-ended-dot">✓</div></div>
                ) : (
                  <div className="callov-actions">
                    <button className="callov-btn end" onClick={endCall} aria-label="Cancel">✕</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <audio ref={audioRef} autoPlay playsInline />
        </>,
        document.body)}
    </CallCtx.Provider>
  );
}
