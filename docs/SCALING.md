# Growing without breaking

What happens to NGS Store as customers go from 10 to 50,000, what breaks at each
step, and what to do about it. Every number here was measured on the live
project, not estimated.

Measured 27 July 2026. Re-run the numbers with `select capacity_report();` in the
SQL editor as an admin — it returns the same figures live.

---

## Where we are today

| | |
|---|---|
| Plan | Supabase **Free**, Nano instance, Mumbai (ap-south-1) |
| Database | 29 MB of the 500 MB free limit (6%) |
| Catalogue | 118 products, **76 KB** for the customer app to download |
| Customers | 7, of whom 4 ordered in the last 30 days |
| Orders | 70 all time, ~6 a day |

Comfortable. Nothing here is close to a limit.

---

## What was going to break, and when

The database was never the problem. **The request storm was.**

Every open app subscribed to whole tables — products, categories, settings,
coupons, orders, notifications — and re-fetched *everything* whenever anyone,
anywhere, changed anything. Plus a 30-second poll on each of the seven, whether
or not anything had happened.

That makes the cost grow as **writes × users**, not writes + users:

- The repricer updates all 118 products every 6 hours. Each row was its own
  event, so **one cron run made every phone in the city download the 76 KB
  catalogue 118 times** — 8.9 MB per customer per run. At 5,000 customers that
  is one cron job generating 45 GB.
- One customer placing an order woke up every other customer's app, because they
  were all listening to the whole `orders` table.
- At rest, 1,000 open apps meant 14,000 requests a minute with nobody touching
  anything, and 9 GB an hour of catalogue JSON.

On the current instance that design falls over somewhere around **300–800
people using the app at the same time** — not 50,000. It would have looked like
the app going slow, then timing out, then orders failing at checkout on the
busiest evening.

Three more things were waiting behind it:

- **`order_items` had no index on `order_id`.** 1.13 million full-table scans
  already logged, reading 86 million rows. Free on 76 rows; at 100,000 order
  lines, every "show me this order" reads all 100,000.
- **Security checks ran per row.** `user_id = auth.uid() or is_admin()` was
  re-evaluated for every row of every read, and `is_admin()` is itself a lookup.
- **Two admin screens fetched all of history.** The ops list re-downloaded every
  order ever placed *with its line items* every five seconds; the customer list
  counted each customer's lifetime orders by filtering that same array.

---

## What has been fixed (done, live)

| Fix | Effect |
|---|---|
| `catalog_state` — one row of counters, bumped once per *statement* | A full repricer run now costs each phone **10 tiny events → exactly 1 catalogue fetch**, instead of 118 fetches. Verified live. |
| Catalogue tables removed from the realtime publication | Less write-ahead log to decode — that decoding was already the single biggest CPU consumer on the instance (5,359 seconds). |
| Orders / notifications / wallet subscribed **filtered by `user_id`** | A customer is only told about their own rows. One order no longer wakes every phone. |
| Change events coalesced (400 ms) | A burst of changes causes one fetch, not one per row. |
| Polling backed off: 30 s → 60 s for own data, 5–10 min for shop-wide data | Idle traffic per app drops roughly **20×**. |
| 21 indexes added, including `order_items(order_id)` | Every foreign key in the database now has an index behind it. |
| 56 security policies rewritten to evaluate once per query | Same rules exactly — verified that a customer still cannot read another customer's order, and anonymous can read none. |
| Ops order list windowed (45 days + everything still open, capped) | Stops growing with history. |
| Customer totals computed in the database | One indexed pass instead of downloading every order to add them up. |
| Fetch caps: 100 orders, 60 notifications, 200 wallet rows | Nothing grows for life. Wallet **balance** now comes from the server, so capping the visible history cannot make the balance wrong. |
| Nightly retention job | `notifications` was on track for 20 million rows a year at 5,000 customers. Read messages are dropped after 90 days, everything after 180. The books — orders, ledgers, payouts — are never touched. |
| Daily capacity watchdog | Tells you what to do *before* it hurts. See below. |

---

## The ladder

Each step says what triggers it, what to do, and what it costs. Do not do a step
early — an idle bigger server is money for nothing.

