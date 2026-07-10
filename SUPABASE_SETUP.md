# NGS Store — Secure Backend Setup (Supabase)

This is the "server brain" that makes the app tamper-proof. Once it's live, a
customer editing their phone can't change prices, invent coupons, or give
themselves points — the server ignores the phone and uses its own numbers.

You only have to do this **once**. It's free to start.

---

## Step 1 — Create the project (5 min)

1. Go to **https://supabase.com** and sign up (Google login is fine).
2. Click **New project**.
   - **Name:** `ngs-store`
   - **Database password:** pick a strong one and save it somewhere safe.
   - **Region:** choose the closest — for India pick **Mumbai / Singapore**.
3. Wait ~2 minutes for it to finish setting up.

## Step 2 — Create the tables + security (2 min)

1. In the left sidebar open **SQL Editor** → **New query**.
2. Open the file **`supabase/schema.sql`** from this project, copy **everything**,
   paste it into the editor, and click **Run**. You should see "Success".
3. New query again → open **`supabase/seed.sql`**, copy all, paste, **Run**.
   (This loads your products, categories, and starter coupons.)

## Step 3 — Turn on phone-OTP login (2 min)

1. Sidebar → **Authentication** → **Providers**.
2. Enable **Phone**. For real SMS you'll connect an SMS provider later
   (Twilio/MSG91); for now you can test with **Email** login, which works out of
   the box.
3. (Optional, recommended) Sidebar → **Authentication** → **Providers** →
   turn **Email** on so you can sign in during testing.

## Step 4 — Make yourself the admin (1 min)

After you sign in to the app once (so your profile exists):

1. Sidebar → **Table Editor** → **profiles**.
2. Find your row, set **role** to `admin`, save.

That's it — only your account can manage products, orders, coupons and settings.

## Step 5 — Give the app the keys

1. Sidebar → **Project Settings** → **API**.
2. Copy two values:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long `eyJ...` string — the one labelled *anon*,
     **not** *service_role*)
3. Send me both, or paste them into a file named **`.env`** in the project root:

   ```
   VITE_SUPABASE_URL=https://abcdxyz.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
   ```

   > ⚠️ Never share or ship the **service_role** key — that one bypasses all
   > security. Only the **anon** key goes in the app.

Once I have those two values, I'll connect the app to the backend and we'll test
that tampering is truly blocked.

---

## What this protects (the whole point)

| Attack a "smart" customer might try | What the server does |
|---|---|
| Edit phone storage to add 99,999 points | A trigger blocks it; points only come from a real, paid order |
| Invent a coupon code | Coupons live in the DB; unknown/expired codes are rejected |
| Change a product price before checkout | `place_order` re-reads the real price from the DB |
| Send a fake low order total | Server recomputes the total from scratch |
| Read the admin password from the app | There is no admin password in the app anymore — auth is server-side |
| Open another customer's orders | Row-Level Security returns only *your* rows |

All of the security rules live in `supabase/schema.sql` — nothing secret is in
the app itself.
