# Host the customer web app on Firebase Hosting

Your data + security stay on Supabase (free, already working). Firebase is used
only to serve the customer web page. This gives you a clean URL like
`https://ngs-store.web.app`.

You do this once. It needs a computer for one 2-minute step (to connect Firebase
to GitHub). After that, every change auto-deploys.

---

## Step 1 — Create the Firebase project
1. Go to **https://console.firebase.google.com** (sign in with your Google
   account — `ftstudionkm9923@gmail.com`).
2. **Add project** → name it **ngs-store** → you can disable Google Analytics →
   **Create**.
3. In the left menu open **Build → Hosting** → **Get started** (just click
   through; you don't need to run the commands it shows).

## Step 2 — Put your project id in the repo
1. In the Firebase console, **Project settings** (gear icon) → copy the
   **Project ID** (e.g. `ngs-store-1a2b3`).
2. In this repo, open **`.firebaserc`** and **`.github/workflows/firebase-hosting.yml`**
   and replace `PUT-YOUR-FIREBASE-PROJECT-ID-HERE` with that id.
   (Tell me the id and I'll do this for you.)

## Step 3 — Let GitHub deploy to Firebase (the one computer step)
On a computer with Node installed:
```bash
npm install -g firebase-tools
firebase login
firebase init hosting:github
```
- When it asks for the GitHub repo: `pking6760-lang/ngs-store`
- Set up the workflow to run a build: **Yes**, build command: `npm ci && npm run build`
- This automatically creates the **`FIREBASE_SERVICE_ACCOUNT`** secret in your
  GitHub repo, which the deploy workflow uses.

*(No computer handy? In the Firebase console → Project settings → Service
accounts → “Generate new private key”. Then in GitHub → repo Settings →
Secrets and variables → Actions → New secret named `FIREBASE_SERVICE_ACCOUNT`,
paste the whole JSON. That does the same thing.)*

## Step 4 — Deploy
Any push to the branch now builds and deploys automatically (GitHub → **Actions**
tab shows progress). Your store goes live at:

**https://<your-project-id>.web.app**

## Step 5 — Tell Supabase the site URL (so login links return correctly)
Supabase → **Authentication → URL Configuration**:
- **Site URL**: `https://<your-project-id>.web.app`
- Add the same under **Redirect URLs** → **Save**

---

### Simpler alternative that's already 95% done
The app is also deployed on **GitHub Pages** — that needs **no computer and no
service account**, just one toggle:
Repo → **Settings → Pages → Source: Deploy from a branch → `gh-pages` / root → Save**.
It goes live at `https://pking6760-lang.github.io/ngs-store/`. Use whichever you
prefer; the app is identical.
