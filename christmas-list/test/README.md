# Tests

Automated checks for the wishlists. No installs, no Node, and nothing touches the live
Supabase project. Everything runs in a browser tab.

| File | What it covers |
|---|---|
| `harness.js` | Runs the real `supabase/setup.sql` on Postgres inside the browser (PGlite), set up like Supabase (roles, `auth.uid()`, default grants), and loads the real pages in iframes, each acting as a separate browser |
| `db.test.js` | Database: no direct table access, owner authorization (Clara ↔ Cameron, stray logins), add/validate/edit/reorder/remove/restore, claim → purchased → reversible, anonymous status, hashes never exposed, retries/idempotency, simultaneous claims, edits never touching claims, revision ("updated since you claimed"), removal notes, grants and function settings |
| `ui.test.js` | The pages: front door, navigation, the whole claim lifecycle across two browsers, auto-refresh, details expansion, offline / lost reply / first-load failure / not configured / blocked storage, owner sign-in, session persistence and expiry, add/edit/move/remove with Undo, unlinked accounts, owner page never calling claim functions |
| `layout.test.js` | Phone (390, 430), tablet (768) and desktop (1280): no sideways scrolling, 44px tap targets, the right art for portrait vs landscape, compact cards, centred column, Cameron's bonsai left clear on phones, Clara's scene left open, reduced motion |
| `run-headless.sh` | Runs everything in headless Chrome/Edge (normal + reduced motion) and exits non-zero on failure |

## Running

**In a browser:** open `test/index.html` through any local web server, e.g. VS Code's "Live Server",
or `python -m http.server` from the `christmas-list` folder, then visit `/test/`. Once the site is
published it also works at `https://drennanarchive.github.io/unfold/christmas-list/test/`.
(Opening the file directly with a double-click won't work: browsers block pages from reading
neighbouring files that way.) Add `?suite=db`, `?suite=pages` or `?suite=layout` to run one part.

**From a terminal:**

```bash
bash christmas-list/test/run-headless.sh          # everything, ~30 seconds
bash christmas-list/test/run-headless.sh db       # one suite
```

Needs Chrome or Edge and an internet connection (PGlite and fonts load from a CDN).

## What the in-browser database can't prove

PGlite is real Postgres, but it handles one request at a time. The tests do fire simultaneous claims
(and confirm exactly one wins), but the guarantee in production comes from the `claims` table's
primary key, which Postgres enforces under true concurrency. To see it on the real project, open the
same available gift on two phones, tap **Claim** on both at the same moment, and check that one gets
it and the other is told it was just claimed (then undo the claim).

The automated tests also stand in for two things: a small fake of the Supabase sign-in client
(the real one only runs against a real project), and a fake network for the family page. The real
sign-in and password-reset emails are worth trying once by hand after setup.

## Still worth a human look

The layout tests measure what's measurable. Colour, contrast over the photos, and whether it
*feels* right still need eyes. Check both lists on a real phone after any visual change.
