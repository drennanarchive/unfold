/*
 * Connection settings for the shared claims database (Supabase).
 *
 * Both values are SAFE to commit and publish. The publishable key is designed to
 * live in browser code; the database only lets it claim or unclaim gifts
 * (see supabase-setup.sql). Never paste a "secret" or "service_role" key here.
 *
 * Leave both blank to run in DEMO MODE: the page works, but claims are only
 * saved in your own browser and nobody else sees them.
 */
window.CHRISTMAS_LIST_CONFIG = {
  // Looks like: "https://abcdefghijklmnop.supabase.co"
  supabaseUrl: "",

  // Looks like: "sb_publishable_..."
  supabasePublishableKey: "",

  // How often (in seconds) to check for claims made by other people.
  refreshSeconds: 15,
};
