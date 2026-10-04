/*
 * Christmas Wish Lists: page logic.
 *
 * How it works, in short:
 *   - The gifts come from gifts.js. The database only knows which gift ids are claimed.
 *   - Each browser gets a random "claim token", saved in localStorage. Claiming sends
 *     that token along; the database stores a hash of it. That's how a device
 *     recognises its own claims ("Claimed by you") and is allowed to undo them.
 *   - The page re-checks claims every few seconds and whenever the tab comes back
 *     into view, so everyone's view stays current.
 */
(function () {
  "use strict";

  const config = window.CHRISTMAS_LIST_CONFIG || {};
  const REFRESH_MS = Math.max(5, Number(config.refreshSeconds) || 15) * 1000;
  const TOKEN_KEY = "christmas-list-claim-token";
  const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const $ = (selector) => document.querySelector(selector);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function safeStorageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  // This browser's claim token. If storage is blocked (some private windows), the
  // token only lasts until the page is closed.
  function getClaimToken() {
    let token = safeStorageGet(TOKEN_KEY);
    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      token = randomToken();
      safeStorageSet(TOKEN_KEY, token);
    }
    return token;
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Backends. Both offer the same three calls:
  //   listClaims(token)    -> [{ gift_id, mine }]
  //   claim(id, token)     -> "claimed" | "already_yours" | "taken"
  //   unclaim(id, token)   -> true | false
  // ---------------------------------------------------------------------------

  // The real one: calls the database functions defined in supabase-setup.sql.
  function createSupabaseBackend(url, key) {
    const base = url.replace(/\/+$/, "") + "/rest/v1/rpc/";
    const headers = { "Content-Type": "application/json", apikey: key };
    // Older Supabase projects use a JWT "anon" key, which also goes in Authorization.
    if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;

    async function rpc(name, args) {
      const response = await fetch(base + name, {
        method: "POST",
        headers,
        body: JSON.stringify(args),
        cache: "no-store",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(name + " failed (" + response.status + "): " + detail);
      }
      return response.json();
    }

    return {
      listClaims: (token) => rpc("list_claims", { p_token: token }),
      claim: (id, token) => rpc("claim_gift", { p_gift_id: id, p_token: token }),
      unclaim: (id, token) => rpc("unclaim_gift", { p_gift_id: id, p_token: token }),
    };
  }

  // Demo mode: claims are kept in this browser only, so the page can be tried
  // before Supabase is set up. One gift starts out "claimed by someone else" so
  // all three states are visible.
  function createDemoBackend(gifts) {
    const KEY = "christmas-list-demo-claims";
    let claims;
    try { claims = JSON.parse(safeStorageGet(KEY)) || null; } catch (e) { claims = null; }
    if (!claims) {
      claims = {};
      const sample = gifts.find((g) => g.recipient === (window.RECIPIENTS || [])[1]) || gifts[1];
      if (sample) claims[sample.id] = "someone-else";
    }
    const save = () => safeStorageSet(KEY, JSON.stringify(claims));
    const wait = () => new Promise((resolve) => setTimeout(resolve, 250));

    return {
      async listClaims(token) {
        await wait();
        return Object.keys(claims).map((id) => ({ gift_id: id, mine: claims[id] === token }));
      },
      async claim(id, token) {
        await wait();
        if (!claims[id]) { claims[id] = token; save(); return "claimed"; }
        return claims[id] === token ? "already_yours" : "taken";
      },
      async unclaim(id, token) {
        await wait();
        if (claims[id] !== token) return false;
        delete claims[id];
        save();
        return true;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Gift catalog: check gifts.js for mistakes and show them clearly
  // ---------------------------------------------------------------------------

  function loadCatalog() {
    const raw = Array.isArray(window.GIFTS) ? window.GIFTS : [];
    const recipients = Array.isArray(window.RECIPIENTS) && window.RECIPIENTS.length
      ? window.RECIPIENTS
      : Array.from(new Set(raw.map((g) => g && g.recipient).filter(Boolean)));
    const problems = [];
    const seen = new Set();
    const gifts = [];

    raw.forEach((gift, index) => {
      const label = (gift && gift.name) ? '"' + gift.name + '"' : "gift #" + (index + 1);
      if (!gift || typeof gift !== "object") { problems.push(label + " isn't a valid entry."); return; }
      if (!gift.name) { problems.push(label + " has no name."); return; }
      if (!ID_PATTERN.test(gift.id || "")) {
        problems.push(label + ' needs an id made of lowercase letters, numbers and dashes (e.g. "clara-blanket").');
        return;
      }
      if (seen.has(gift.id)) { problems.push(label + ' reuses the id "' + gift.id + '". Every id must be unique.'); return; }
      if (!recipients.includes(gift.recipient)) {
        problems.push(label + ' has recipient "' + gift.recipient + '", which isn\'t one of: ' + recipients.join(", ") + ".");
        return;
      }
      if (gift.link && !isHttpUrl(gift.link)) problems.push(label + " has a link that doesn't start with http:// or https:// (link hidden).");
      seen.add(gift.id);
      gifts.push(gift);
    });

    return { gifts, recipients, problems };
  }

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------

  const catalog = loadCatalog();
  const token = getClaimToken();
  const demoMode = !(config.supabaseUrl && config.supabasePublishableKey);
  const backend = demoMode
    ? createDemoBackend(catalog.gifts)
    : createSupabaseBackend(config.supabaseUrl, config.supabasePublishableKey);

  const state = {
    loaded: false,          // have we heard from the database at least once?
    claims: new Map(),      // gift id -> "mine" | "taken"
    pending: new Set(),     // gift ids with a claim/undo in progress
    active: catalog.recipients[0],
    refreshing: false,
    refreshAgain: false,
    version: 0,             // bumped whenever this page claims or undoes something
  };
  const cards = new Map();  // gift id -> { root, status, button }

  function giftState(id) {
    if (state.pending.has(id)) return "pending";
    if (!state.loaded) return "loading";
    return state.claims.get(id) || "available";
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const STATUS_TEXT = {
    loading: "Checking…",
    pending: "Saving…",
    available: "Available",
    mine: "Claimed by you",
    taken: "Claimed",
  };

  function buildCard(gift) {
    const root = el("article", "card");

    const art = el("div", "card-art");
    const emoji = el("span", "card-emoji", gift.emoji || "🎁");
    emoji.setAttribute("aria-hidden", "true");
    if (gift.image) {
      const img = el("img");
      img.src = gift.image;
      img.alt = "";
      img.loading = "lazy";
      img.addEventListener("error", () => img.replaceWith(emoji));
      art.append(img);
    } else {
      art.append(emoji);
    }

    const body = el("div", "card-body");
    body.append(el("h3", "card-title", gift.name));
    if (gift.description) body.append(el("p", "card-desc", gift.description));

    if (gift.price || (gift.link && isHttpUrl(gift.link))) {
      const meta = el("div", "card-meta");
      if (gift.price) meta.append(el("span", "card-price", gift.price));
      if (gift.link && isHttpUrl(gift.link)) {
        const link = el("a", "card-link", "View item ↗");
        link.href = gift.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        meta.append(link);
      }
      body.append(meta);
    }

    const foot = el("div", "card-foot");
    const status = el("span", "status");
    const button = el("button", "btn");
    button.type = "button";
    button.addEventListener("click", () => onCardButton(gift));
    foot.append(status, button);
    body.append(foot);

    root.append(art, body);
    cards.set(gift.id, { root, status, button });
    return root;
  }

  function updateCard(gift) {
    const card = cards.get(gift.id);
    if (!card) return;
    const s = giftState(gift.id);
    // Cards keep their last settled look while saving, so they don't flicker.
    const look = s === "pending" ? (state.claims.get(gift.id) || "available") : s;

    card.root.dataset.state = look;
    card.status.dataset.state = s === "pending" ? "loading" : s;
    card.status.textContent = STATUS_TEXT[s];

    const button = card.button;
    button.disabled = s === "loading" || s === "pending" || s === "taken";
    if (s === "mine") {
      button.className = "btn btn-ghost";
      button.textContent = "Undo my claim";
      button.setAttribute("aria-label", "Undo my claim on " + gift.name);
    } else {
      button.className = "btn btn-primary";
      button.textContent = s === "taken" ? "Already claimed" : s === "pending" ? "One moment…" : "Claim this gift";
      button.setAttribute("aria-label", button.textContent + ": " + gift.name);
    }
  }

  function updateAll() {
    catalog.gifts.forEach(updateCard);
    updateTabCounts();
  }

  function renderTabs() {
    const tabs = $(".tabs");
    tabs.textContent = "";
    catalog.recipients.forEach((name) => {
      const tab = el("button", "tab");
      tab.type = "button";
      tab.id = "tab-" + slug(name);
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "panel");
      tab.dataset.recipient = name;
      tab.append(el("span", null, name), el("span", "tab-count"));
      tab.addEventListener("click", () => selectRecipient(name, true));
      tabs.append(tab);
    });

    // Arrow keys move between tabs.
    tabs.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const i = catalog.recipients.indexOf(state.active);
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = catalog.recipients[(i + step + catalog.recipients.length) % catalog.recipients.length];
      selectRecipient(next, true);
      document.getElementById("tab-" + slug(next)).focus();
    });
  }

  // Number of gifts still available, shown on each tab.
  function updateTabCounts() {
    catalog.recipients.forEach((name) => {
      const tab = document.getElementById("tab-" + slug(name));
      const count = tab && tab.querySelector(".tab-count");
      if (!count) return;
      const gifts = catalog.gifts.filter((g) => g.recipient === name);
      const open = gifts.filter((g) => !state.claims.has(g.id)).length;
      count.textContent = state.loaded ? String(open) : "";
      count.hidden = !state.loaded;
      count.title = open + " of " + gifts.length + " still available";
    });
  }

  function selectRecipient(name, updateHash) {
    if (!catalog.recipients.includes(name)) name = catalog.recipients[0];
    state.active = name;

    document.querySelectorAll(".tab").forEach((tab) => {
      const selected = tab.dataset.recipient === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    const panel = $("#panel");
    panel.setAttribute("aria-labelledby", "tab-" + slug(name));
    const grid = $("#grid");
    grid.textContent = "";
    const gifts = catalog.gifts.filter((g) => g.recipient === name);
    if (!gifts.length) {
      grid.append(el("p", "notice", "Nothing on " + name + "'s list yet. Check back soon!"));
    }
    gifts.forEach((gift) => {
      const card = cards.get(gift.id) ? cards.get(gift.id).root : buildCard(gift);
      grid.append(card);
      updateCard(gift);
    });

    if (updateHash) history.replaceState(null, "", "#" + slug(name));
  }

  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function recipientFromHash() {
    const wanted = decodeURIComponent(location.hash.slice(1));
    return catalog.recipients.find((name) => slug(name) === wanted);
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  let toastTimer;
  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-visible"), 3500);
  }

  function setSync(ok) {
    const node = $("#sync");
    node.classList.toggle("is-offline", !ok);
    if (ok) {
      const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      node.textContent = (demoMode ? "Demo mode · " : "") + "Up to date as of " + time;
    } else {
      node.textContent = "Can't reach the list right now. Retrying automatically…";
    }
  }

  function showNotices() {
    const node = $("#notice");
    if (catalog.problems.length) {
      node.hidden = false;
      node.className = "notice is-error";
      node.textContent = "";
      node.append(el("strong", null, "Some gifts in gifts.js need fixing:"));
      const list = el("ul");
      catalog.problems.forEach((p) => list.append(el("li", null, p)));
      node.append(list);
    } else if (demoMode) {
      node.hidden = false;
      node.className = "notice";
      node.textContent = "Demo mode: claims are only saved in this browser. Add the Supabase settings in config.js to share them with everyone.";
    }
  }

  // ---------------------------------------------------------------------------
  // Talking to the database
  // ---------------------------------------------------------------------------

  // If a claim or undo finishes while a refresh is in flight, that refresh's
  // answer may be stale, so it's thrown away and a fresh one runs.
  async function refresh() {
    if (state.refreshing) { state.refreshAgain = true; return; }
    state.refreshing = true;
    state.refreshAgain = false;
    const versionAtStart = state.version;
    try {
      const rows = await backend.listClaims(token);
      if (state.version !== versionAtStart) {
        state.refreshAgain = true;
      } else {
        const next = new Map();
        (rows || []).forEach((row) => next.set(row.gift_id, row.mine ? "mine" : "taken"));
        state.claims = next;
        state.loaded = true;
      }
      setSync(true);
    } catch (error) {
      console.error(error);
      setSync(false);
    } finally {
      state.refreshing = false;
      updateAll();
      if (state.refreshAgain) refresh();
    }
  }

  function onCardButton(gift) {
    const s = giftState(gift.id);
    if (s === "available") askToClaim(gift);
    else if (s === "mine") unclaim(gift);
  }

  // The confirm dialog. "Yes, claim it" starts the claim; "Not yet", Esc or
  // clicking outside just closes it.
  let giftToClaim = null;

  function askToClaim(gift) {
    giftToClaim = gift;
    $("#confirm-gift").textContent = gift.name;
    $("#confirm").showModal();
  }

  $("#confirm-yes").addEventListener("click", () => {
    const gift = giftToClaim;
    giftToClaim = null;
    if (gift) claim(gift);
  });
  $("#confirm").addEventListener("close", () => { giftToClaim = null; });

  async function claim(gift) {
    state.pending.add(gift.id);
    updateCard(gift);
    try {
      const result = await backend.claim(gift.id, token);
      if (result === "claimed" || result === "already_yours") {
        state.claims.set(gift.id, "mine");
        toast("🎁 It's yours! Only this device shows that you claimed it.");
      } else {
        state.claims.set(gift.id, "taken");
        toast("Someone else just claimed that one!");
      }
    } catch (error) {
      console.error(error);
      toast("Couldn't save your claim. Please try again.");
    } finally {
      state.pending.delete(gift.id);
      state.version++;
      updateAll();
      refresh();
    }
  }

  async function unclaim(gift) {
    state.pending.add(gift.id);
    updateCard(gift);
    try {
      const removed = await backend.unclaim(gift.id, token);
      if (removed) {
        state.claims.delete(gift.id);
        toast("Claim undone. It's available again.");
      } else {
        toast("That claim can't be undone from this device.");
      }
    } catch (error) {
      console.error(error);
      toast("Couldn't undo your claim. Please try again.");
    } finally {
      state.pending.delete(gift.id);
      state.version++;
      updateAll();
      refresh();
    }
  }

  // ---------------------------------------------------------------------------
  // Snow (decorative; skipped when the device asks for reduced motion)
  // ---------------------------------------------------------------------------

  function letItSnow() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const snow = $(".snow");
    for (let i = 0; i < 36; i++) {
      const flake = el("span", "flake");
      const size = 2 + Math.random() * 4;
      flake.style.width = flake.style.height = size + "px";
      flake.style.left = Math.random() * 100 + "%";
      flake.style.opacity = String(0.3 + Math.random() * 0.6);
      flake.style.animationDuration = 9 + Math.random() * 12 + "s";
      flake.style.animationDelay = -Math.random() * 20 + "s";
      flake.style.setProperty("--drift", (Math.random() * 80 - 40).toFixed(0) + "px");
      snow.append(flake);
    }
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  showNotices();
  renderTabs();
  selectRecipient(recipientFromHash() || catalog.recipients[0], false);
  updateTabCounts();
  letItSnow();
  refresh();

  window.addEventListener("hashchange", () => {
    const name = recipientFromHash();
    if (name && name !== state.active) selectRecipient(name, false);
  });

  setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.addEventListener("focus", refresh);
})();
