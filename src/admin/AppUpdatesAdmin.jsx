import { useEffect, useState } from "react";
import * as api from "../lib/api.js";

// Publish a new app version. Any installed app on a lower versionCode is then
// forced (non-dismissible screen) to download & install the new APK.
const APPS = [
  { id: "customer", label: "Customer app" },
  { id: "partner", label: "Partner app" },
];

export default function AppUpdatesAdmin() {
  const [versions, setVersions] = useState({});
  const load = () =>
    api.fetchAllAppVersions().then((rows) => {
      const m = {}; rows.forEach((r) => { m[r.app] = r; }); setVersions(m);
    }).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <div className="appupd">
      <p className="appupd-intro">
        Publish a new version and every phone running an older one is <b>blocked with an
        update screen</b> until they install the new APK. The <b>version code</b> must
        exactly match the APK you built (a whole number, higher than the current one).
      </p>
      {APPS.map((a) => (
        <AppCard key={a.id} app={a} current={versions[a.id]} onDone={load} />
      ))}
    </div>
  );
}

function AppCard({ app, current, onDone }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (current?.versionCode) setCode(String(current.versionCode + 1));
  }, [current]);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!code) { setMsg("Enter the version code first, then choose the APK."); return; }
    setUploading(true); setMsg("");
    try {
      const u = await api.adminUploadAppApk(f, app.id, code);
      setUrl(u);
      setMsg("APK uploaded ✓");
    } catch (err) { setMsg(err.message || "Upload failed."); }
    finally { setUploading(false); }
  }

  async function publish() {
    if (uploading) { setMsg("The APK is still uploading — wait for “APK uploaded ✓”."); return; }
    if (!name.trim() || !code) { setMsg("Version name and code are required."); return; }
    if (!url.trim()) { setMsg("No APK uploaded yet. Choose the file and wait for “APK uploaded ✓”, or paste an APK link below."); return; }
    if (current && Number(code) <= current.versionCode) { setMsg(`Version code must be higher than ${current.versionCode}.`); return; }
    if (!confirm(`Publish ${app.label} v${name} (code ${code})?\n\nEveryone on an older version will be forced to update.`)) return;
    setBusy(true); setMsg("");
    try {
      await api.adminPublishAppVersion({
        app: app.id, versionName: name.trim(), versionCode: Number(code),
        apkUrl: url.trim(), notes: notes.trim(),
      });
      setMsg("Published ✓ Older apps will now prompt to update.");
      setName(""); setNotes("");
      onDone();
    } catch (err) { setMsg(err.message || "Couldn't publish."); }
    finally { setBusy(false); }
  }

  return (
    <div className="appupd-card">
      <div className="appupd-head">
        <h3>{app.label}</h3>
        {current
          ? <span className="appupd-cur">Live: v{current.versionName} · code {current.versionCode}</span>
          : <span className="appupd-cur none">Not published</span>}
      </div>
      {current?.apkUrl && (
        <a className="appupd-link" href={current.apkUrl} target="_blank" rel="noreferrer">Current APK ↗</a>
      )}

      <div className="appupd-form">
        <label>Version name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 1.1" />
        </label>
        <label>Version code (whole number)
          <input inputMode="numeric" value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 2" />
        </label>
        <label>New APK file
          <input type="file" accept=".apk,application/vnd.android.package-archive"
            onChange={onFile} disabled={uploading || !code} />
        </label>
        <label>…or paste an APK link
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/app.apk" />
        </label>
        <label>What's new (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="Shown on the update screen" />
        </label>
        {msg && <div className="appupd-msg">{msg}</div>}
        <button className="appupd-pub" disabled={busy || uploading} onClick={publish}>
          {busy ? "Publishing…" : uploading ? "Uploading APK…" : "Publish update"}
        </button>
      </div>
    </div>
  );
}
