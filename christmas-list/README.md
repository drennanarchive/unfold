# Christmas Wishlists

A small family Christmas app for **Clara** and **Cameron**.

- **Family** open one link, pick Clara's or Cameron's list, and claim gifts so nobody doubles up. No accounts.
  Others only ever see **Available / Claimed / Purchased ✓**, never who.
- **Clara and Cameron** sign in on a separate page (`manage.html`) to add, edit, reorder and remove
  their own gifts. They never see claim or purchase status, so surprises survive.

Live address (once merged to `main`): `https://drennanarchive.github.io/unfold/christmas-list/`
Owner page: `https://drennanarchive.github.io/unfold/christmas-list/manage.html`

## How it fits together

```
GitHub Pages (static files)                       Supabase (shared memory)
──────────────────────────                        ───────────────────────────
index.html  family page ── get_list / claim ───►  gifts        (owner-edited)
manage.html owner page  ── sign in, owner_* ───►  claims       (anonymous, separate)
                                                  list_owners  (login → clara/cameron)
```

No framework, no build step, no server. Browsers can't touch the tables directly. Everything goes
through a handful of database functions that enforce the rules (see `supabase/setup.sql`).

| File | What it's for |
|---|---|
| `index.html`, `app.js` | Family page: front door, both lists, claiming |
| `manage.html`, `manage.js`, `manage.css` | Owner page: sign in, edit your own list |
| `style.css` | Shared look. Each theme (home / clara / cameron) is a block of variables plus its art. Search for `THEME:` |
| `shared.js` | Small helpers both pages use (toast, confirm dialog, snow) |
| `config.js` | Supabase URL + publishable key, year, names. **Edit once during setup.** |
| `assets/` | Background art: `clara-winter-{desktop,mobile}.webp`, `cameron-bonsai-{desktop,mobile}.webp` (portrait screens get the mobile art, landscape screens the desktop art) |
| `supabase/setup.sql` | Creates/updates the database. Safe to re-run |
| `supabase/link-owners.sql` | Links Clara's and Cameron's logins to their lists |
| `supabase/sample-gifts.sql` | Optional sample gifts for trying it out |
| `test/` | Automated tests (database, pages, layout) that run in a browser. See `test/README.md` |

---

## Setup (about 10 minutes, once)

### 1. Create the Supabase project
1. <https://supabase.com> → sign in → **New project**. Any name; click **Generate a password**
   (you won't need it, but save it). Leave the defaults, including the **Data API enabled**. Click **Create**.
2. **SQL Editor → New query**: paste all of `supabase/setup.sql` → **Run**. You should see "Success".
   (Already ran the Round 1 script? That's fine: this upgrades it. The old claims table is kept as
   `claims_round1_old` and can be deleted later in the Table Editor.)
3. Optional: run `supabase/sample-gifts.sql` the same way to get a few example gifts.

### 2. Lock down sign-ups and create the two owner logins
1. **Authentication → Sign In / Providers** (on some dashboards: **Authentication → Settings**):
   turn **off** "Allow new users to sign up". Leave **Email** enabled.
2. **Authentication → Users → Add user → Create new user**: Clara's email + a strong password,
   tick **Auto Confirm User**. Repeat for Cameron.
3. **Authentication → URL Configuration**: set **Site URL** to the live address above, and add the
   `.../christmas-list/manage.html` address under **Redirect URLs** (this is where password-reset
   emails send people).

### 3. Link each login to its list
Open `supabase/link-owners.sql`, replace the two example emails with the real ones, then paste it into
**SQL Editor → New query → Run**. The result table should list both `clara` and `cameron`.
If one is missing, the email didn't match exactly.

### 4. Connect the site
Click **Connect** at the top of the Supabase project (or **Project Settings → Data API / API Keys**) and copy:
- the **Project URL** (`https://abcdefghijklmnop.supabase.co`)
- the **Publishable key** (`sb_publishable_...`; older projects call it the `anon` `public` key)

Paste both into `config.js`. ⚠️ Never use the **secret** / `service_role` key anywhere in this folder.
The publishable key is designed to be public. The database functions decide what it can do.

Commit and push; GitHub Pages republishes in about a minute. This repo already deploys the whole
repository with `.github/workflows/static.yml`, so nothing else needs configuring.

---

## Everyday use

**Clara / Cameron:** open `manage.html`, sign in once (the browser remembers you), then
**+ Add gift**, **Edit**, **Move** (up / down / to top / to bottom), **Remove** (with Undo).
- Removing hides the gift from family. If someone had already claimed it, only their browser sees a
  small "removed after you claimed it" note.
- Edits keep existing claims. If you change a claimed gift, its claimer sees "Updated since you claimed it".
- For a genuinely different gift, add a new one rather than renaming an old one, so claims stay meaningful.
- Forgot your password? Type your email on the sign-in page and press **Forgot password?**
  (Supabase's free plan sends only a few emails per hour.)

**Family:** claim → (later) **Mark purchased**. Mistakes can be undone: **Undo claim**, or
**Already purchased → Undo purchase**. A browser only recognises claims it made itself. Claim on a phone,
and a laptop will just show "Claimed".

### Fixing things by hand (Supabase → Table Editor)
- A stuck claim (claimer switched devices or cleared their browser): `claims` → delete that row.
- Fresh start next year: SQL Editor → `delete from public.claims;` (and remove old gifts on `manage.html`).
- Free projects **pause after about a week with no visits**. If the page says it can't reach the list,
  open the project in Supabase and click **Restore**.

---

## Security model, briefly

- Tables have Row Level Security on and **no** direct grants. Browsers only call functions.
- Family functions (`get_list`, `claim_gift`, `release_claim`, `mark_purchased`, `mark_not_purchased`)
  identify a browser by a random 64-character token kept in its storage. The database stores only a
  SHA-256 hash and never returns hashes, tokens or timestamps. One claim per gift is enforced by a
  primary key, so two simultaneous claims can't both win.
- Owner functions (`owner_*`) are callable only when signed in, look up the list from the login via
  `list_owners`, and never take "which list" from the browser. They never read the claims table.
- All functions are `security definer` with an empty `search_path`, and execute rights are granted
  explicitly (nothing to `PUBLIC`).

## Previewing locally

Open `index.html` (or `manage.html`) directly in a browser. Once `config.js` has the Supabase settings,
the local copy talks to the real database, which is handy for checking setup before sharing the link.
Without settings, both pages say they aren't connected yet.

## Tests

`bash christmas-list/test/run-headless.sh` runs about 400 checks (database security and ownership,
the claim/purchase lifecycle, both pages, and phone-to-desktop layout) against an in-browser Postgres
running the real `setup.sql`. Nothing touches the live project. Details in `test/README.md`.
