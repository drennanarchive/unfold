/*
 * Behaviour tests: the real index.html and manage.html in iframes (each one a
 * separate "browser"), talking to setup.sql running in the in-browser Postgres.
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Pages: family list and owner management",
  async run(t) {
    const { USERS, CONFIG, sleep, makeDb, makeEnv, open, reopen, rpc, card, chip, btn, toast, refocus, confirmYes, boughtStatus } = T;
    const { db } = await makeDb();
    const env = makeEnv(db);
    const C = USERS.clara.id;
    const claraGifts = async () => (await rpc(db, C, "owner_list", {})).data;

    t.section("Front door and navigation");
    const A = await open(env, "index.html", "A");
    t.check("front door shown with no #hash", !A.d.getElementById("door").hidden && A.d.getElementById("list").hidden);
    t.check("neutral home theme", A.d.body.dataset.theme === "home");
    t.check("two entry links", [...A.d.querySelectorAll(".choice")].map((a) => a.getAttribute("href")).join() === "#clara,#cameron");
    t.check("subtle owner link", A.d.querySelector(".door-foot a").getAttribute("href") === "manage.html");
    A.w.location.hash = "#clara"; await sleep(500);
    t.check("Clara's list uses Clara's theme", A.d.body.dataset.theme === "clara" && A.d.getElementById("list-title").textContent === "Clara's Wishlist");
    t.check("shows only Clara's gifts", A.d.querySelectorAll("#gifts > li").length === 4 && !card(A, "Wireless headphones"));
    t.check("status counts near the heading", /4 available/.test(A.d.getElementById("summary").textContent));
    t.check("link across to the other list", A.d.getElementById("nav-other").getAttribute("href") === "#cameron");
    A.w.location.hash = "#cameron"; await sleep(500);
    t.check("Cameron's list uses Cameron's theme", A.d.body.dataset.theme === "cameron" && !!card(A, "Wireless headphones"));
    A.w.location.hash = "#clara"; await sleep(500);
    const first = env.server.calls.find((c) => c.name === "get_list");
    t.check("family page sends only the publishable key", first.headers.apikey === CONFIG.supabasePublishableKey && !first.headers.Authorization);
    t.check("family page sends only a random 64-hex token (no identity)", Object.keys(first.args).join() === "p_token" && /^[0-9a-f]{64}$/.test(first.args.p_token));

    t.section("Claim lifecycle");
    const B = await open(env, "index.html", "B", "clara");
    btn(A, "Cozy oversized blanket", "claim").click();
    t.check("claiming asks first", A.d.getElementById("confirm").open);
    A.d.getElementById("confirm-no").click(); await sleep(200);
    t.check("'Not now' changes nothing", chip(A, "Cozy oversized blanket") === "Available");
    btn(A, "Cozy oversized blanket", "claim").click(); await confirmYes(A);
    t.check("claimant sees 'Claimed by you'", chip(A, "Cozy oversized blanket") === "Claimed by you");
    t.check("claimant gets Mark purchased + Undo claim", !!btn(A, "Cozy oversized blanket", "purchase") && !!btn(A, "Cozy oversized blanket", "release"));
    t.check("counts update", /3 available/.test(A.d.getElementById("summary").textContent) && /1 claimed/.test(A.d.getElementById("summary").textContent));
    t.check("another browser (stale) still shows Available", chip(B, "Cozy oversized blanket") === "Available");
    btn(B, "Cozy oversized blanket", "claim").click(); await confirmYes(B);
    t.check("late claimer told it was just taken", /just claimed/i.test(toast(B)), toast(B));
    t.check("late claimer sees plain 'Claimed', no actions", chip(B, "Cozy oversized blanket") === "Claimed" && !btn(B, "Cozy oversized blanket", "release"));

    btn(A, "Cozy oversized blanket", "purchase").click(); await sleep(400);
    t.check("mark purchased -> 'Purchased by you' in Already purchased", boughtStatus(A, "Cozy oversized blanket") === "Purchased by you" && !card(A, "Cozy oversized blanket"));
    t.check("purchase message offers Undo", !!A.d.querySelector("#toast .toast-action"));
    await refocus(B);
    t.check("others see 'Purchased', never who", boughtStatus(B, "Cozy oversized blanket") === "Purchased");
    A.d.querySelector("#toast .toast-action").click(); await sleep(500);
    t.check("Undo -> back to 'Claimed by you' in the main list", chip(A, "Cozy oversized blanket") === "Claimed by you" && !T.bought(A, "Cozy oversized blanket"));
    btn(A, "Cozy oversized blanket", "purchase").click(); await sleep(400);
    T.bought(A, "Cozy oversized blanket").querySelector('[data-role="unpurchase"]').click(); await sleep(400);
    t.check("'Undo purchase' in Already purchased works", chip(A, "Cozy oversized blanket") === "Claimed by you");

    const A2 = await reopen(A, "clara");
    t.check("after a reload the browser still recognises its claim", chip(A2, "Cozy oversized blanket") === "Claimed by you");
    Object.assign(A, A2);
    btn(A, "Cozy oversized blanket", "release").click();
    t.check("undoing a claim asks first", A.d.getElementById("confirm").open);
    await confirmYes(A);
    t.check("undo claim -> Available", chip(A, "Cozy oversized blanket") === "Available");
    await refocus(B);
    t.check("others see it available again", chip(B, "Cozy oversized blanket") === "Available");

    btn(A, "Winter candle set", "claim").click(); await confirmYes(A);
    t.check("other browser hasn't refreshed yet", chip(B, "Winter candle set") === "Available");
    await sleep(5600);
    t.check("other browser auto-refreshes and sees 'Claimed'", chip(B, "Winter candle set") === "Claimed");

    btn(A, "A good mystery novel", "claim").click(); btn(B, "A good mystery novel", "claim").click();
    A.d.getElementById("confirm-yes").click(); B.d.getElementById("confirm-yes").click();
    await sleep(900);
    const pair = [chip(A, "A good mystery novel"), chip(B, "A good mystery novel")];
    t.check("two browsers claiming at once: exactly one wins", pair.filter((x) => x === "Claimed by you").length === 1 && pair.includes("Claimed"), pair.join(" / "));

    t.section("Details");
    const more = btn(A, "Cozy oversized blanket", "more");
    t.check("Details button for long details / links", !!more && more.getAttribute("aria-expanded") === "false");
    t.check("details hidden by default", A.d.getElementById(more.getAttribute("aria-controls")).hidden);
    t.check("the card itself isn't a button", !card(A, "Cozy oversized blanket").hasAttribute("role"));
    more.focus(); more.click(); await sleep(100);
    const more2 = btn(A, "Cozy oversized blanket", "more");
    t.check("expands accessibly", more2.getAttribute("aria-expanded") === "true" && !A.d.getElementById(more2.getAttribute("aria-controls")).hidden);
    t.check("focus stays on Details", A.d.activeElement === more2);
    const link = card(A, "Cozy oversized blanket").querySelector(".gift-link");
    t.check("shopping link opens safely in a new tab", link && link.target === "_blank" && link.rel.includes("noopener"));
    t.check("short text-only gift has no Details button", !btn(A, "Loose-leaf tea sampler", "more"));
    more2.click(); await sleep(100);

    t.section("Owner edits and removals, as family see them");
    const candle = (await claraGifts()).find((g) => g.name === "Winter candle set");
    await rpc(db, C, "owner_update_gift", { p_id: candle.id, p_name: "Winter candle set", p_details: "Pine or cedar only now", p_price: "$28" });
    await refocus(A); await refocus(B);
    t.check("claimant sees 'Updated since you claimed it'", /Updated since you claimed/.test(card(A, "Winter candle set").textContent));
    t.check("others don't", !/Updated since/.test(card(B, "Winter candle set").textContent));
    await rpc(db, C, "owner_archive_gift", { p_id: candle.id });
    await refocus(A); await refocus(B);
    t.check("removed gift disappears for others", !card(B, "Winter candle set"));
    t.check("claimant gets a small removal note", card(A, "Winter candle set")?.classList.contains("is-removed"));
    btn(A, "Winter candle set", "dismiss").click(); await sleep(500);
    t.check("note can be dismissed", !card(A, "Winter candle set"));

    t.section("Failures and retries");
    env.server.down = true;
    await refocus(B);
    t.check("offline: says so", /Can't reach the list/.test(B.d.getElementById("sync").textContent));
    t.check("offline: keeps showing the last known list", !!card(B, "Cozy oversized blanket"));
    btn(B, "Cozy oversized blanket", "claim").click(); await confirmYes(B); await sleep(300);
    t.check("offline claim: honest message", /Nothing has changed/.test(toast(B)), toast(B));
    t.check("offline claim: no fake state change", chip(B, "Cozy oversized blanket") === "Available");
    env.server.down = false;
    await refocus(B);
    t.check("recovers when back online", /Up to date/.test(B.d.getElementById("sync").textContent));
    env.server.loseNext = "claim_gift";
    btn(B, "Cozy oversized blanket", "claim").click(); await confirmYes(B); await sleep(500);
    t.check("lost reply: page re-checks and confirms it worked", /went through/i.test(toast(B)) && chip(B, "Cozy oversized blanket") === "Claimed by you", toast(B));
    env.server.down = true;
    const D = await open(env, "index.html", "D", "cameron");
    t.check("first load offline: notice with Try again", !!D.d.querySelector('#notice [data-role="retry"]'));
    env.server.down = false;
    D.d.querySelector('#notice [data-role="retry"]').click(); await sleep(500);
    t.check("Try again loads the list", D.d.querySelectorAll("#gifts > li").length === 4);
    const E = await open(env, "index.html", "E", "clara", { config: Object.assign({}, CONFIG, { supabaseUrl: "", supabasePublishableKey: "" }) });
    t.check("not configured: explains instead of breaking", /isn't connected yet/.test(E.d.getElementById("notice").textContent));
    const F = await open(env, "index.html", "F", "clara", { brokenStorage: true });
    t.check("blocked storage: still works, with a gentle warning", F.d.querySelectorAll("#gifts > li").length > 0 && /isn't saving site data/.test(F.d.getElementById("notice").textContent));

    t.section("Owner page");
    let O = await open(env, "manage.html", "owner-clara");
    t.check("signed out: sign-in form", !O.d.getElementById("signin").hidden);
    O.d.getElementById("signin-email").value = "clara@example.com";
    O.d.getElementById("signin-password").value = "wrong";
    O.d.getElementById("signin-form").requestSubmit(); await sleep(400);
    t.check("wrong password: friendly message", /don't match/.test(O.d.getElementById("signin-message").textContent));
    O.d.getElementById("signin-password").value = "clara-pw";
    O.d.getElementById("signin-form").requestSubmit(); await sleep(600);
    const ownerNames = () => [...O.d.querySelectorAll(".owner-gift .gift-name")].map((n) => n.textContent);
    t.check("Clara gets her themed editor", !O.d.getElementById("editor").hidden && O.d.body.dataset.theme === "clara");
    t.check("only her own gifts", ownerNames().length === 3 && !ownerNames().includes("Wireless headphones"), ownerNames().join(" | "));
    t.check("no claim or purchase status anywhere", !/claimed|purchased|available/i.test(O.d.getElementById("owner-gifts").textContent));
    O = await reopen(O);
    t.check("session persists across a reload", !O.d.getElementById("editor").hidden);

    O.d.getElementById("add-gift").click(); await sleep(100);
    t.check("add form opens with a themed header", O.d.getElementById("gift-dialog").open && O.d.getElementById("gift-form-kicker").textContent === "Clara's list" && /Only the name is needed/.test(O.d.getElementById("gift-form-lede").textContent));
    O.d.getElementById("gift-form").requestSubmit(); await sleep(200);
    t.check("empty name blocked, marked invalid", /name/i.test(O.d.getElementById("e-name").textContent) && O.d.getElementById("f-name").getAttribute("aria-invalid") === "true");
    O.d.getElementById("f-name").value = "Snow globe";
    O.d.getElementById("f-link").value = "javascript:alert(1)";
    O.d.getElementById("gift-form").requestSubmit(); await sleep(200);
    t.check("bad link blocked", /https/.test(O.d.getElementById("e-link").textContent) && O.d.getElementById("gift-dialog").open);
    O.d.getElementById("f-link").value = "https://shop.example.com/globe";
    O.d.getElementById("f-price").value = "~$40";
    O.d.getElementById("gift-form").requestSubmit(); await sleep(700);
    t.check("valid gift added at the bottom", !O.d.getElementById("gift-dialog").open && ownerNames()[ownerNames().length - 1] === "Snow globe");

    const row = (name) => [...O.d.querySelectorAll(".owner-gift")].find((li) => li.querySelector(".gift-name")?.textContent === name);
    row("Snow globe").querySelector('[data-role="edit"]').click(); await sleep(100);
    t.check("edit form pre-filled, with the 'new entry' reminder", O.d.getElementById("f-price").value === "~$40" && /A different gift deserves a new entry/.test(O.d.getElementById("gift-form-lede").textContent));
    O.d.getElementById("f-name").value = "Snow globe (small)";
    O.d.getElementById("gift-form").requestSubmit(); await sleep(700);
    t.check("edit saved", ownerNames().includes("Snow globe (small)") && !ownerNames().includes("Snow globe"));

    row("Snow globe (small)").querySelector('[data-role="move"]').click(); await sleep(100);
    t.check("Move offers up / down / top / bottom", row("Snow globe (small)").querySelectorAll(".move-panel button").length === 4);
    t.check("down/bottom disabled at the end", row("Snow globe (small)").querySelector('[data-role="move-bottom"]').disabled);
    row("Snow globe (small)").querySelector('[data-role="move-top"]').click(); await sleep(700);
    t.check("moved to top", ownerNames()[0] === "Snow globe (small)");
    t.check("focus stays in the move controls", !!(O.d.activeElement && O.d.activeElement.closest(".move-panel")));
    A.w.location.hash = "#cameron"; await sleep(300); A.w.location.hash = "#clara"; await sleep(700);
    t.check("family page follows the owner's order", A.d.querySelector("#gifts > li .gift-name").textContent === "Snow globe (small)");

    row("Snow globe (small)").querySelector('[data-role="remove"]').click(); await sleep(100);
    t.check("remove asks first", O.d.getElementById("confirm").open);
    await confirmYes(O); await sleep(300);
    t.check("removed, with Undo offered", !ownerNames().includes("Snow globe (small)") && !!O.d.querySelector("#toast .toast-action"));
    O.d.querySelector("#toast .toast-action").click(); await sleep(700);
    t.check("Undo brings it back", ownerNames().includes("Snow globe (small)"));

    await rpc(db, C, "owner_add_gift", { p_name: "<img src=x onerror=parent.__pwned=1>" });
    await refocus(A); await sleep(200);
    t.check("gift text is never run as HTML", !window.__pwned && [...A.d.querySelectorAll(".gift-name")].some((n) => n.textContent.startsWith("<img")));

    O.d.getElementById("add-gift").click(); await sleep(100);
    O.d.getElementById("f-name").value = "Offline gift";
    env.server.down = true;
    O.d.getElementById("gift-form").requestSubmit(); await sleep(500);
    t.check("offline save: form stays open, nothing lost", O.d.getElementById("gift-dialog").open && /aren't saved yet/.test(O.d.getElementById("gift-form-message").textContent));
    env.server.down = false;
    O.d.getElementById("gift-cancel").click(); await sleep(100);

    const s = JSON.parse(env.stores["owner-clara"]["sb-session"]); s.expired = true; env.stores["owner-clara"]["sb-session"] = JSON.stringify(s);
    row("A good mystery novel").querySelector('[data-role="move"]').click(); await sleep(100);
    row("A good mystery novel").querySelector('[data-role="move-bottom"]').click(); await sleep(600);
    t.check("expired session: back to sign-in with an explanation", !O.d.getElementById("signin").hidden && /session expired/i.test(O.d.getElementById("signin-message").textContent));

    const M = await open(env, "manage.html", "owner-cameron");
    M.d.getElementById("signin-email").value = "cameron@example.com";
    M.d.getElementById("signin-password").value = "cameron-pw";
    M.d.getElementById("signin-form").requestSubmit(); await sleep(600);
    const cam = [...M.d.querySelectorAll(".owner-gift .gift-name")].map((n) => n.textContent);
    t.check("Cameron gets only his list, in his theme", M.d.body.dataset.theme === "cameron" && cam.includes("Wireless headphones") && !cam.some((n) => /Snow globe|blanket/i.test(n)));
    M.d.getElementById("sign-out").click(); await sleep(400);
    const M2 = await reopen(M);
    t.check("signed out stays signed out", !M2.d.getElementById("signin").hidden);

    const X = await open(env, "manage.html", "owner-stray");
    X.d.getElementById("signin-email").value = "stray@example.com";
    X.d.getElementById("signin-password").value = "stray-pw";
    X.d.getElementById("signin-form").requestSubmit(); await sleep(600);
    t.check("unlinked account: told it has no list, no editor", !X.d.getElementById("nolist").hidden && X.d.getElementById("editor").hidden);

    const ownerCalls = env.server.calls.filter((c) => c.owner).map((c) => c.name);
    t.check("owner page only ever calls owner_* functions", ownerCalls.length > 0 && ownerCalls.every((n) => n.startsWith("owner_")), [...new Set(ownerCalls)].join(","));

    t.section("Live concurrency check page (run here against the test database)");
    const L = await open(env, "test/live-concurrency.html", "live");
    t.check("run button stays disabled until confirmed", L.d.getElementById("run").disabled);
    L.d.getElementById("ok").click();
    L.d.getElementById("run").click(); await sleep(1500);
    t.check("live check reports PASS and releases the gift", /PASS: exactly one of 8/.test(L.d.getElementById("out").textContent), L.d.getElementById("out").textContent);
  },
});
