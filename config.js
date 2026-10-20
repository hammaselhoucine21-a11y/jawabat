// Supabase project for the answers. Both values are public by design: the
// publishable key can only do what the database policies allow (insert with
// the secret link code, nothing else). Leave them empty for demo mode, where
// answers stay on the device and nothing is sent.
window.ZQ_CONFIG = {
  url: '', // https://<project>.supabase.co
  key: '', // sb_publishable_... (or the legacy anon key)
};
