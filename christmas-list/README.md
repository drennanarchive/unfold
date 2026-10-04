# Christmas Wish Lists

A small shared gift list for Clara and Cameron. Family members open the link, pick a
gift, and claim it. Everyone else then sees that gift as **Claimed**. Nobody, not even
Clara or Cameron, can see *who* claimed it. Only the browser that claimed it shows
**Claimed by you**, and that browser can undo the claim.

Live address (once merged to `main`): `https://drennanarchive.github.io/unfold/christmas-list/`

## How it fits together

```
GitHub Pages ──► index.html + style.css + app.js     (the page)
                     │
                     ├── gifts.js    the gift lists (edit this file)
                     ├── config.js   where the shared database is
                     │
                     ▼
                 Supabase: one tiny "claims" table   (who-claimed-what memory)
```

| File | What it's for | Edit it? |
|---|---|---|
| `gifts.js` | The gifts on each list | **Yes**, this is the one you'll change |
| `config.js` | Supabase project URL + publishable key | Once, during setup |
| `supabase-setup.sql` | Creates the database table and rules | Paste into Supabase once |
| `index.html`, `style.css`, `app.js` | The page, its look, and its behaviour | Only to change the design/behaviour |

No build step, no frameworks, no server. Plain files that GitHub Pages serves as-is.

---

## One-time Supabase setup (about 5 minutes)

1. **Create an account.** Go to <https://supabase.com> → **Start your project** → sign in
   (GitHub sign-in is easiest).
2. **Create a project.** Click **New project**.
   - Name: anything, e.g. `christmas-list`
   - Database password: click **Generate a password**. You won't need it for this app,
     but save it somewhere in case.
   - Region: whichever is closest to your family.
   - Leave the other options at their defaults (the Data API must stay enabled).
   - Click **Create new project** and wait a minute or two for it to finish.
3. **Create the table and rules.** In the left sidebar click **SQL Editor** → **New query**.
   Open `supabase-setup.sql` from this folder, copy *everything*, paste it in, and click
   **Run**. You should see "Success. No rows returned."
4. **Copy two values.** Click the **Connect** button at the top of the project page
   (or go to **Project Settings → API Keys** and **Project Settings → Data API**) and copy:
   - the **Project URL**, which looks like `https://abcdefghijklmnop.supabase.co`
   - the **Publishable key**, which looks like `sb_publishable_...`
     (older projects call this the `anon` `public` key; that works too)

   ⚠️ Do **not** copy the *secret* / `service_role` key. It must never go in this folder.
5. **Paste them into `config.js`** (or hand them to Claude to do it):

   ```js
   supabaseUrl: "https://abcdefghijklmnop.supabase.co",
   supabasePublishableKey: "sb_publishable_...",
   ```

That's it. Reload the page: the "Demo mode" banner disappears and claims are shared.

### Good to know about Supabase's free plan
Free projects are **paused after about a week with no visits**. If the page says it
can't reach the list, sign in to Supabase and click **Restore project** on the project.
Claims are kept.

---

## Editing the gift lists

Open `gifts.js`. Each gift looks like this:

```js
{
  id: "clara-cozy-blanket",        // unique, lowercase-and-dashes, never change it later
  recipient: "Clara",              // "Clara" or "Cameron"
  name: "Cozy oversized blanket",
  description: "Soft knit throw, cream or sage.",   // optional
  price: "$35",                                      // optional, any text
  link: "https://www.example.com/blanket",           // optional
  image: "https://www.example.com/blanket.jpg",      // optional
  emoji: "🧶",                                       // optional, shown when there's no image
},
```

- **Adding** a gift: copy an entry, give it a new `id`.
- **Removing** a gift: delete its entry. (Any old claim on it is simply ignored.)
- **Don't rename an `id`** after people have started claiming: the claim is tied to the id.
- If you make a mistake (duplicate id, misspelled recipient, …) the page shows a red box
  explaining exactly what to fix.

Commit and push the change; GitHub Pages updates in about a minute.

---

## How the privacy and safety work

- **No accounts, no names.** The database stores only: gift id, a scrambled (SHA-256)
  version of the claiming browser's random token, and the time. Nothing identifies a person.
- **"Claimed by you"** works because each browser makes a random secret token the first
  time it opens the page and keeps it in that browser's storage. The page sends the token
  when checking claims, and the database answers "yes, that one's yours" without ever
  revealing anyone else's token.
- **Nobody can overwrite or undo someone else's claim.** The browser can't touch the table
  directly; it can only call three small database functions (`list_claims`, `claim_gift`,
  `unclaim_gift`) that enforce the rules. If two people click the same gift at the same
  instant, the database accepts exactly one and the other person is told it was just taken.
- **Nobody can wipe the list.** There is no delete-everything path from the browser, and a
  safety cap (500 claims) stops anyone flooding the table.
- **The key in `config.js` is meant to be public.** That's how Supabase's publishable key
  is designed; the rules above are enforced inside the database, not in the page.

### Limits (by design, to keep it simple)
- "Claimed by you" and **Undo** only work on the same browser the claim was made from.
  Claim on your phone, and your laptop will just show "Claimed".
- Clearing browser data, or using a private window, forgets that browser's claims
  (they stay claimed for everyone; that browser just can't undo them).
- Anyone who has the link can claim gifts. Share it with family only.

### Fixing a stuck claim
If someone claimed by mistake and can't undo it (different device, cleared browser):
Supabase → **Table Editor** → `claims` → find the row with that gift's `id` → delete it.
Starting fresh next year: **SQL Editor** → run `delete from public.claims;`

---

## Previewing locally

Double-click `index.html`, or open it in any browser. With `config.js` left blank the page
runs in **demo mode**: everything works, but claims are only saved in your own browser
(one Cameron gift starts out "claimed by someone else" so you can see all three states).

Once `config.js` is filled in, opening `index.html` locally talks to the real shared
database, which is handy for checking setup before you share the link.

The page checks for other people's claims every 15 seconds (changeable in `config.js`)
and whenever you switch back to the tab.
