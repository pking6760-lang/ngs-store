import { useState } from "react";
import AdminPortal from "./AdminPortal.jsx";
import { useBackGuard } from "../lib/useBackGuard.js";

// A themed replacement for the native <select>, whose OS-drawn popup doesn't
// match the app. Renders a button + a portalled, indigo-themed option sheet.
// options: [{ value, label, kind? }]  — kind "new" styles a "create" row.
export default function Dropdown({ value, onChange, options, placeholder = "Select…", className = "", title }) {
  const [open, setOpen] = useState(false);
  useBackGuard(open, () => setOpen(false));
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        className={`adm-dd ${className}`}
        onClick={() => setOpen(true)}
        title={title}
      >
        <span className="adm-dd-val">{current ? current.label : placeholder}</span>
        <span className="adm-dd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <AdminPortal>
          <div className="adm-dd-overlay" onClick={() => setOpen(false)}>
            <div className="adm-dd-sheet" onClick={(e) => e.stopPropagation()}>
              {title && <div className="adm-dd-title">{title}</div>}
              <div className="adm-dd-list">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`adm-dd-opt ${o.value === value ? "sel" : ""} ${o.kind || ""}`}
                    onClick={() => { onChange(o.value); setOpen(false); }}
                  >
                    <span className="adm-dd-opt-lbl">{o.label}</span>
                    {o.value === value && <span className="adm-dd-check" aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </AdminPortal>
      )}
    </>
  );
}
