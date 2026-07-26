import { useCallback, useEffect, useMemo, useState } from "react";
import { Ic } from "./AdminIcons.jsx";
import { toast } from "../lib/toast.js";
import * as api from "../lib/api.js";

// Business money: what came in, what went out, what's actually left.
// Everything here is read through admin-gated RPCs — no finance data is
// reachable by a customer or partner.

const KINDS = [
  { id: "restock", label: "Stock purchase", icon: "📦", cash: true },
  { id: "rent", label: "Shop rent", icon: "🏠" },
  { id: "electricity", label: "Electricity", icon: "💡" },
  { id: "salary", label: "Staff salary", icon: "👤" },
  { id: "packaging", label: "Packaging", icon: "🛍️" },
  { id: "transport", label: "Transport / fuel", icon: "⛽" },
  { id: "internet", label: "Internet / phone", icon: "📶" },
  { id: "marketing", label: "Marketing", icon: "📣" },
  { id: "maintenance", label: "Maintenance", icon: "🔧" },
  { id: "repairs", label: "Repairs", icon: "🛠️" },
  { id: "licence", label: "Licence / fees", icon: "📄" },
  { id: "other", label: "Other", icon: "•" },
];
const kindOf = (id) => KINDS.find((k) => k.id === id) || { label: id, icon: "•" };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangeFor(key) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (key === "this_month") return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
  if (key === "last_month") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (key === "7d") { const s = new Date(now); s.setDate(s.getDate() - 6); return [iso(s), iso(now)]; }
  if (key === "today") return [iso(now), iso(now)];
  return ["2020-01-01", iso(now)]; // all time
}
const money = (n) => `₹${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-IN")}`;