### Step 1 — now, up to ~500 people a day (~50 orders/day)
**Free plan. Nothing to do.**
Peak concurrent users at this size is roughly 25. The system is at a few percent
of what it can take.

### Step 2 — 500 to 5,000 people a day (50–200 orders/day)
**Move to Supabase Pro — $25/month (about ₹2,100).**

Triggered by whichever comes first: 200 orders in a day, the database passing
300 MB, or the first month you send more than 5 GB of data.

What it buys, in order of how much it matters here:
1. **Egress 5 GB → 250 GB.** The free allowance is the first real wall.
2. **Image caching.** Product photos are currently served with `cache-control:
   no-cache`, so every phone re-downloads every photo on every visit — about
   1 MB per home screen. Pro's CDN fixes this and it is the single biggest
   bandwidth saving available.
3. **Daily backups, 7-day recovery.** At this point losing the database means
   losing the business. This alone justifies the price.
4. No pausing after a week of inactivity.

### Step 3 — 5,000 to 20,000 people a day (200–1,000 orders/day)
**Add a Small or Medium compute instance — $15–60/month on top.**

Triggered by the watchdog, or by the app feeling slow at 7–9 pm.

- Small: 2 GB RAM, 400 pooled connections (~₹1,300/month)
- Medium: 4 GB RAM, 600 pooled connections (~₹5,000/month)

Also at this step:
- Turn on `pg_stat_statements` review monthly — find the slowest query, index it.
- Move the product catalogue to a cached static file refreshed on
  `catalog_state` change, so the busiest read never touches the database.
- Consider a second delivery zone before a second server; the shop is the
  bottleneck long before Postgres is.

### Step 4 — 20,000 to 50,000+ a day (1,000+ orders/day)
At this size the constraint is the shop, not the software: 1,000 orders a day is
roughly 40 an hour all day, which is a warehouse and a fleet, not a kirana.
Technically, in order:

- **Large compute** (8 GB, dedicated CPU) — about ₹20,000/month.
- **Read replica** for the dashboards, so reporting can never slow down
  checkout.
- **Partition `orders` and `order_items` by month.** Straightforward while the
  tables are small; painful once they are not.
- **Archive** delivered orders older than a year to cold storage.
- Static catalogue on a CDN, per-city.

---

## How you will know — the watchdog

`run_capacity_watch()` runs every morning at 6:00 and sends an admin
notification **only when something needs doing**. Silence means fine.

It watches:

| Check | Warns at | What it tells you |
|---|---|---|
| Database size | 300 MB / 400 MB | Plan the upgrade / do it now |
| Orders yesterday | 200 | Move to the Small instance |
| Customers ordering in 30 days | 1,000 | You are past what free is meant for |
| Catalogue download size | 2 MB | The app will feel slow on a weak signal |
| New table links without an index | any | A future feature reintroduced the old problem |
| Big tables being read end-to-end | 50,000 rows | Something needs an index |

The last two matter most in the long run: they catch a *new* mistake of the same
kind, which is how this class of problem always comes back.

---

## Rules to keep it fast

For anything built from here on:

1. **Never subscribe to a whole table that customers share.** Use
   `catalog_state`, or subscribe with a `user_id` filter.
2. **Never fetch a list that grows forever.** Every customer-facing query needs a
   `.limit()`. If a total is needed, sum it in the database.
3. **Every foreign key gets an index**, in the same migration that creates it.
   The watchdog will catch it, but the migration is the right place.
4. **Never compute money by adding up rows on the phone.** The server owns
   balances and totals; the phone draws them.
5. **Add indexes while the table is small.** Doing it later means
   `CREATE INDEX CONCURRENTLY` and a careful window.

---

## Not done, and why

- **Image CDN caching** — needs the Pro plan; there is nothing to change in the
  code. Product photos are already downscaled to 600 px and capped at 150 KB on
  upload.
- **Read replicas, partitioning** — pointless before Step 4, and cheaper to do
  when the shape of the load is known.
- **Load testing** — worth doing once real traffic patterns exist; synthetic
  numbers at this stage would mostly measure the test.
