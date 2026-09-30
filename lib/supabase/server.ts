import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null | undefined;

/** Service-role client for route handlers. Null when Supabase is not configured. */
export function supabaseAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  admin = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return admin;
}

export const EVIDENCE_BUCKET = "evidence";