export default function MoneyAdmin() {
  const [period, setPeriod] = useState("this_month");
  const [sum, setSum] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [top, setTop] = useState([]);
  const [staff, setStaff] = useState([]);
  const [sponsors, setSponsors] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);

  const [from, to] = useMemo(() => rangeFor(period), [period]);

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const [s, e, t, st, sp] = await Promise.all([
        api.adminFinanceSummary(from, to),
        api.adminListExpenses(from, to),
        api.adminTopProducts(from, to, 8),
        api.adminListStaff(),
        api.adminListSponsorships().catch(() => []),
      ]);
      setSum(s); setExpenses(e); setTop(t); setStaff(st); setSponsors(sp);
    } catch (e2) {
      setErr(e2.message || "Couldn't load your numbers.");
    } finally { setBusy(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  if (busy && !sum) return <div className="money-empty">Adding it up…</div>;

  return (
    <div className="money">
      <div className="money-periods">
        {[["today", "Today"], ["7d", "7 days"], ["this_month", "This month"],
          ["last_month", "Last month"], ["all", "All time"]].map(([k, l]) => (
          <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>

      {err && <div className="money-err">{err}</div>}

      {sum && (
        <>
          <CashCard sum={sum} />
          <ProfitCard sum={sum} />
          <ExpenseAdd staff={staff} onSaved={load} />
          <ExpenseList rows={expenses} onChanged={load} />
          <StaffCard staff={staff} onChanged={load} />
          <SponsorCard rows={sponsors} onChanged={load} />
          <TopProducts rows={top} />
        </>
      )}
    </div>
  );
}

/* ── what's actually left ─────────────────────────────────────────────── */
function CashCard({ sum }) {
  const c = sum.cash || {};
  const left = Number(c.balance_all) || 0;
  return (
    <section className="money-card cash">
      <div className="mc-head">
        <h3>Money in the business</h3>
        <span className="mc-sub">everything received, minus everything paid out</span>
      </div>
      <div className={`cash-big ${left >= 0 ? "good" : "bad"}`}>{money(left)}</div>
      <div className="cash-split">
        <div><span>Total received</span><b className="in">{money(c.in_all)}</b></div>
        <div><span>Total spent</span><b className="out">{money(c.out_all)}</b></div>
      </div>
      <div className="cash-period">
        <span>This period</span>
        <span className="cp-in">in {money(c.in)}</span>
        <span className="cp-out">out {money(c.out)}</span>
        <b className={Number(c.net) >= 0 ? "good" : "bad"}>{Number(c.net) >= 0 ? "+" : ""}{money(c.net)}</b>
      </div>
    </section>
  );
}

/* ── did the shop actually make money? ────────────────────────────────── */
function ProfitCard({ sum }) {
  const s = sum.sales || {}, c = sum.costs || {}, e = sum.expenses || {}, p = sum.profit || {}, b = sum.breakeven || {};
  const net = Number(p.net) || 0;
  return (
    <section className="money-card">
      <div className="mc-head">
        <h3>Profit &amp; loss</h3>
        <span className="mc-sub">{s.orders || 0} delivered order{s.orders === 1 ? "" : "s"} · {sum.days} day{sum.days === 1 ? "" : "s"}</span>
      </div>

      <div className="pl">
        <Row label="Goods sold" v={s.goods} plus />
        <Row label="Delivery & handling fees" v={s.fees} plus />
        {Number(s.membership) > 0 && <Row label="Prime memberships" v={s.membership} plus />}
        <Row label="Cost of goods (what you paid)" v={c.cogs} />
        <Row label="Picker pay" v={c.picker} />
        <Row label="Driver pay" v={c.rider} />
        {Number(c.rewards) > 0 && <Row label="Rewards & referral bonuses" v={c.rewards} />}
        {Number(c.refunds) > 0 && <Row label="Refunds" v={c.refunds} />}
        <Row label="Running costs (rent, bills, salary…)" v={e.running} />
        <div className="pl-row total">
          <span>{net >= 0 ? "Net profit" : "Net loss"}</span>
          <b className={net >= 0 ? "good" : "bad"}>{money(Math.abs(net))}</b>
        </div>
      </div>

      <div className="pl-chips">
        <span><b>{money(p.per_order)}</b> profit per order</span>
        <span><b>{money(p.per_day)}</b> per day</span>
        {b.orders_needed_per_day > 0 && (
          <span className="warn"><b>{b.orders_needed_per_day}</b> orders/day to break even</span>
        )}
      </div>

      {Number(c.lines_estimated) > 0 && (
        <p className="pl-note warn">
          {c.lines_estimated} of {c.lines} sold items had no buying price saved, so their cost was
          estimated. Add cost prices in Products to make this profit figure exact.
        </p>
      )}

      {Number(e.restock) > 0 && (
        <p className="pl-note">
          {money(e.restock)} of stock purchases isn't counted as a loss above — that money became
          inventory you still own. It <b>is</b> counted in "money in the business".
        </p>
      )}
    </section>
  );
}
const Row = ({ label, v, plus }) => (
  Number(v) ? (
    <div className="pl-row">
      <span>{label}</span>
      <b className={plus ? "in" : "out"}>{plus ? "+" : "−"}{money(v)}</b>
    </div>
  ) : null
);

/* ── record a spend ───────────────────────────────────────────────────── */
function ExpenseAdd({ staff, onSaved }) {
  const [kind, setKind] = useState("restock");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState(iso(new Date()));
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const amt = Number(amount);
    if (!(amt > 0)) { toast("Enter an amount."); return; }
    setBusy(true);
    try {
      await api.adminAddExpense({ kind, amount: amt, note, spentOn: date, staffId: kind === "salary" ? staffId || null : null });
      setAmount(""); setNote(""); setStaffId("");
      toast("Saved");
      onSaved();
    } catch (e2) { toast(e2.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  return (
    <section className="money-card">
      <div className="mc-head"><h3>Record a spend</h3></div>
      <form className="exp-form" onSubmit={save}>
        <div className="exp-kinds">
          {KINDS.map((k) => (
            <button type="button" key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>
              <span>{k.icon}</span>{k.label}
            </button>
          ))}
        </div>
        {kind === "salary" && (
          <select className="exp-in" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            <option value="">Which person? (optional)</option>
            {staff.filter((s) => s.active).map((s) => (
              <option key={s.id} value={s.id}>{s.name} — {money(s.monthly_salary)}/month</option>
            ))}
          </select>
        )}
        <div className="exp-row">
          <input className="exp-in amt" type="number" min="1" step="0.01" inputMode="decimal"
            value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount ₹" />
          <input className="exp-in" type="date" value={date} max={iso(new Date())}
            onChange={(e) => setDate(e.target.value)} />
        </div>
        <input className="exp-in" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional) — e.g. Amul stock, July bill" maxLength={300} />
        <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Add spend"}</button>
      </form>
    </section>
  );
}

/* ── what you've spent ────────────────────────────────────────────────── */
function ExpenseList({ rows, onChanged }) {
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  async function del(r) {
    if (!confirm(`Delete this ${kindOf(r.kind).label.toLowerCase()} of ${money(r.amount)}?`)) return;
    try { await api.adminDeleteExpense(r.id); onChanged(); }
    catch (e) { toast(e.message || "Couldn't delete."); }
  }
  return (
    <section className="money-card">
      <div className="mc-head">
        <h3>Spending</h3>
        <span className="mc-sub">{rows.length} entr{rows.length === 1 ? "y" : "ies"} · {money(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="panel-empty">Nothing recorded for this period.</p>
      ) : (
        <div className="exp-list">
          {rows.map((r) => (
            <div className="exp-item" key={r.id}>
              <span className="exp-ic">{kindOf(r.kind).icon}</span>
              <div className="exp-txt">
                <b>{kindOf(r.kind).label}{r.staff_name ? ` · ${r.staff_name}` : ""}</b>
                <small>{new Date(r.spent_on + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  {r.note ? ` · ${r.note}` : ""}</small>
              </div>
              <b className="exp-amt">{money(r.amount)}</b>
              <button className="exp-del" onClick={() => del(r)} aria-label="Delete"><Ic name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── salaried people (not pickers/riders — they're paid per task) ─────── */
function StaffCard({ staff, onChanged }) {
  const blank = { id: null, name: "", role: "helper", phone: "", salary: "", active: true };
  const [form, setForm] = useState(blank);
  const [open, setOpen] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { toast("Name is required."); return; }
    try {
      await api.adminSaveStaff(form);
      setForm(blank); setOpen(false); onChanged(); toast("Saved");
    } catch (e2) { toast(e2.message || "Couldn't save."); }
  }
  async function remove(s) {
    if (!confirm(`Remove ${s.name} from the salary list?`)) return;
    try { await api.adminDeleteStaff(s.id); onChanged(); }
    catch (e) { toast(e.message || "Couldn't remove."); }
  }

  const monthly = staff.filter((s) => s.active).reduce((t, s) => t + (Number(s.monthly_salary) || 0), 0);

  return (
    <section className="money-card">
      <div className="mc-head">
        <h3>Salaried staff</h3>
        <span className="mc-sub">{money(monthly)}/month committed</span>
      </div>
      <p className="mc-note">Pickers and drivers aren't here — they're paid per order automatically.
        This is for people on a fixed wage.</p>

      {staff.filter((s) => s.active).map((s) => (
        <div className="staff-row" key={s.id}>
          <div>
            <b>{s.name}</b>
            <small>{s.role}{s.phone ? ` · ${s.phone}` : ""}</small>
          </div>
          <b className="staff-sal">{money(s.monthly_salary)}<small>/mo</small></b>
          <button className="exp-del" onClick={() => remove(s)} aria-label="Remove"><Ic name="trash" size={14} /></button>
        </div>
      ))}

      {open ? (
        <form className="exp-form" onSubmit={save} style={{ marginTop: 10 }}>
          <input className="exp-in" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Name" maxLength={80} />
          <div className="exp-row">
            <select className="exp-in" value={form.role} onChange={(e) => set("role", e.target.value)}>
              {["co-admin", "helper", "cashier", "stocker", "cleaner", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className="exp-in amt" type="number" min="0" value={form.salary}
              onChange={(e) => set("salary", e.target.value)} placeholder="₹ / month" />
          </div>
          <input className="exp-in" type="tel" inputMode="numeric" maxLength={10} value={form.phone}
            onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder="Phone (optional)" />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ghost-btn" type="button" onClick={() => { setForm(blank); setOpen(false); }}>Cancel</button>
            <button className="primary-btn" type="submit">Save person</button>
          </div>
        </form>
      ) : (
        <button className="ghost-btn" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>+ Add a person</button>
      )}
    </section>
  );
}

/* ── what to restock: the items that actually earn ────────────────────── */
function TopProducts({ rows }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => Number(r.profit) || 0), 1);
  return (
    <section className="money-card">
      <div className="mc-head">
        <h3>Your money-makers</h3>
        <span className="mc-sub">most profit this period — restock these first</span>
      </div>
      <div className="top-list">
        {rows.map((r, i) => (
          <div className="top-row" key={r.name + i}>
            <span className="top-rank">{i + 1}</span>
            <div className="top-txt">
              <b>{r.name}</b>
              <small>{r.units} sold · {money(r.revenue)} sales</small>
            </div>
            <div className="top-bar"><span style={{ width: `${Math.max(6, (Number(r.profit) / max) * 100)}%` }} /></div>
            <b className="top-profit">{money(r.profit)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── brand sponsorship: money that buys deliveries, never discounts ────── */
function SponsorCard({ rows, onChanged }) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState("");
  const [amount, setAmount] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!brand.trim() || !(Number(amount) > 0)) { setErr("Brand and amount are needed."); return; }
    setBusy(true); setErr("");
    try {
      await api.adminSaveSponsorship({ brand: brand.trim(), amount, endsOn: endsOn || null, note });
      setBrand(""); setAmount(""); setEndsOn(""); setNote(""); setOpen(false);
      onChanged();
    } catch (e) { setErr(e.message || "Couldn't save."); }
    finally { setBusy(false); }
  }

  const live = rows.filter((r) => r.active && r.remaining > 0);

  return (
    <section className="money-card">
      <h3>Brand sponsorship</h3>
      <p className="money-sub">
        A brand pays, and their money covers the delivery fee on real orders — so
        customers get free delivery without you cutting a single price. Never
        touches what a product sells for.
      </p>

      {live.length > 0 ? (
        <p className="money-sub" style={{ color: "var(--a-good, #17663F)" }}>
          Delivery is currently free, funded by <b>{live[0].brand}</b>.
        </p>
      ) : (
        <p className="money-sub">No campaign is funding delivery right now.</p>
      )}

      {rows.length > 0 && (
        <div className="money-rows">
          {rows.map((r) => (
            <div className="money-row" key={r.id}>
              <span>
                {r.brand}
                <small>
                  ₹{Math.round(r.spent)} of ₹{Math.round(r.amount)} used · {r.deliveries} deliveries
                  {r.endsOn ? ` · ends ${r.endsOn}` : ""}
                  {!r.active ? " · paused" : r.remaining <= 0 ? " · finished" : ""}
                </small>
              </span>
              <b>₹{Math.round(r.remaining)}</b>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <div className="money-form">
          <input placeholder="Brand (e.g. Amul)" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <input type="number" inputMode="decimal" placeholder="Amount they paid (₹)"
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="money-err">{err}</div>}
          <div className="money-form-btns">
            <button className="money-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="money-btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Add campaign"}</button>
          </div>
        </div>
      ) : (
        <button className="money-btn ghost" onClick={() => setOpen(true)}>Add a campaign</button>
      )}
    </section>
  );
}
