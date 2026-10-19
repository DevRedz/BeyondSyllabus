export function getSupabaseConfig() {
  const supabaseUrl = process.env.NEXT_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_SUPABASE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_SUPABASE_URL and NEXT_SUPABASE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }

  return { supabaseUrl, supabaseKey };
}
