// In-app voice calls over WebRTC. Audio is peer-to-peer; only the SDP/ICE
// handshake rides Supabase Realtime broadcast on channel "call-<id>". No phone
// number is ever exposed — the two sides are matched by call id alone.
import { supabase } from "./supabase.js";

// STUN is free and covers most networks. TURN (a relay) is needed on the ~10-15%
// of mobile/symmetric-NAT networks where P2P can't connect — paste free-tier
// TURN creds into these env vars and every call will connect.
const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
];
const TURN_URL = import.meta.env.VITE_TURN_URL;
if (TURN_URL) {
  ICE_SERVERS.push({
    urls: TURN_URL.split(","),
    username: import.meta.env.VITE_TURN_USER || "",
    credential: import.meta.env.VITE_TURN_CRED || "",
  });
}

export function isCallSupported() {
  return typeof window !== "undefined" &&
    typeof window.RTCPeerConnection !== "undefined" &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Manage one voice call. `isCaller` decides who creates the SDP offer.
// Callbacks: onStatus("calling"|"connected"|"reconnecting"|"failed"|"ended"),
//            onRemoteStream(MediaStream).
export function createVoiceCall({ callId, isCaller, onStatus, onRemoteStream }) {
  let pc = null, channel = null, localStream = null, remoteStream = null;
  let remoteReady = false, pending = [], closed = false, announced = false, offered = false;
  const emit = (s) => { try { onStatus && onStatus(s); } catch { /* ignore */ } };

  function send(type, extra) {
    if (!channel) return;
    channel.send({ type: "broadcast", event: "signal",
      payload: { type, from: isCaller ? "caller" : "callee", ...extra } });
  }

  async function makeOffer() {
    if (offered || !pc) return;
    offered = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send("offer", { sdp: pc.localDescription });
  }

  async function flush() {
    for (const c of pending) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
    pending = [];
  }

  async function onSignal(msg) {
    if (!msg || closed) return;
    if (msg.from === (isCaller ? "caller" : "callee")) return; // ignore our own echo
    try {
      if (msg.type === "ready") {
        if (!announced) { announced = true; send("ready", {}); } // help a late joiner
        if (isCaller) await makeOffer();
        return;
      }
      if (msg.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        remoteReady = true; await flush();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send("answer", { sdp: pc.localDescription });
        return;
      }
      if (msg.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        remoteReady = true; await flush();
        return;
      }
      if (msg.type === "ice" && msg.candidate) {
        if (remoteReady) { try { await pc.addIceCandidate(msg.candidate); } catch { /* ignore */ } }
        else pending.push(msg.candidate);
        return;
      }
      if (msg.type === "bye") { emit("ended"); return; }
    } catch { /* a malformed signal shouldn't kill the call */ }
  }

  async function start() {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    remoteStream = new MediaStream();
    pc.ontrack = (e) => {
      (e.streams[0] ? e.streams[0].getTracks() : [e.track]).forEach((t) => remoteStream.addTrack(t));
      onRemoteStream && onRemoteStream(remoteStream);
    };
    pc.onicecandidate = (e) => { if (e.candidate) send("ice", { candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") emit("connected");
      else if (st === "failed") emit("failed");
      else if (st === "disconnected") emit("reconnecting");
    };

    channel = supabase.channel(`call-${callId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("signal timeout")), 12000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(t); res(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(t); rej(new Error(status)); }
      });
    });

    announced = true;
    send("ready", {});
    if (isCaller) emit("calling");
  }

  function setMuted(muted) {
    if (localStream) localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  }

  function hangup() {
    if (closed) return; closed = true;
    try { send("bye", {}); } catch { /* ignore */ }
    try { pc && pc.close(); } catch { /* ignore */ }
    try { localStream && localStream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    try { channel && supabase.removeChannel(channel); } catch { /* ignore */ }
  }

  return { start, hangup, setMuted };
}
