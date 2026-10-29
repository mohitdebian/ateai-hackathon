import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@ate/shared";
import { supabaseUrl, supabaseAnonKey } from "../env";

/** Browser Supabase client (anon key, subject to RLS). Use in client components. */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}
