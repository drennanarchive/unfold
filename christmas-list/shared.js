/*
 * Small helpers used by both pages (app.js and manage.js).
 * Everything hangs off window.XL so the two pages share one vocabulary.
 */
(function () {
  "use strict";

  const config = window.CHRISTMAS_LIST_CONFIG || {};

  const XL = {
    config,
    configured: Boolean(config.supabaseUrl && config.supabasePublishableKey),
    people: Array.isArray(config.people) ? config.people : [],
  };

  XL.person = (key) => XL.people.find((p) => p.key === key);

  XL.$ = (selector, root) => (root || document).querySelector(selector);

  XL.el = function (tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  XL.isHttpUrl = function (value) {
    if (!value || /\s/.test(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch (e) {
      return false;
    }
  };

  // The number to sort a free-text price by, or null if it doesn't state one.
  // Text that is only a price counts as written ("~50", "90-120", "20-$30").
  // Otherwise only amounts with a currency symbol count, and the lowest wins
  // ("$69 - $157", "$55 (min)"), so "size 10" or "3-pack" never pass as prices.
  const AMOUNT = "(\\d{1,3}(?:,\\d{3})+|\\d+)(\\.\\d+)?";
  const ONLY_A_PRICE = new RegExp("^(?:~|≈|about|around|approx\\.?|approximately|roughly|under)?\\s*" + AMOUNT +
    "\\s*(?:(?:-|–|—|to)\\s*[$€£]?\\s*\\d[\\d,.]*\\s*)?(?:dollars|bucks|usd|[$€£])?\\+?$", "i");
  const WITH_SYMBOL = new RegExp("[$€£]\\s*" + AMOUNT, "g");
  const amount = (whole, fraction) => Number(whole.replace(/,/g, "") + (fraction || ""));

  XL.priceValue = function (text) {
    const value = String(text == null ? "" : text).trim();
    const only = ONLY_A_PRICE.exec(value);
    if (only) return amount(only[1], only[2]);
    const marked = Array.from(value.matchAll(WITH_SYMBOL), (m) => amount(m[1], m[2]));
    return marked.length ? Math.min(...marked) : null;
  };

  XL.reducedMotion = () => Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // Applies a theme ("home", "clara", "cameron") to the whole page.
  XL.setTheme = function (theme) {
    document.body.dataset.theme = theme;
    XL.decorate(theme);
  };

  // ---- Toast (polite status message at the bottom of the screen) ----
  let toastTimer;
  XL.toast = function (message, action) {
    const node = XL.$("#toast");
    if (!node) return;
    node.textContent = "";
    node.append(XL.el("span", null, message));
    if (action) {
      const button = XL.el("button", "toast-action", action.label);
      button.type = "button";
      button.addEventListener("click", () => {
        node.classList.remove("is-visible");
        action.onClick();
      });
      node.append(button);
    }
    node.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove("is-visible"), action ? 7000 : 4000);
  };

  // ---- Confirm dialog. Resolves true if the person confirms. ----
  XL.confirm = function ({ title, body, confirmLabel, cancelLabel }) {
    const dialog = XL.$("#confirm");
    XL.$("#confirm-title", dialog).textContent = title;
    XL.$("#confirm-body", dialog).textContent = body || "";
    const yes = XL.$("#confirm-yes", dialog);
    const no = XL.$("#confirm-no", dialog);
    yes.textContent = confirmLabel || "Yes";
    no.textContent = cancelLabel || "Not now";

    return new Promise((resolve) => {
      let answered = false;
      const finish = (value) => {
        if (answered) return;
        answered = true;
        yes.removeEventListener("click", onYes);
        dialog.removeEventListener("close", onClose);
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onYes = (event) => { event.preventDefault(); finish(true); };
      const onClose = () => finish(false);
      yes.addEventListener("click", onYes);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
    });
  };

  // ---- Gentle background motion: snow for Clara/home, a few warm glints for Cameron ----
  XL.decorate = function (theme) {
    const layer = XL.$(".sky");
    if (!layer) return;
    layer.textContent = "";
    if (XL.reducedMotion()) return;

    const counts = { home: 18, clara: 34, cameron: 14 };
    const n = counts[theme] || 0;
    for (let i = 0; i < n; i++) {
      const flake = XL.el("span", theme === "cameron" ? "glint" : "flake");
      const size = theme === "cameron" ? 2 + Math.random() * 2.5 : 2 + Math.random() * 4;
      flake.style.width = flake.style.height = size.toFixed(1) + "px";
      flake.style.left = (Math.random() * 100).toFixed(1) + "%";
      flake.style.opacity = (0.35 + Math.random() * 0.55).toFixed(2);
      flake.style.animationDuration = (theme === "cameron" ? 16 : 10) + Math.random() * 14 + "s";
      flake.style.animationDelay = -(Math.random() * 24).toFixed(1) + "s";
      flake.style.setProperty("--drift", (Math.random() * 70 - 35).toFixed(0) + "px");
      layer.append(flake);
    }
  };

  window.XL = XL;
})();
