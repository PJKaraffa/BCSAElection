const SUPABASE_URL = "https://btlkmkonmyorqggavxio.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_5KErny_CVjn6VdRMP337hw_2pPBuhbT";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
