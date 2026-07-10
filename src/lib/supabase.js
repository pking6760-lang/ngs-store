// Supabase client — the single connection to the secure backend.
//
// The URL and the ANON (public) key are safe to ship in the app: they only
// let a caller do what the Row-Level Security policies allow. The SERVICE key
// (which bypasses security) must NEVER be put in the app — it lives only in
// the Supabase dashboard / server.
//
// Values come from build-time env vars (see .env.example). If they're missing
// we export `supabase = null` so the app can fall back to the local demo data
// layer instead of crashing — this keeps the Artifact preview working.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isBackendConfigured = Boolean(url && anonKey);

export const supabase = isBackendConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
