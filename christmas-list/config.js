/*
 * Settings shared by the family page (index.html) and the owner page (manage.html).
 *
 * The Supabase URL and publishable key are SAFE to publish: that key is designed
 * for browser code, and the database only lets it do what supabase/setup.sql allows.
 * Never paste a "secret" or "service_role" key here.
 */
window.CHRISTMAS_LIST_CONFIG = {
  // Supabase > Connect (or Project Settings > Data API). Looks like "https://abcdefghijklmnop.supabase.co"
  supabaseUrl: "https://ailjalhouwzjayzcphpi.supabase.co",

  // Supabase > Connect (or Project Settings > API Keys). Looks like "sb_publishable_..."
  supabasePublishableKey: "sb_publishable_ijgRaY-20R-L60TRVo2sEA_nf_xdWY-",

  // Shown on the front door.
  year: 2026,

  // How often (seconds) the family page checks for other people's claims.
  refreshSeconds: 15,

  // The two lists. "key" must match the database (clara / cameron).
  people: [
    { key: "clara", name: "Clara", tagline: "A winter wonderland wishlist" },
    { key: "cameron", name: "Cameron", tagline: "A quiet bonsai Christmas" },
  ],
};
