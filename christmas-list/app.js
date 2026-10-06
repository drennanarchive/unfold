/*
 * Family page (index.html): the front door plus Clara's and Cameron's lists.
 *
 *   #          front door
 *   #clara     Clara's list
 *   #cameron   Cameron's list
 *
 * Each browser gets a random token (kept in localStorage). The database stores
 * only a hash of it, which is how this browser recognises "Claimed by you" and
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
    purchasedDefaultSet: false, // "Already purchased" starts open on wide screens, closed on narrow
  };
  const cards = new Map();  // gift id -> { li, sig }  (main list)
  const rows = new Map();   // gift id -> { li, sig }  ("Already purchased")

  const giftById = (id) => state.gifts.find((g) => g.id === id);

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
    window.scrollTo(0, 0);
    renderList();
    refresh();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const ICONS = {
    available: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    claimed: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg>',
    purchased: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function statusLabel(g) {
    if (g.status === "available") return "Available";
    if (g.status === "claimed") return g.mine ? "Claimed by you" : "Claimed";
    return g.mine ? "Purchased by you" : "Purchased";
  }

  function chip(g, pending) {
    const node = el("span", "chip");
    node.dataset.status = pending ? "loading" : g.status;
    node.innerHTML = pending ? "" : ICONS[g.status];
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

  function hasMore(g) {
    const longDetails = g.details && (g.details.length > 90 || g.details.includes("\n"));
    return Boolean(longDetails || XL.isHttpUrl(g.link) || XL.isHttpUrl(g.image_url));
  }

  function buildRemoved(g, pending) {
    const li = el("li", "gift is-removed");
    li.dataset.status = g.status;
    li.append(el("h3", "gift-name", g.name));
    li.append(el("p", "removed-msg",
      g.status === "purchased"
        ? "Removed from the list after you bought it. You may want to check with " + (XL.person(g.recipient) || {}).name + "."
        : "Removed from the list after you claimed it. It's no longer needed."));
    const foot = el("div", "gift-foot");
    foot.append(el("span", "spacer"));
    foot.append(button("Dismiss", "btn-text", "dismiss", () => dismissRemoved(g), pending));
    li.append(foot);
    return li;
  }

  function buildGift(g) {
    const pending = state.pending.has(g.id);
    if (g.removed) return buildRemoved(g, pending);

    const open = state.open.has(g.id);
    const li = el("li", "gift");
    li.dataset.status = g.status;
    li.classList.toggle("is-mine", g.mine);
    li.classList.toggle("is-open", open);

    const top = el("div", "gift-top");
    top.append(el("h3", "gift-name", g.name));
    if (g.price) {
      const price = el("span", "gift-price");
      price.append(el("span", "sr-only", "Approximate price: "), document.createTextNode(g.price));
      top.append(price);
    }
    li.append(top);

    if (g.details) li.append(el("p", "gift-details", g.details));
    if (g.mine && g.updated_since_claim) {
      li.append(el("p", "gift-note", "✎ Updated since you claimed it"));
    }

    const more = hasMore(g);
    const extraId = "extra-" + g.id;
    if (more) {
      const extra = el("div", "gift-extra");
      extra.id = extraId;
      extra.hidden = !open;
      if (XL.isHttpUrl(g.image_url)) {
        const img = el("img", "gift-image");
        img.src = g.image_url;
        img.alt = "";
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        img.addEventListener("error", () => img.remove());
        extra.append(img);
      }
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
    if (g.status === "available") {
      const claimButton = button("Claim", "btn btn-primary", "claim", () => claim(g), pending);
      claimButton.setAttribute("aria-label", "Claim " + g.name);
      foot.append(claimButton);
    }
    li.append(foot);

    if (g.mine && g.status === "claimed") {
      const actions = el("div", "gift-actions");
      actions.append(
        button("Mark purchased", "btn btn-primary", "purchase", () => markPurchased(g), pending),
        button("Undo claim", "btn btn-quiet", "release", () => release(g), pending)
      );
      li.append(actions);
    }
    return li;
  }

  // A compact row for the "Already purchased" area. Only the browser that bought
  // it gets a control (to undo the purchase); everyone else just sees "Purchased".
  function buildPurchased(g) {
    const pending = state.pending.has(g.id);
    const li = el("li", "bought");
    li.classList.toggle("is-mine", g.mine);

    const top = el("div", "bought-top");
    top.insertAdjacentHTML("beforeend", ICONS.purchased);
    top.append(el("span", "bought-name", g.name));
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
    if (g.mine && g.updated_since_claim) li.append(el("p", "gift-note", "✎ Updated since you claimed it"));

    if (g.mine) {
      const undo = button("Undo purchase", "btn-text bought-undo", "unpurchase", () => markNotPurchased(g), pending);
      undo.setAttribute("aria-label", "Mark " + g.name + " as not purchased");
      li.append(undo);
    }
    return li;
  }

  function signature(g) {
    return JSON.stringify([g, state.pending.has(g.id), state.open.has(g.id)]);
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

  // Purchased gifts leave the main list for a compact "Already purchased" area
  // (beside the list on wide screens, below it on phones). Claimed-but-not-
  // purchased gifts stay in the main list. Removal notes stay in the main list.
  const isPurchasedRow = (g) => !g.removed && g.status === "purchased";

  function renderPurchased(items) {
    const section = $("#purchased");
    const bought = items.filter(isPurchasedRow);
    section.hidden = bought.length === 0;
    $("#purchased-count").textContent = "(" + bought.length + ")";
    const details = $("#purchased-details");
    if (!state.purchasedDefaultSet && bought.length) {
      // Open by default where it sits beside the list; tucked away on narrower screens.
      details.open = window.matchMedia("(min-width: 1240px) and (min-aspect-ratio: 1/1)").matches;
      state.purchasedDefaultSet = true;
    }
    syncList($("#purchased-list"), bought, rows, buildPurchased);
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
      showNotice("This browser isn't saving site data (private window?). You can still claim gifts, but it will forget which ones are yours once it's closed.");
    }

    syncList(list, items.filter((g) => !isPurchasedRow(g)), cards, buildGift);
    renderPurchased(items);

    renderSummary(items);
    renderSync();
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
    const count = (s) => visible.filter((g) => g.status === s).length;
    [["available", "available"], ["claimed", "claimed"], ["purchased", "purchased"]].forEach(([key, word]) => {
      const n = count(key);
      if (!n && key !== "available") return;
      const span = el("span");
      span.append(el("i", "dot dot-" + key), document.createTextNode(n + " " + word));
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
    // the gift afterwards, even if it moved between the list and "Already purchased".
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
        const target = li && (li.querySelector('[data-role="purchase"], [data-role="unpurchase"], [data-role="claim"], [data-role="release"]')
          || li.querySelector("button:not(:disabled)"));
        if (target) target.focus();
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

  async function claim(g) {
    const ok = await XL.confirm({
      title: "Claim “" + g.name + "”?",
      body: "Everyone else will just see “Claimed”, never who. This browser remembers it's yours, so you can mark it purchased (or change your mind) later.",
      confirmLabel: "Claim it",
    });
    if (!ok) return;
    act(g, {
      call: () => api("claim_gift", { p_gift_id: g.id, p_token: token }),
      onResult: (r) => {
        if (r === "claimed" || r === "already_yours") {
          setLocal(g.id, { status: "claimed", mine: true });
          XL.toast("🎁 It's yours. Only this browser knows.");
        } else if (r === "taken") {
          setLocal(g.id, { status: "claimed", mine: false });
          XL.toast("Someone just claimed this one.");
        } else {
          XL.toast("That gift was just removed from the list.");
        }
      },
      verify: (fresh) => Boolean(fresh && fresh.mine),
      success: "🎁 It went through. It's yours.",
    });
  }

  async function release(g) {
    const ok = await XL.confirm({
      title: "Undo your claim?",
      body: "“" + g.name + "” goes back on the list for everyone.",
      confirmLabel: "Undo claim",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    act(g, {
      call: () => api("release_claim", { p_gift_id: g.id, p_token: token }),
      onResult: (r) => {
        if (r === "released") {
          setLocal(g.id, { status: "available", mine: false, updated_since_claim: false });
          XL.toast("Claim undone. It's back on the list.");
        } else if (r === "purchased") {
          XL.toast("Mark it as not purchased first.");
        } else {
          XL.toast("That claim wasn't made from this browser.");
        }
      },
      verify: (fresh) => !fresh || !fresh.mine,
      success: "Claim undone.",
    });
  }

  function markPurchased(g) {
    act(g, {
      call: () => api("mark_purchased", { p_gift_id: g.id, p_token: token }),
      onResult: (r) => {
        if (r === "purchased") {
          setLocal(g.id, { status: "purchased" });
          $("#purchased-details").open = true; // so you can see where it went
          state.purchasedDefaultSet = true;    // ...and don't let the phone default close it again
          XL.toast("Purchased ✓ Moved to “Already purchased”.", { label: "Undo", onClick: () => markNotPurchased(giftById(g.id) || g, true) });
        } else {
          XL.toast("That claim wasn't made from this browser.");
        }
      },
      verify: (fresh) => Boolean(fresh && fresh.mine && fresh.status === "purchased"),
      success: "Marked as purchased ✓",
    });
  }

  function markNotPurchased(g, fromUndo) {
    act(g, {
      call: () => api("mark_not_purchased", { p_gift_id: g.id, p_token: token }),
      onResult: (r) => {
        if (r === "claimed") {
          setLocal(g.id, { status: "claimed" });
          XL.toast(fromUndo ? "Undone. Still claimed by you." : "Marked as not purchased. Still claimed by you.");
        } else {
          XL.toast("That claim wasn't made from this browser.");
        }
      },
      verify: (fresh) => Boolean(fresh && fresh.mine && fresh.status === "claimed"),
      success: "Marked as not purchased.",
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
  window.addEventListener("hashchange", route);
  route();
  if (!state.view) refresh(); // warm the data while people read the front door

  setInterval(() => { if (state.view && !document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (state.view && !document.hidden) refresh(); });
  window.addEventListener("focus", () => { if (state.view) refresh(); });
})();
