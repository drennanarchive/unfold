/*
 * Family page (index.html): the front door plus Clara's and Cameron's lists.
 *
 *   #          front door
 *   #clara     Clara's list
 *   #cameron   Cameron's list
 *
 * Each browser gets a random token (kept in localStorage). The database stores
 * only a hash of it, which is how this browser recognises "You're getting this" and
 * is allowed to undo its own claims. Nobody's identity is ever stored or shown.
 */
(function () {
  "use strict";

  const { config, el, $ } = XL;
  const REFRESH_MS = Math.max(5, Number(config.refreshSeconds) || 15) * 1000;
  const TOKEN_KEY = "christmas-list-claim-token";

  // ---------------------------------------------------------------------------
  // This browser's token
  // ---------------------------------------------------------------------------

  let tokenSaved = true;
  const token = (function () {
    let value = null;
    try { value = window.localStorage.getItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
    if (value && /^[0-9a-f]{64}$/.test(value)) return value;
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    value = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
      tokenSaved = window.localStorage.getItem(TOKEN_KEY) === value;
    } catch (e) {
      tokenSaved = false;
    }
    return value;
  })();

  // ---------------------------------------------------------------------------
  // Database calls (the functions in supabase/setup.sql)
  // ---------------------------------------------------------------------------

  async function api(name, args) {
    const url = config.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/" + name;
    const key = config.supabasePublishableKey;
    const headers = { "Content-Type": "application/json", apikey: key };
    // Older projects use a JWT "anon" key, which also goes in Authorization.
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;

    let response;
    try {
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(args), cache: "no-store" });
    } catch (e) {
      const error = new Error("Network error");
      error.network = true;
      throw error;
    }
    if (!response.ok) {
      let body = {};
      try { body = await response.json(); } catch (e) { /* not JSON */ }
      const error = new Error(body.message || "Request failed (" + response.status + ")");
      error.status = response.status;
      error.code = body.code;
      // Supabase paused / unreachable gateways look like 5xx: treat as "can't reach".
      if (response.status >= 500 || response.status === 0) error.network = true;
      throw error;
    }
    return response.json();
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const state = {
    gifts: [],              // rows from get_list (both people)
    loaded: false,          // got the list at least once
    offline: false,         // last refresh failed
    view: null,             // null (front door) or "clara" / "cameron"
    pending: new Set(),     // gift ids with an action in flight
    open: new Set(),        // gift ids with details expanded
    refreshing: false,
    refreshAgain: false,
    version: 0,             // bumped by every action, so stale refreshes are ignored
    lastSync: null,
    purchasedDefaultSet: false, // "Already Taken" starts open; on phones it can then be closed
    sort: "default",        // this viewer's sort for the main list; never saved anywhere
  };
  const cards = new Map();  // gift id -> { li, sig }  (main list)
  const rows = new Map();   // gift id -> { li, sig }  ("Already Taken")
  const brokenImages = new Set(); // image addresses that failed to load in this visit
  const FIRST_SCREEN_CARDS = 6;   // about what fits on a large screen before scrolling
  let firstScreenIds = new Set(); // gift ids at the top of the list right now

  const giftById = (id) => state.gifts.find((g) => g.id === id);

  // Family see two states. The database still keeps "claimed" and "purchased"
  // apart (older purchases stay as they were); both simply show as Taken here.
  const isTaken = (g) => g.status !== "available";
  // Where the two columns sit side by side. Keep in step with style.css.
  const WIDE = "(min-width: 1100px) and (min-aspect-ratio: 1/1)";
  const isWide = () => window.matchMedia(WIDE).matches;

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  function route() {
    const key = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    const person = XL.person(key);
    state.view = person ? person.key : null;

    $("#door").hidden = Boolean(person);
    $("#list").hidden = !person;

    if (!person) {
      XL.setTheme("home");
      document.title = "Our Christmas Wishlists";
      updateJump();
      return;
    }

    XL.setTheme(person.key);
    document.title = person.name + "'s Wishlist · Christmas " + config.year;
    $("#list-kicker").textContent = "Christmas " + config.year;
    $("#list-title").textContent = person.name + "'s Wishlist";
    $("#list-tagline").textContent = person.tagline || "";
    const other = XL.people.find((p) => p.key !== person.key);
    const otherLink = $("#nav-other");
    otherLink.hidden = !other;
    if (other) {
      otherLink.href = "#" + other.key;
      otherLink.textContent = other.name + "'s list →";
    }

    cards.clear();
    rows.clear();
    $("#gifts").textContent = "";
    $("#purchased-list").textContent = "";
    state.purchasedDefaultSet = false;
    state.sort = "default";
    const sortSelect = $("#gift-sort");
    if (sortSelect) sortSelect.value = "default";
    window.scrollTo(0, 0);
    renderList();
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const ICONS = {
    available: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    taken: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function statusLabel(g) {
    if (!isTaken(g)) return "Available";
    return g.mine ? "You're getting this 🎁" : "Taken";
  }

  function chip(g, pending) {
    const node = el("span", "chip");
    const shown = isTaken(g) ? "taken" : "available";
    node.dataset.status = pending ? "loading" : shown;
    node.innerHTML = pending ? "" : ICONS[shown];
    node.append(el("span", null, pending ? "Saving…" : statusLabel(g)));
    return node;
  }

  function button(label, className, role, onClick, disabled) {
    const b = el("button", className, label);
    b.type = "button";
    b.dataset.role = role;
    b.disabled = Boolean(disabled);
    b.addEventListener("click", onClick);
    return b;
  }

  const hasImage = (g) => XL.isHttpUrl(g.image_url) && !brokenImages.has(g.image_url);

  function hasMore(g) {
    const longDetails = g.details && (g.details.length > 90 || g.details.includes("\n"));
    return Boolean(longDetails || XL.isHttpUrl(g.link) || hasImage(g));
  }

  // The gift's picture. If it can't load, it's dropped everywhere for this visit,
  // so no broken icon or empty frame is left behind. The width and height hold
  // its space while it loads (style.css sets the final size).
  function giftImage(g, className, size, firstScreen) {
    const img = el("img", className);
    img.alt = "";
    if (size) img.width = img.height = size;
    // Pictures the viewer is about to see start right away and ahead of the queue.
    img.loading = firstScreen ? "eager" : "lazy";
    if (firstScreen) img.fetchPriority = "high";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    const address = size ? XL.thumbnailUrl(g.image_url) : g.image_url;
    let triedOriginal = address === g.image_url;
    img.addEventListener("error", () => {
      if (!triedOriginal) {
        triedOriginal = true;
        img.src = g.image_url; // the small version failed, so try the original
        return;
      }
      brokenImages.add(g.image_url);
      renderList();
    });
    if (XL.reducedMotion() && /\.gif$/i.test(new URL(g.image_url).pathname)) freezeWhenLoaded(img);
    img.src = address;
    return img;
  }

  // Browsers keep GIFs moving whatever the viewer's motion setting, so for those
  // who asked for less motion the picture stays invisible until it has loaded,
  // then a canvas showing one still frame takes its place. Drawing a picture from
  // another site is allowed; only reading its pixels back isn't, and that's not needed.
  function freezeWhenLoaded(img) {
    img.style.visibility = "hidden";
    img.addEventListener("load", () => {
      const canvas = el("canvas", img.className);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.setAttribute("aria-hidden", "true");
      try {
        canvas.getContext("2d").drawImage(img, 0, 0);
        img.replaceWith(canvas);
      } catch (e) {
        img.style.visibility = ""; // better a moving picture than a blank frame
      }
    }, { once: true });
  }

  // A gift's name. It can take keyboard focus from the page (not from Tab), so
  // after taking or releasing a gift, focus lands on the gift itself rather than
  // on a button that would undo what was just done.
  function giftName(tag, className, g) {
    const node = el(tag, className, g.name);
    node.tabIndex = -1;
    node.dataset.role = "name";
    return node;
  }

  // A gift this browser took that the owner has since removed. Only this browser
  // ever sees it, in "Already Taken", until it's dismissed.
  function buildRemoved(g) {
    const pending = state.pending.has(g.id);
    const li = el("li", "bought is-removed");
    li.dataset.status = g.status;
    li.append(giftName("span", "bought-name", g));
    li.append(el("p", "removed-msg", "This gift was removed from the list. If you've bought it, check with the recipient."));
    const dismiss = button("Dismiss", "btn-text bought-action", "dismiss", () => dismissRemoved(g), pending);
    dismiss.setAttribute("aria-label", "Dismiss note about " + g.name);
    li.append(dismiss);
    return li;
  }

  function buildGift(g) {
    const pending = state.pending.has(g.id);
    const open = state.open.has(g.id);
    const li = el("li", "gift");
    li.dataset.status = g.status;
    li.classList.toggle("is-mine", g.mine);
    li.classList.toggle("is-open", open);
    li.classList.toggle("has-thumb", hasImage(g));

    const main = el("div", "gift-main");
    if (hasImage(g)) main.append(giftImage(g, "gift-thumb", 52, firstScreenIds.has(g.id)));
    const text = el("div", "gift-text");

    const top = el("div", "gift-top");
    top.append(giftName("h3", "gift-name", g));
    if (g.price) {
      const price = el("span", "gift-price");
      price.append(el("span", "sr-only", "Approximate price: "), document.createTextNode(g.price));
      top.append(price);
    }
    text.append(top);

    if (g.details) text.append(el("p", "gift-details", g.details));
    main.append(text);
    li.append(main);

    const more = hasMore(g);
    const extraId = "extra-" + g.id;
    if (more) {
      const extra = el("div", "gift-extra");
      extra.id = extraId;
      extra.hidden = !open;
      if (hasImage(g)) extra.append(giftImage(g, "gift-image"));
      if (XL.isHttpUrl(g.link)) {
        const a = el("a", "gift-link", "View item ↗");
        a.href = g.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.setAttribute("aria-label", "View " + g.name + " (opens in a new tab)");
        extra.append(a);
      }
      li.append(extra);
    }

    const foot = el("div", "gift-foot");
    foot.append(chip(g, pending), el("span", "spacer"));
    if (more) {
      const toggle = button("Details", "more", "more", () => toggleOpen(g));
      toggle.insertAdjacentHTML("beforeend", ICONS.chevron);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-controls", extraId);
      toggle.setAttribute("aria-label", (open ? "Hide details for " : "Show details for ") + g.name);
      foot.append(toggle);
    }
    const claimButton = button("I'll get this!", "btn btn-primary", "claim", () => claim(g), pending);
    claimButton.setAttribute("aria-label", "I'll get " + g.name);
    foot.append(claimButton);
    li.append(foot);
    return li;
  }

  // A compact row in "Already Taken". Everyone sees "Taken". Only the browser that
  // took it sees "You're getting this", with Details and Make Available Again.
  function buildTaken(g) {
    if (g.removed) return buildRemoved(g);
    const pending = state.pending.has(g.id);
    const open = g.mine && state.open.has(g.id);
    const li = el("li", "bought");
    li.dataset.status = "taken";
    li.classList.toggle("is-mine", g.mine);
    li.classList.toggle("is-open", open);
    li.classList.toggle("has-thumb", hasImage(g));
    if (hasImage(g)) li.append(giftImage(g, "bought-thumb", 34));

    const top = el("div", "bought-top");
    top.insertAdjacentHTML("beforeend", ICONS.taken);
    top.append(giftName("span", "bought-name", g));
    if (g.price) {
      const price = el("span", "bought-price");
      price.append(el("span", "sr-only", "Approximate price: "), document.createTextNode(g.price));
      top.append(price);
    }
    li.append(top);

    const meta = el("p", "bought-meta");
    meta.append(el("span", "bought-status", pending ? "Saving…" : statusLabel(g)));
    if (XL.isHttpUrl(g.link)) {
      const a = el("a", "bought-link", "View item ↗");
      a.href = g.link;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", "View " + g.name + " (opens in a new tab)");
      meta.append(a);
    }
    li.append(meta);
    if (!g.mine) return li;

    if (g.updated_since_claim) li.append(el("p", "gift-note", "✎ Updated since you chose it"));
    const extraId = "taken-extra-" + g.id;
    const more = Boolean(g.details || hasImage(g));
    if (more) {
      const extra = el("div", "bought-extra");
      extra.id = extraId;
      extra.hidden = !open;
      if (g.details) extra.append(el("p", "gift-details", g.details));
      if (hasImage(g)) extra.append(giftImage(g, "gift-image"));
      li.append(extra);
    }
    const actions = el("div", "bought-actions");
    if (more) {
      const toggle = button("Details", "more", "more", () => toggleOpen(g));
      toggle.insertAdjacentHTML("beforeend", ICONS.chevron);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-controls", extraId);
      toggle.setAttribute("aria-label", (open ? "Hide details for " : "Show details for ") + g.name);
      actions.append(toggle);
    }
    const release = button("Make Available Again", "btn-text bought-action", "release", () => makeAvailable(g), pending);
    release.setAttribute("aria-label", "Make " + g.name + " available again");
    actions.append(release);
    li.append(actions);
    return li;
  }

  function signature(g) {
    return JSON.stringify([g, state.pending.has(g.id), state.open.has(g.id), hasImage(g)]);
  }

  // Puts the given items into a list element in order, rebuilding only the ones
  // whose data changed and keeping keyboard focus where it was.
  function syncList(listEl, items, cache, build) {
    const wanted = [];
    items.forEach((g) => {
      const sig = signature(g);
      let entry = cache.get(g.id);
      if (!entry || entry.sig !== sig) {
        const focusedRole = entry && entry.li.contains(document.activeElement) ? document.activeElement.dataset.role : null;
        const li = build(g);
        li.dataset.id = g.id;
        if (entry) entry.li.replaceWith(li);
        entry = { li, sig };
        cache.set(g.id, entry);
        if (focusedRole) {
          const again = li.querySelector('[data-role="' + focusedRole + '"]') || li.querySelector("button");
          if (again) again.focus();
        }
      }
      wanted.push(entry.li);
    });
    for (const [id, entry] of cache) {
      if (!items.some((g) => g.id === id)) { entry.li.remove(); cache.delete(id); }
    }
    const current = Array.from(listEl.children);
    if (current.length !== wanted.length || current.some((node, i) => node !== wanted[i])) {
      wanted.forEach((li) => listEl.append(li));
    }
  }

  // Available gifts fill the main list. Everything taken, plus notes about gifts
  // this browser took that were then removed, goes to "Already Taken" (beside the
  // list on wide screens, below it on phones), always in the owner's order.
  const inTakenArea = (g) => g.removed || isTaken(g);

  // Viewer-only sorting of the main list. It reorders a copy of what's already
  // loaded, so "default" is always the owner's order from get_list. Array sort
  // is stable, so ties keep the owner's order too. No price sorts last either way.
  const nameOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  const byPrice = (direction) => (a, b) => {
    const pa = XL.priceValue(a.price);
    const pb = XL.priceValue(b.price);
    if (pa === null || pb === null) return (pa === null) - (pb === null);
    return (pa - pb) * direction;
  };
  const SORTS = {
    "price-asc": byPrice(1),
    "price-desc": byPrice(-1),
    name: (a, b) => nameOrder.compare(a.name, b.name),
  };
  const sortedForViewer = (items) => (SORTS[state.sort] ? items.slice().sort(SORTS[state.sort]) : items);

  function renderTaken(items) {
    const section = $("#purchased");
    const taken = items.filter(inTakenArea);
    const count = taken.filter((g) => !g.removed).length;
    section.hidden = !state.loaded && taken.length === 0; // nothing to say until the list arrives
    section.classList.toggle("is-empty", taken.length === 0);
    $("#purchased-count").textContent = "(" + count + ")";
    const empty = $("#taken-empty");
    if (empty) empty.hidden = taken.length > 0;
    const details = $("#purchased-details");
    if (isWide()) {
      details.open = true; // always open beside the list
    } else if (!state.purchasedDefaultSet && taken.length) {
      details.open = true; // open to start with; on phones its heading can still close it
      state.purchasedDefaultSet = true;
    }
    syncList($("#purchased-list"), taken, rows, buildTaken);
  }

  function renderList() {
    if (!state.view) return;
    const list = $("#gifts");
    const items = state.gifts.filter((g) => g.recipient === state.view);
    const person = XL.person(state.view);

    // Notices
    const notice = $("#notice");
    notice.textContent = "";
    notice.className = "notice";
    notice.hidden = true;
    if (!XL.configured) {
      showNotice("This wishlist isn't connected yet. (For the list owner: add the Supabase settings to config.js.)", true);
    } else if (!state.loaded && state.offline) {
      showNotice("Can't reach the wishlist right now. It will keep trying automatically.", true, true);
    } else if (state.loaded && items.length === 0) {
      showNotice("Nothing here yet. " + person.name + " is still thinking. Check back soon!");
    } else if (state.loaded && !tokenSaved) {
      showNotice("This browser isn't saving site data (private window?). You can still choose gifts, but it will forget which ones are yours once it's closed.");
    }

    const active = sortedForViewer(items.filter((g) => !inTakenArea(g)));
    const sortControl = $("#sort-control");
    if (sortControl) sortControl.hidden = active.length < 2;
    firstScreenIds = new Set(active.slice(0, FIRST_SCREEN_CARDS).map((g) => g.id));
    syncList(list, active, cards, buildGift);
    renderTaken(items);

    renderSummary(items);
    renderSync();
    updateJump();
  }

  // ---------------------------------------------------------------------------
  // Phones: a small floating shortcut between Available and Already Taken
  // ---------------------------------------------------------------------------

  // Whether each section is in the middle part of the screen. An IntersectionObserver
  // keeps these up to date, so nothing runs while scrolling.
  const inView = { available: false, taken: false };
  const jump = $("#section-jump");

  // "Already Taken (N) ↓" while looking at Available, "↑ Available Gifts" while
  // looking at Already Taken; nothing when both (or neither) are in view, when the
  // other section is empty, on wide screens, or on the front door.
  function updateJump() {
    if (!jump) return;
    const items = state.view ? state.gifts.filter((g) => g.recipient === state.view) : [];
    const takenCount = items.filter((g) => !g.removed && isTaken(g)).length;
    const availableCount = items.filter((g) => !inTakenArea(g)).length;
    let mode = null;
    if (state.view && state.loaded && !isWide()) {
      if (inView.available && !inView.taken && takenCount) mode = "down";
      else if (inView.taken && !inView.available && availableCount) mode = "up";
    }
    jump.hidden = !mode;
    if (!mode) return;
    const label = mode === "down" ? "Already Taken (" + takenCount + ")" : "Available Gifts";
    if (jump.dataset.mode === mode && jump.dataset.label === label) return;
    jump.dataset.mode = mode;
    jump.dataset.label = label;
    jump.textContent = "";
    if (mode === "up") jump.append(el("span", "jump-arrow", "↑"));
    jump.append(el("span", null, label));
    if (mode === "down") jump.append(el("span", "jump-arrow", "↓"));
    jump.querySelectorAll(".jump-arrow").forEach((a) => a.setAttribute("aria-hidden", "true"));
    jump.setAttribute("aria-label", mode === "down" ? "Go to Already Taken, " + takenCount + (takenCount === 1 ? " gift" : " gifts") : "Go back to Available Gifts");
  }

  function jumpToSection() {
    const down = jump.dataset.mode === "down";
    const target = down ? $("#purchased") : $(".list-head");
    if (!target) return;
    target.scrollIntoView({ block: "start", behavior: XL.reducedMotion() ? "auto" : "smooth" });
    // Keyboard and screen-reader users continue from the section they asked for.
    const landing = down ? $("#purchased-details summary") : $("#gifts-heading");
    if (landing) landing.focus({ preventScroll: true });
  }

  function showNotice(text, isError, withRetry) {
    const notice = $("#notice");
    notice.hidden = false;
    notice.classList.toggle("is-error", Boolean(isError));
    notice.append(el("div", null, text));
    if (withRetry) {
      const retry = button("Try again", "btn btn-quiet", "retry", () => refresh());
      notice.append(retry);
    }
  }

  function renderSummary(items) {
    const node = $("#summary");
    node.textContent = "";
    if (!state.loaded) return;
    const visible = items.filter((g) => !g.removed);
    const taken = visible.filter(isTaken).length;
    [["available", visible.length - taken], ["taken", taken]].forEach(([word, n], i) => {
      if (i) node.append(document.createTextNode(" · "));
      const span = el("span");
      span.append(el("i", "dot dot-" + word), document.createTextNode(n + " " + word));
      node.append(span);
    });
  }

  function renderSync() {
    const node = $("#sync");
    node.textContent = "";
    node.classList.toggle("is-offline", state.offline && state.loaded);
    if (!state.loaded) return;
    const text = state.offline
      ? "Can't reach the list. Showing what we last saw, and retrying…"
      : "Up to date · " + state.lastSync.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    node.append(el("span", null, text));
  }

  // ---------------------------------------------------------------------------
  // Loading the list
  // ---------------------------------------------------------------------------

  // Only one refresh runs at a time; asking again while one is running queues
  // one more pass. If an action finished mid-refresh, that answer may be stale,
  // so it's discarded and fetched again. Returns a promise for when it's done.
  function refresh() {
    if (!XL.configured) { renderList(); return Promise.resolve(); }
    if (state.refreshing) { state.refreshAgain = true; return state.refreshPromise; }
    state.refreshing = true;
    state.refreshPromise = (async () => {
      do {
        state.refreshAgain = false;
        const versionAtStart = state.version;
        try {
          const rows = await api("get_list", { p_token: token });
          if (state.version !== versionAtStart) {
            state.refreshAgain = true;
          } else {
            state.gifts = Array.isArray(rows) ? rows : [];
            state.loaded = true;
          }
          state.offline = false;
          state.lastSync = new Date();
        } catch (error) {
          console.error(error);
          state.offline = true;
        }
        renderList();
      } while (state.refreshAgain);
      state.refreshing = false;
    })();
    return state.refreshPromise;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  function toggleOpen(g) {
    if (state.open.has(g.id)) state.open.delete(g.id);
    else state.open.add(g.id);
    renderList();
  }

  function setLocal(id, changes) {
    const g = giftById(id);
    if (g) Object.assign(g, changes);
  }

  /*
   * Runs one database action for a gift.
   *   call()        the request
   *   onResult(r)   handle the answer
   *   verify(g)     if the answer got lost (network), does the fresh list show it worked?
   *                 (g is undefined if the gift is no longer on the list)
   *   success       message to show if verify() says it did
   */
  async function act(g, { call, onResult, verify, success }) {
    if (state.pending.has(g.id)) return;
    // If the action came from this gift's own controls, keep keyboard focus with
    // the gift afterwards, even if it moved between the list and "Already Taken":
    // on its name, so the next Tab reaches its controls. The page doesn't jump to
    // it, and the message (a polite live region) says where it went.
    const active = document.activeElement && document.activeElement.closest && document.activeElement.closest("[data-id]");
    const keepFocus = Boolean(active && active.dataset.id === g.id);
    state.pending.add(g.id);
    renderList();
    let lost = false;
    try {
      const result = await call();
      state.version++;
      onResult(result);
    } catch (error) {
      state.version++;
      console.error(error);
      if (error.network) lost = true;
      else XL.toast("Something went wrong, so nothing was changed. Please try again.");
    } finally {
      state.pending.delete(g.id);
      renderList();
      if (keepFocus) {
        const li = document.querySelector('[data-id="' + g.id + '"]');
        // A dismissed note is gone, so focus goes to the "Already Taken" heading instead.
        const target = li ? li.querySelector('[data-role="name"]') : $("#purchased-details summary");
        if (target) target.focus({ preventScroll: true });
      }
    }
    await refresh();
    if (lost) {
      const fresh = giftById(g.id);
      if (state.offline) XL.toast("Can't reach the list right now. Nothing has changed yet. Please try again.");
      else if (verify(fresh)) XL.toast(success);
      else XL.toast("Couldn't reach the list, so nothing changed. Please try again.");
    }
  }

  const TAKEN_MESSAGE = "🎁 You're getting this! It's in Already Taken.";

  // On a long list the gift's new row can be screens away. Then the message
  // offers "Show me" (and stays a little longer); the page itself never moves
  // unless the shopper asks it to.
  function announceTaken(id) {
    const row = $("#purchased-list").querySelector('[data-id="' + id + '"]');
    const box = row && row.getBoundingClientRect();
    const offScreen = Boolean(box && (box.top >= window.innerHeight || box.bottom <= 0));
    if (!offScreen) {
      XL.toast(TAKEN_MESSAGE);
      return;
    }
    XL.toast(TAKEN_MESSAGE, { label: "Show me", ariaLabel: "Show me the gift in Already Taken", onClick: () => showTaken(id) });
  }

  function showTaken(id) {
    const row = $("#purchased-list").querySelector('[data-id="' + id + '"]');
    if (!row) return;
    $("#purchased-details").open = true;
    row.scrollIntoView({ block: "center", behavior: XL.reducedMotion() ? "auto" : "smooth" });
    const name = row.querySelector('[data-role="name"]');
    if (name) name.focus({ preventScroll: true });
  }

  async function claim(g) {
    const ok = await XL.confirm({
      title: "Get this gift? 🎁",
      body: "Others will see “Taken.” You can undo it in this browser.",
      confirmLabel: "Yes, I'll get it!",
      cancelLabel: "Not now",
    });
    if (!ok) return;
    act(g, {
      call: () => api("claim_gift", { p_gift_id: g.id, p_token: token }),
      onResult: (r) => {
        if (r === "claimed" || r === "already_yours") {
          setLocal(g.id, { status: "claimed", mine: true });
          $("#purchased-details").open = true; // so it's easy to find on a phone
          state.purchasedDefaultSet = true;    // ...and the phone default doesn't close it again
          setTimeout(() => announceTaken(g.id), 0); // once the gift has moved on screen
        } else if (r === "taken") {
          setLocal(g.id, { status: "claimed", mine: false });
          XL.toast("Someone else just took this one.");
        } else {
          XL.toast("That gift was just removed from the list.");
        }
      },
      verify: (fresh) => Boolean(fresh && fresh.mine),
      success: TAKEN_MESSAGE,
    });
  }

  /*
   * Gives a gift this browser took back to everyone. The database won't release
   * a gift marked purchased (older claims may be), so that case is first set
   * back to claimed. Starting with release_claim means the screen's idea of the
   * gift's state never decides which call is made. Between the calls the claim
   * is still this browser's, so nobody else can take it; if a later call fails,
   * the gift is simply still taken by you and trying again is safe.
   */
  async function releaseGift(g) {
    const args = { p_gift_id: g.id, p_token: token };
    const first = await api("release_claim", args);
    if (first !== "purchased") return first;
    await api("mark_not_purchased", args);
    return api("release_claim", args);
  }

  async function makeAvailable(g) {
    const ok = await XL.confirm({
      title: "Make this gift available again?",
      body: "Someone else can then choose it.",
      confirmLabel: "Make Available",
      cancelLabel: "Keep It",
    });
    if (!ok) return;
    act(g, {
      call: () => releaseGift(g),
      onResult: (r) => {
        if (r === "released") {
          state.open.delete(g.id);
          setLocal(g.id, { status: "available", mine: false, updated_since_claim: false });
          XL.toast("It's available again.");
        } else if (r === "not_yours") {
          XL.toast("That gift was chosen in a different browser, so it can only be changed there.");
        } else {
          XL.toast("Something went wrong, so nothing was changed. Please try again.");
        }
      },
      verify: (fresh) => !fresh || !fresh.mine,
      success: "It's available again.",
    });
  }

  function dismissRemoved(g) {
    act(g, {
      call: () => api("release_claim", { p_gift_id: g.id, p_token: token }),
      onResult: () => {
        state.gifts = state.gifts.filter((x) => x.id !== g.id);
      },
      verify: (fresh) => !fresh,
      success: "Dismissed.",
    });
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  $("#door-year").textContent = config.year;
  XL.people.forEach((p) => {
    const tag = $(".choice-" + p.key + " .choice-tag");
    if (tag && p.tagline) tag.textContent = p.tagline;
  });
  // Beside the list, "Already Taken" stays open: its heading isn't a toggle there.
  const takenDetails = $("#purchased-details");
  const takenSummary = takenDetails && takenDetails.querySelector("summary");
  if (takenSummary) takenSummary.addEventListener("click", (event) => { if (isWide()) event.preventDefault(); });
  if (jump && window.IntersectionObserver) {
    jump.addEventListener("click", jumpToSection);
    const availableArea = $(".list-main");
    const takenArea = $("#purchased");
    const watch = (entries) => {
      entries.forEach((entry) => { inView[entry.target === takenArea ? "taken" : "available"] = entry.isIntersecting; });
      updateJump();
    };
    // "In view" means reaching the band between 10% and 85% down the screen, so a
    // sliver at the top doesn't count, but a heading showing above the pill does.
    // The page itself is the root.
    const options = { rootMargin: "-10% 0px -15% 0px" };
    let observer;
    try { observer = new IntersectionObserver(watch, Object.assign({ root: document }, options)); }
    catch (e) { observer = new IntersectionObserver(watch, options); } // browsers without a document root
    if (availableArea) observer.observe(availableArea);
    if (takenArea) observer.observe(takenArea);
  }

  const wideQuery = window.matchMedia(WIDE);
  const onWidthChange = () => { if (state.view) renderList(); };
  if (wideQuery.addEventListener) wideQuery.addEventListener("change", onWidthChange);
  else if (wideQuery.addListener) wideQuery.addListener(onWidthChange);

  const sortSelect = $("#gift-sort");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      state.sort = sortSelect.value;
      renderList();
    });
  }
  window.addEventListener("hashchange", route);
  route();
  if (!state.view) refresh(); // warm the data while people read the front door

  setInterval(() => { if (state.view && !document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (state.view && !document.hidden) refresh(); });
  window.addEventListener("focus", () => { if (state.view) refresh(); });
})();
