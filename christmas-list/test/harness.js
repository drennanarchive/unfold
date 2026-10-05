/*
 * Test harness for the Christmas wishlists.
 *
 * - A real Postgres database runs in the browser (PGlite) with the actual
 *   supabase/setup.sql loaded, set up like Supabase: anon/authenticated roles,
 *   an auth schema with auth.uid(), and Supabase's default "grant everything"
 *   privileges (so the script's revokes are really tested).
 * - The real index.html / manage.html are loaded into iframes. Their network
 *   calls are routed to that database, so the pages and SQL are tested together.
 * - Each iframe gets its own storage, so it behaves like a separate browser.
 *
 * Nothing here talks to the real Supabase project.
 */
(function () {
  "use strict";

  const APP = new URL("../", location.href).href;
  const PGLITE = "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.2.17/dist/index.js";

  const USERS = {
    clara:   { id: "11111111-1111-1111-1111-111111111111", email: "clara@example.com",   password: "clara-pw" },
    cameron: { id: "22222222-2222-2222-2222-222222222222", email: "cameron@example.com", password: "cameron-pw" },
    stray:   { id: "33333333-3333-3333-3333-333333333333", email: "stray@example.com",   password: "stray-pw" },
  };

  const CONFIG = {
    supabaseUrl: "https://test-project.supabase.co",
    supabasePublishableKey: "sb_publishable_TEST",
    year: 2026,
    refreshSeconds: 5,
    people: [
      { key: "clara", name: "Clara", tagline: "A winter wonderland wishlist" },
      { key: "cameron", name: "Cameron", tagline: "A quiet bonsai Christmas" },
    ],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // XHR works both over http(s) and over file:// (with Chrome's
  // --allow-file-access-from-files, which run-headless.sh passes).
  function readFile(path) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("GET", new URL(path, APP).href);
      x.onload = () => (x.status === 0 || x.status === 200 ? resolve(x.responseText) : reject(new Error(path + ": " + x.status)));
      x.onerror = () => reject(new Error("Could not read " + path));
      x.send();
    });
  }

  // ---------------------------------------------------------------------------
  // Database
  // ---------------------------------------------------------------------------

  async function makeDb({ round1First = false, samples = true } = {}) {
    const { PGlite } = await import(PGLITE);
    const db = new PGlite();
    await db.exec(`
      create role anon nologin; create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;
    `);
    for (const u of Object.values(USERS)) {
      await db.query("insert into auth.users (id, email) values ($1, $2)", [u.id, u.email]);
    }
    if (round1First) {
      // A database as the Round 1 script left it.
      await db.exec(`
        create table public.claims (gift_id text primary key, token_hash text not null, claimed_at timestamptz default now());
        insert into public.claims values ('clara-cozy-blanket', 'abc', now());
        create function public.list_claims(p_token text) returns table (gift_id text, mine boolean) language sql as $$ select gift_id, false from public.claims $$;
        create function public.claim_gift(p_gift_id text, p_token text) returns text language sql as $$ select 'x' $$;
        create function public.unclaim_gift(p_gift_id text, p_token text) returns boolean language sql as $$ select true $$;
      `);
    }
    const setup = await readFile("supabase/setup.sql");
    await db.exec(setup);
    await db.exec(await readFile("supabase/link-owners.sql")); // uses the example emails above
    if (samples) await db.exec(await readFile("supabase/sample-gifts.sql"));
    return { db, setup };
  }

  // Runs SQL as the browser would: anon (no login) or as a signed-in user.
  function asRole(db, userId, sql, params) {
    return db.transaction(async (tx) => {
      await tx.exec(userId ? "set local role authenticated" : "set local role anon");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""]);
      return tx.query(sql, params);
    });
  }

  // A stand-in for Supabase's /rpc endpoint backed by the real database.
  const TABLE_FUNCS = new Set(["get_list", "owner_list"]);
  async function rpc(db, userId, name, args) {
    const keys = Object.keys(args || {});
    const sql = `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
    try {
      const r = await asRole(db, userId, sql, keys.map((k) => args[k]));
      if (TABLE_FUNCS.has(name)) return { data: r.rows, error: null };
      const row = r.rows[0];
      return { data: row ? Object.values(row)[0] : null, error: null };
    } catch (e) {
      return { data: null, error: { code: e.code || "XX000", message: e.message } };
    }
  }

  // ---------------------------------------------------------------------------
  // Pages in iframes, each acting as its own browser
  // ---------------------------------------------------------------------------

  /*
   * env = { db, server: { down, loseNext, calls }, stores: {} }
   * open(env, "index.html", "browser-A", "clara", { config, brokenStorage, width, height })
   */
  function makeEnv(db) {
    const env = { db, server: { down: false, loseNext: null, calls: [] }, stores: {} };

    // Family page: fetch() -> database.
    env.fetch = async (url, opts) => {
      const name = url.split("/rpc/")[1];
      const args = JSON.parse((opts && opts.body) || "{}");
      env.server.calls.push({ url, name, headers: opts.headers, args });
      if (env.server.down) throw new TypeError("Failed to fetch");
      const r = await rpc(db, null, name, args);
      // Simulate "the server did it, but the reply never arrived".
      if (env.server.loseNext === name) { env.server.loseNext = null; throw new TypeError("Failed to fetch"); }
      if (r.error) return { ok: false, status: 400, json: async () => r.error };
      return { ok: true, status: 200, json: async () => r.data };
    };

    // Owner page: a small stand-in for the supabase-js client.
    env.supabase = (label) => {
      const store = env.stores[label];
      const listeners = [];
      const KEY = "sb-session";
      const read = () => (store[KEY] ? JSON.parse(store[KEY]) : null);
      return {
        auth: {
          async getSession() { return { data: { session: read() }, error: null }; },
          async signInWithPassword({ email, password }) {
            if (env.server.down) return { data: {}, error: { message: "Failed to fetch" } };
            const u = Object.values(USERS).find((x) => x.email === email && x.password === password);
            if (!u) return { data: {}, error: { message: "Invalid login credentials" } };
            const session = { access_token: "t", user: { id: u.id, email } };
            store[KEY] = JSON.stringify(session);
            return { data: { session }, error: null };
          },
          async signOut() { delete store[KEY]; listeners.forEach((f) => f("SIGNED_OUT", null)); return { error: null }; },
          onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
          async resetPasswordForEmail() { return { error: null }; },
          async updateUser() { return { error: null }; },
        },
        async rpc(name, args) {
          env.server.calls.push({ name, args, owner: true });
          if (env.server.down) return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
          const s = read();
          if (s && s.expired) return { data: null, error: { code: "PGRST301", message: "JWT expired" } };
          return rpc(db, s ? s.user.id : null, name, args);
        },
      };
    };
    return env;
  }

  async function open(env, page, label, hash, opts = {}) {
    const html = await readFile(page);
    env.stores[label] = env.stores[label] || {};
    const id = "env" + Math.random().toString(36).slice(2);
    window[id] = env;
    const frame = document.createElement("iframe");
    frame.className = "test-frame";
    frame.style.width = (opts.width || 390) + "px";
    frame.style.height = (opts.height || 844) + "px";
    document.getElementById("frames").append(frame);
    const storage = opts.brokenStorage
      ? `{ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }`
      : `{ getItem: (k) => (k in S ? S[k] : null), setItem: (k, v) => { S[k] = String(v); }, removeItem: (k) => { delete S[k]; } }`;
    const inject = `<base href="${APP}"><script>
      var S = parent.${id}.stores[${JSON.stringify(label)}];
      Object.defineProperty(window, "localStorage", { value: ${storage} });
      window.fetch = (u, o) => parent.${id}.fetch(u, o);
      window.supabase = { createClient: () => parent.${id}.supabase(${JSON.stringify(label)}) };
      ${hash ? `location.hash = ${JSON.stringify("#" + hash)};` : ""}
    <\/script>`;
    const doc = html
      .replace("<head>", "<head>" + inject)
      .replace(/<script src="(\.\.\/)?config\.js"><\/script>/, `<script>window.CHRISTMAS_LIST_CONFIG = ${JSON.stringify(opts.config || CONFIG)};<\/script>`)
      .replace(/<script src="https:\/\/cdn\.jsdelivr[^>]*><\/script>/, "");
    frame.contentWindow.document.open();
    frame.contentWindow.document.write(doc);
    frame.contentWindow.document.close();
    await sleep(opts.wait || 800);
    const w = frame.contentWindow;
    return { w, d: w.document, frame, label, page, hash, opts, env };
  }

  async function reopen(dev, hash) {
    dev.frame.remove();
    return open(dev.env, dev.page, dev.label, hash === undefined ? dev.hash : hash, dev.opts);
  }

  // Family-page helpers
  const card = (dev, name) => [...dev.d.querySelectorAll("#gifts > li")].find((li) => li.querySelector(".gift-name").textContent === name);
  const chip = (dev, name) => { const c = card(dev, name); return c && c.querySelector(".chip") ? c.querySelector(".chip").textContent : undefined; };
  const btn = (dev, name, role) => { const c = card(dev, name); return c ? c.querySelector(`[data-role="${role}"]`) : null; };
  const toast = (dev) => dev.d.getElementById("toast").textContent;
  async function refocus(dev) { dev.w.dispatchEvent(new Event("focus")); await sleep(300); }
  async function confirmYes(dev) { dev.d.getElementById("confirm-yes").click(); await sleep(400); }

  window.T = {
    APP, USERS, CONFIG, sleep, readFile, makeDb, asRole, rpc, makeEnv, open, reopen,
    card, chip, btn, toast, refocus, confirmYes,
  };
})();
