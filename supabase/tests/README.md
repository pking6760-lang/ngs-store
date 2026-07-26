# Loss sweep

Proves the invariant the whole money system exists to hold:

> **No order may be sold at a loss** — except a `guaranteed` coupon, which is
> the owner's explicit choice to absorb one, and even then never more than the
> coupon's face value.

`loss-sweep.sql` installs `_loss_sweep(uid)`. It places **real orders** through
`_place_order_core` across every combination of cart shape × distance ×
member × coupon type × points redemption, computes the true shop P&L of each,
and rolls every one back. Nothing is re-derived — whatever the live engine does
is what gets measured, so the test cannot drift away from the code.

The P&L it computes is deliberately stricter than the engine's own `v_profit`:
it also subtracts scratch payouts and welcome credit, which the engine's figure
omits.

## Run it

```sql
begin;
insert into public.coupons (code, type, value, min_order, active, guaranteed)
values ('CAPPED49','flat',49,0,true,false), ('GUARANTEED49','flat',49,0,true,true)
on conflict (code) do update set value=excluded.value, active=true,
  guaranteed=excluded.guaranteed, min_order=0;

create temp table sw as
  select * from public._loss_sweep((select id from public.profiles where role='admin' limit 1));

select count(*) filter (where err is not null)                        as blocked_out_of_area,
       count(*) filter (where coupon <> 'GUARANTEED49' and profit < 0) as unintended_losses,
       round(min(profit) filter (where coupon = 'GUARANTEED49'), 2)    as guaranteed_worst
from sw;
rollback;
```

`unintended_losses` must be **0**. `guaranteed_worst` must be no worse than
minus the coupon's face value.

## What it caught

Run against the engine on 2026-07-26 it found 236 losing combinations out of
360, worst −₹253, across four distinct defects:

| # | Defect | Effect |
|---|--------|--------|
| A | Delivery radius enforced only in the app; fee bands stop at ₹50 while rider pay keeps climbing | every out-of-area order lost money |
| B | Points redemption capped at 20% of cart value, never by margin | 52/60 losing, worst −₹204 |
| C | "Capped" coupons capped at *margin*, not profit — took 100% of it, leaving the rider unpaid | 36/60 losing, worst −₹56 |
| D | Guaranteed coupons stacked on top of B | −₹253 |

B, C and D shared one root cause: each giveaway was capped independently
against margin, blind to the others and to what fulfilment costs. They were
replaced by a single budget — what remains after the order pays for itself —
that every giveaway draws from in turn.

After the fix: **0 unintended losses**, out-of-area orders refused server-side.
