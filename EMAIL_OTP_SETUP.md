# Turn on Email OTP codes (free)

Goal: when a customer logs in, they get an **8-digit code** in their email and
type it in. This needs your own email service connected to Supabase (free), so
Supabase can send the code and you can control the email. ~10 minutes, one time.

We'll use **Brevo** (free: 300 emails/day, no domain required).

---

## Step 1 — Create a free Brevo account
1. Go to **https://www.brevo.com** → **Sign up free** (use your Gmail).
2. Verify your email, finish the short signup.

## Step 2 — Verify your sender email
1. Brevo → **Senders, Domains & Dedicated IPs** → **Senders** → **Add a sender**.
2. Use your email (e.g. `ftstudionkm9923@gmail.com`) as the sender.
3. Brevo emails you a confirmation — click it. Now you can send *from* that address.

## Step 3 — Get your Brevo SMTP details
1. Brevo → top-right menu → **SMTP & API** → **SMTP** tab.
2. Note these:
   - **SMTP server:** `smtp-relay.brevo.com`
   - **Port:** `587`
   - **Login:** the email shown there (your Brevo login email)
   - **Password / SMTP key:** click **Generate a new SMTP key** → copy it

## Step 4 — Put SMTP into Supabase
1. Supabase → **Project Settings** (gear) → **Authentication** → scroll to **SMTP Settings**.
2. Turn on **Enable Custom SMTP**, and fill in:
   - **Sender email:** your verified sender (from Step 2)
   - **Sender name:** `NGS Store`
   - **Host:** `smtp-relay.brevo.com`
   - **Port:** `587`
   - **Username:** your Brevo login (Step 3)
   - **Password:** your Brevo SMTP key (Step 3)
3. **Save**.

## Step 5 — Set the code length to 8 digits
1. Supabase → **Authentication** → **Sign In / Providers** → **Email**.
2. Set **Email OTP Length** to **8** and **Save**. (This is why customers now
   receive an 8-digit code.)

## Step 6 — Make the email show the 8-digit code
Now that custom SMTP is on, Supabase lets you edit the template.
1. Supabase → **Authentication** → **Email Templates** → **Magic Link**.
2. Replace the **message body** with this and **Save**:

```html
<h2>Your NGS login code</h2>
<p>Enter this 8-digit code to sign in:</p>
<h1 style="letter-spacing:6px; font-size:32px">{{ .Token }}</h1>
<p>This code expires in 60 minutes. If you didn't request it, ignore this email.</p>
```

---

## Done — how it works now
Customer opens the store → taps 👤 → enters email → **gets an 8-digit code by
email** → types it in → signed in. Free, no per-message cost within Brevo's
daily free limit.

> Tip: also set the **Site URL** (Supabase → Authentication → URL Configuration)
> to `https://ngs1-bd645.web.app` if you haven't already.
