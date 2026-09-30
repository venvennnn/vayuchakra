"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browser: SupabaseClient | null | undefined;

/** Anon-key client. Only used to start an anonymous session and upload to a server-issued signed URL. */
export function supabaseBrowser(): SupabaseClient | null {
  if (browser !== undefined) return browser;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  browser = url && key ? createBrowserClient(url, key) : null;
  return browser;
}

export async function ensureAnonymousSession(): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb) return;
  try {
    const { data } = await sb.auth.getSession();
    if (!data.session) await sb.auth.signInAnonymously();
  } catch {
    // Anonymous sign-in may be disabled on the project; the site does not depend on it.
  }
}
