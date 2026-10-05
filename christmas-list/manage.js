/*
 * Owner page (manage.html): Clara and Cameron sign in and edit their own list.
 *
 * Sign-in uses Supabase Auth (email + password, session kept in this browser).
 * Every change goes through an owner_* database function, which works out the
 * list from the login itself. This page never sees claim information.
 */
(function () {
  "use strict";

  const { config, el, $ } = XL;

  const views = ["loading", "signin", "recovery", "nolist", "editor"];
  function show(view) {
    views.forEach((v) => { $("#" + v).hidden = v !== view; });
    $("#sign-out").hidden = !(view === "editor" || view === "nolist");
  }

  if (!XL.configured || !window.supabase) {
    show("signin");
    $("#signin-form").hidden = true;
    $("#signin-title").textContent = "Not set up yet";
    $(".panel-sub", $("#signin")).textContent = !XL.configured
      ? "Add the Supabase settings to config.js to use this page."
      : "Couldn't load the sign-in library. Check your connection and reload.";
    return;
  }

  // Note this before the client starts: it tidies the reset-link details out of the URL.
  const arrivedFromResetLink = /type=recovery/.test(location.hash);

  const sb = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  const state = {
    email: "",
    recipient: null,
    gifts: [],
    moveOpen: null,   // id of the gift whose Move controls are showing
    editing: null,    // gift being edited, or null when adding
    busy: false,
  };

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  function kindOf(error) {
    const code = (error && error.code) || "";
    const message = (error && error.message) || "";
    if (code === "PGRST301" || code === "PGRST303" || /jwt|token is expired|not authenticated/i.test(message)) return "expired";
    if (code === "42501") return "not-owner";
    if (code === "P0002") return "not-found";
    if (code === "22023") return "invalid";
    if (!code && /fetch|network|load failed/i.test(message)) return "network";
    return "other";
  }

  async function call(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  // Shared handling for anything that isn't specific to one action.
  async function handleError(error) {
    console.error(error);
    const kind = kindOf(error);
    if (kind === "expired") {
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      showSignIn("Your session expired. Please sign in again.");
    } else if (kind === "not-owner") {
      showNoList();
    } else if (kind === "not-found") {
      XL.toast("That gift has already changed. Showing the latest list.");
      loadList();
    } else if (kind === "network") {
      XL.toast("Couldn't reach the list. Nothing was changed. Please try again.");
    } else {
      XL.toast("Something went wrong, so nothing was changed.");
    }
  }

  // ---------------------------------------------------------------------------
  // Sign in / out / password reset
  // ---------------------------------------------------------------------------

  function showSignIn(message) {
    state.recipient = null;
    XL.setTheme("home");
    document.title = "Manage your wishlist";
    show("signin");
    const msg = $("#signin-message");
    msg.textContent = message || "";
    msg.classList.remove("is-ok");
  }

  function showNoList() {
    XL.setTheme("home");
    $("#nolist-email").textContent = state.email;
    show("nolist");
  }

  $("#signin-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("#signin-email").value.trim();
    const password = $("#signin-password").value;
    const msg = $("#signin-message");
    msg.classList.remove("is-ok");
    if (!email || !password) {
      msg.textContent = "Enter your email and password.";
      return;
    }
    const submit = $("#signin-submit");
    submit.disabled = true;
    submit.textContent = "Signing in…";
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    submit.disabled = false;
    submit.textContent = "Sign in";
    if (error) {
      msg.textContent = /invalid/i.test(error.message)
        ? "That email and password don't match."
        : /fetch|network/i.test(error.message)
          ? "Couldn't reach the sign-in service. Check your connection."
          : error.message;
      return;
    }
    $("#signin-password").value = "";
    startSession(data.session);
  });

  $("#forgot").addEventListener("click", async () => {
    const email = $("#signin-email").value.trim();
    const msg = $("#signin-message");
    if (!email) {
      msg.classList.remove("is-ok");
      msg.textContent = "Type your email above first, then press Forgot password.";
      $("#signin-email").focus();
      return;
    }
    const redirectTo = location.href.split("#")[0].split("?")[0];
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    msg.classList.toggle("is-ok", !error);
    msg.textContent = error
      ? "Couldn't send a reset email right now. Please try again later."
      : "If that email has an account, a reset link is on its way.";
  });

  $("#recovery-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("#recovery-password").value;
    const msg = $("#recovery-message");
    if (password.length < 8) {
      msg.textContent = "Use at least 8 characters.";
      return;
    }
    const { error } = await sb.auth.updateUser({ password });
    if (error) {
      msg.textContent = error.message;
      return;
    }
    $("#recovery-password").value = "";
    XL.toast("Password saved.");
    const { data } = await sb.auth.getSession();
    startSession(data.session);
  });

  $("#sign-out").addEventListener("click", async () => {
    await sb.auth.signOut().catch(() => {});
    showSignIn("You're signed out.");
    $("#signin-message").classList.add("is-ok");
  });

  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") {
      XL.setTheme("home");
      show("recovery");
    } else if (event === "SIGNED_OUT" && state.recipient) {
      showSignIn("You've been signed out.");
    }
  });

  // ---------------------------------------------------------------------------
  // Loading the owner's list
  // ---------------------------------------------------------------------------

  async function startSession(session) {
    if (!session) { showSignIn(); return; }
    state.email = (session.user && session.user.email) || "";
    try {
      state.recipient = await call("owner_recipient");
    } catch (error) {
      if (kindOf(error) === "network") {
        showSignIn("Couldn't reach the list. Check your connection and reload.");
      } else {
        await handleError(error);
      }
      return;
    }
    if (!state.recipient) { showNoList(); return; }

    const person = XL.person(state.recipient) || { name: state.recipient };
    XL.setTheme(state.recipient);
    document.title = "Manage " + person.name + "'s wishlist";
    $("#editor-kicker").textContent = person.name + "'s list · Christmas " + config.year;
    $("#editor-sub").textContent = "Signed in as " + state.email;
    show("editor");
    loadList();
  }

  async function loadList() {
    try {
      state.gifts = (await call("owner_list")) || [];
      renderList();
    } catch (error) {
      await handleError(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function actionButton(label, role, onClick, extraClass) {
    const b = el("button", "btn btn-quiet" + (extraClass ? " " + extraClass : ""), label);
    b.type = "button";
    b.dataset.role = role;
    b.addEventListener("click", onClick);
    return b;
  }

  function renderList(focus) {
    const list = $("#owner-gifts");
    list.textContent = "";
    const total = state.gifts.length;

    if (!total) {
      const empty = el("li", "owner-gift owner-empty");
      empty.append(el("p", null, "Your list is still a blank page."), el("p", "field-hint", "Add your first wish and it appears on the family page right away."));
      list.append(empty);
      return;
    }

    state.gifts.forEach((g, index) => {
      const li = el("li", "owner-gift");
      li.dataset.id = g.id;

      const top = el("div", "gift-top");
      top.append(el("h3", "gift-name", g.name));
      if (g.price) top.append(el("span", "gift-price", g.price));
      li.append(top);
      if (g.details) li.append(el("p", "gift-details", g.details));

      const meta = el("p", "owner-meta");
      meta.append(el("span", "position", "#" + (index + 1) + " of " + total));
      if (g.link) meta.append(el("span", null, "🔗 Shopping link"));
      if (g.image_url) meta.append(el("span", null, "🖼 Image"));
      li.append(meta);

      const actions = el("div", "owner-actions");
      const moveOpen = state.moveOpen === g.id;
      const moveBtn = actionButton("Move", "move", () => {
        state.moveOpen = moveOpen ? null : g.id;
        renderList({ id: g.id, role: "move" });
      });
      moveBtn.setAttribute("aria-expanded", String(moveOpen));
      moveBtn.setAttribute("aria-controls", "move-" + g.id);
      moveBtn.setAttribute("aria-label", "Move " + g.name);
      const editBtn = actionButton("Edit", "edit", () => openForm(g));
      editBtn.setAttribute("aria-label", "Edit " + g.name);
      const removeBtn = actionButton("Remove", "remove", () => removeGift(g), "btn-danger");
      removeBtn.setAttribute("aria-label", "Remove " + g.name);
      actions.append(editBtn, moveBtn, removeBtn);
      li.append(actions);

      if (moveOpen) {
        const panel = el("div", "move-panel");
        panel.id = "move-" + g.id;
        panel.setAttribute("role", "group");
        panel.setAttribute("aria-label", "Move " + g.name);
        const first = index === 0;
        const last = index === total - 1;
        [["up", "↑ Up", first], ["down", "↓ Down", last], ["top", "⤒ To top", first], ["bottom", "⤓ To bottom", last]]
          .forEach(([where, label, disabled]) => {
            const b = actionButton(label, "move-" + where, () => move(g, where));
            b.disabled = disabled;
            panel.append(b);
          });
        li.append(panel);
      }
      list.append(li);
    });

    if (focus) {
      const li = list.querySelector('[data-id="' + focus.id + '"]');
      let target = li && li.querySelector('[data-role="' + focus.role + '"]');
      if (target && target.disabled) target = li.querySelector(".move-panel button:not(:disabled)") || li.querySelector('[data-role="move"]');
      if (target) target.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  // One change at a time. Clicks during a save are ignored rather than
  // disabling every button (disabled buttons would also drop keyboard focus).
  async function busy(task) {
    if (state.busy) return;
    state.busy = true;
    $("#owner-gifts").setAttribute("aria-busy", "true");
    try { await task(); } finally {
      state.busy = false;
      $("#owner-gifts").removeAttribute("aria-busy");
    }
  }

  function move(g, where) {
    busy(async () => {
      try {
        await call("owner_move_gift", { p_id: g.id, p_where: where });
        state.gifts = (await call("owner_list")) || [];
        renderList({ id: g.id, role: "move-" + where });
      } catch (error) {
        await handleError(error);
      }
    });
  }

  async function removeGift(g) {
    const ok = await XL.confirm({
      title: "Remove “" + g.name + "”?",
      body: "Family won't see it anymore. If someone had already claimed it, only they get a gentle heads-up.",
      confirmLabel: "Remove",
      cancelLabel: "Keep it",
    });
    if (!ok) return;
    busy(async () => {
      try {
        await call("owner_archive_gift", { p_id: g.id });
        state.gifts = state.gifts.filter((x) => x.id !== g.id);
        if (state.moveOpen === g.id) state.moveOpen = null;
        renderList();
        $("#add-gift").focus();
        XL.toast("Removed “" + g.name + "”.", { label: "Undo", onClick: () => restore(g) });
      } catch (error) {
        await handleError(error);
      }
    });
  }

  function restore(g) {
    busy(async () => {
      try {
        await call("owner_restore_gift", { p_id: g.id });
        await loadList();
        XL.toast("“" + g.name + "” is back on your list.");
      } catch (error) {
        await handleError(error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Add / edit form
  // ---------------------------------------------------------------------------

  const form = $("#gift-form");
  const dialog = $("#gift-dialog");
  const fields = {
    name: { input: $("#f-name"), error: $("#e-name") },
    details: { input: $("#f-details"), error: $("#e-details") },
    price: { input: $("#f-price"), error: $("#e-price") },
    link: { input: $("#f-link"), error: $("#e-link") },
    image_url: { input: $("#f-image"), error: $("#e-image") },
  };

  function openForm(gift) {
    state.editing = gift || null;
    const person = XL.person(state.recipient) || { name: "Your" };
    $("#gift-form-kicker").textContent = person.name + "'s list";
    $("#gift-form-title").textContent = gift ? "Edit gift" : "Add a gift";
    $("#gift-form-lede").textContent = gift
      ? "A different gift deserves a new entry. Small edits are fine."
      : "Only the name is needed. The extras help everyone get it right.";
    $("#gift-save").textContent = gift ? "Save changes" : "Add to my list";
    Object.entries(fields).forEach(([key, f]) => {
      f.input.value = gift && gift[key] ? gift[key] : "";
      f.error.textContent = "";
      f.input.removeAttribute("aria-invalid");
    });
    $("#gift-form-message").textContent = "";
    dialog.showModal();
    fields.name.input.focus();
  }

  function validate() {
    const values = {};
    Object.entries(fields).forEach(([key, f]) => { values[key] = f.input.value.trim(); });
    const errors = {};
    if (!values.name) errors.name = "Give the gift a name.";
    else if (values.name.length > 120) errors.name = "Keep the name under 120 characters.";
    if (values.details.length > 1000) errors.details = "Keep the details under 1000 characters.";
    if (values.price.length > 40) errors.price = "Keep the price short (40 characters max).";
    if (values.link && !XL.isHttpUrl(values.link)) errors.link = "Paste a full web address starting with https://";
    if (values.image_url && !XL.isHttpUrl(values.image_url)) errors.image_url = "Paste a full web address starting with https://";

    Object.entries(fields).forEach(([key, f]) => {
      f.error.textContent = errors[key] || "";
      if (errors[key]) f.input.setAttribute("aria-invalid", "true");
      else f.input.removeAttribute("aria-invalid");
    });
    const firstBad = Object.keys(fields).find((key) => errors[key]);
    if (firstBad) fields[firstBad].input.focus();
    return firstBad ? null : values;
  }

  $("#add-gift").addEventListener("click", () => openForm(null));
  $("#gift-cancel").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = validate();
    if (!values) return;
    const save = $("#gift-save");
    const message = $("#gift-form-message");
    busy(async () => {
      save.disabled = true;
      message.textContent = "";
      const args = {
        p_name: values.name,
        p_details: values.details || null,
        p_price: values.price || null,
        p_link: values.link || null,
        p_image_url: values.image_url || null,
      };
      try {
        let focusId;
        if (state.editing) {
          await call("owner_update_gift", Object.assign({ p_id: state.editing.id }, args));
          focusId = state.editing.id;
        } else {
          focusId = await call("owner_add_gift", args);
        }
        dialog.close();
        state.gifts = (await call("owner_list")) || [];
        renderList({ id: focusId, role: "edit" });
        XL.toast(state.editing ? "Saved." : "Added “" + values.name + "” to your list.");
      } catch (error) {
        const kind = kindOf(error);
        if (kind === "invalid") message.textContent = error.message;
        else if (kind === "network") message.textContent = "Couldn't reach the list. Your changes aren't saved yet. Please try again.";
        else { dialog.close(); await handleError(error); }
      } finally {
        save.disabled = false;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Start: reuse the saved session if there is one
  // ---------------------------------------------------------------------------

  (async () => {
    const { data } = await sb.auth.getSession();
    // A password-reset link signs in and fires PASSWORD_RECOVERY; don't jump past it.
    if (arrivedFromResetLink) {
      if (data && data.session) { XL.setTheme("home"); show("recovery"); }
      else showSignIn("That reset link has expired or was already used. Request a new one below.");
      return;
    }
    if (data && data.session) startSession(data.session);
    else showSignIn();
  })();
})();
