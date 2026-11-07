/*
 * "Already Taken" area (claimed and purchased records both shown as Taken, and
 * released safely) and the public "Manage list" link.
 * Numbers in the check names refer to the acceptance cases (1–33, A–N).
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Taken area and Manage navigation",
  async run(t) {
    const { USERS, sleep, makeDb, makeEnv, open, reopen, rpc, card, chip, btn, toast, refocus, confirmYes,
      bought, boughtStatus, activeNames, boughtNames } = T;
    const { db } = await makeDb();
    const env = makeEnv(db);
    const C = USERS.clara.id, M = USERS.cameron.id;
    const ownerOrder = async (uid) => (await rpc(db, uid, "owner_list", {})).data.map((g) => g.name);
    const sortOrders = async (uid) => (await rpc(db, uid, "owner_list", {})).data.map((g) => g.id + ":" + g.sort_order).join();
    const purchasedCount = (dev) => dev.d.getElementById("purchased-count").textContent;
    const signIn = async (dev, who) => {
      dev.d.getElementById("signin-email").value = USERS[who].email;
      dev.d.getElementById("signin-password").value = USERS[who].password;
      dev.d.getElementById("signin-form").requestSubmit();
      await sleep(600);
    };

    const ordersBefore = await sortOrders(C);

    // -------------------------------------------------------------------
    t.section("Already Taken: both kinds of record");
    const P = await open(env, "index.html", "claimant", "clara");   // the browser that takes gifts
    const Q = await open(env, "index.html", "someone-else", "clara"); // another family member
    const yours = "You're getting this 🎁";
    const OTHER = "e".repeat(64);
    const pToken = () => env.stores["claimant"]["christmas-list-claim-token"];
    const giftIdOf = async (name) => (await rpc(db, C, "owner_list", {})).data.find((g) => g.name === name).id;
    const claimState = async (name) => { const r = await db.query("select c.state from public.claims c join public.gifts g on g.id = c.gift_id where g.name = $1", [name]); return r.rows[0] ? r.rows[0].state : "none"; };
    const counts = (dev) => dev.d.getElementById("summary").textContent.replace(/\s+/g, " ").trim();
    const calls = (from) => env.server.calls.slice(from).filter((c) => !c.owner && c.name !== "get_list").map((c) => c.name).join(",");

    t.check("1. available gifts are in the main list, in the owner's order", activeNames(P).join() === (await ownerOrder(C)).join());
    t.check("13. phones: nothing taken, so the section stays out of the way", getComputedStyle(P.d.getElementById("purchased")).display === "none");

    // Records as they already exist in the database: one claimed and one purchased by
    // someone else, and one this browser claimed that was later marked purchased.
    await rpc(db, null, "claim_gift", { p_gift_id: await giftIdOf("Cozy oversized blanket"), p_token: OTHER });
    await rpc(db, null, "mark_purchased", { p_gift_id: await giftIdOf("Cozy oversized blanket"), p_token: OTHER });
    await rpc(db, null, "claim_gift", { p_gift_id: await giftIdOf("Winter candle set"), p_token: OTHER });
    // Keyboard safety on the confirmation
    let claimsSent = env.server.calls.filter((c) => c.name === "claim_gift").length;
    btn(P, "A good mystery novel", "claim").focus();
    btn(P, "A good mystery novel", "claim").click(); await sleep(100);
    t.check("the dialog opens with \"Not now\" focused", P.d.activeElement === P.d.getElementById("confirm-no"), P.d.activeElement && P.d.activeElement.id);
    t.check("\"Not now\" comes before \"Yes, I'll get it!\"", P.d.getElementById("confirm-no").compareDocumentPosition(P.d.getElementById("confirm-yes")) & P.w.Node.DOCUMENT_POSITION_FOLLOWING);
    P.d.activeElement.click(); await sleep(150); // what pressing Enter straight away does
    t.check("pressing Enter straight away cancels", !P.d.getElementById("confirm").open && chip(P, "A good mystery novel") === "Available");
    btn(P, "A good mystery novel", "claim").click(); await sleep(100);
    P.d.getElementById("confirm").close(); await sleep(150); // what Escape does: it closes the dialog
    t.check("Escape cancels too", !P.d.getElementById("confirm").open && chip(P, "A good mystery novel") === "Available");
    t.check("neither sent anything", env.server.calls.filter((c) => c.name === "claim_gift").length === claimsSent);

    btn(P, "A good mystery novel", "claim").focus();
    const scrollBefore = P.w.scrollY;
    btn(P, "A good mystery novel", "claim").click(); await confirmYes(P);
    t.check("2. taking a gift moves it to Already Taken", !card(P, "A good mystery novel") && bought(P, "A good mystery novel") && boughtStatus(P, "A good mystery novel") === yours);
    t.check("phones: Already Taken opens by itself so it's easy to find", P.d.getElementById("purchased-details").open);
    const taken = bought(P, "A good mystery novel");
    t.check("keyboard focus lands on the gift's name, not on Make Available Again", P.d.activeElement === taken.querySelector(".bought-name") && P.d.activeElement.dataset.role === "name");
    t.check("the name is focusable from the page but isn't an extra Tab stop", taken.querySelector(".bought-name").tabIndex === -1);
    const releaseButton = taken.querySelector('[data-role="release"]');
    t.check("Make Available Again is the next control by keyboard", releaseButton.tabIndex === 0 && !releaseButton.disabled && (taken.querySelector(".bought-name").compareDocumentPosition(releaseButton) & P.w.Node.DOCUMENT_POSITION_FOLLOWING));
    t.check("the message is announced politely to screen readers", P.d.getElementById("toast").getAttribute("role") === "status" && P.d.getElementById("toast").getAttribute("aria-live") === "polite" && /You're getting this! It's in Already Taken/.test(P.d.getElementById("toast").textContent));
    t.check("...without jumping the page", P.w.scrollY === scrollBefore, P.w.scrollY + " vs " + scrollBefore);
    await rpc(db, null, "mark_purchased", { p_gift_id: await giftIdOf("A good mystery novel"), p_token: pToken() });
    await refocus(P); await refocus(Q);
    t.check("database still holds both kinds, untouched", (await claimState("Cozy oversized blanket")) === "purchased" && (await claimState("Winter candle set")) === "claimed" && (await claimState("A good mystery novel")) === "purchased");
    t.check("claimed and purchased records both show as Taken to others", ["Cozy oversized blanket", "Winter candle set", "A good mystery novel"].every((n) => boughtStatus(Q, n) === "Taken"));
    t.check("the taker sees its own, older purchased record as \"You're getting this\"", boughtStatus(P, "A good mystery novel") === yours && boughtStatus(P, "Cozy oversized blanket") === "Taken");
    t.check("only Available gifts stay in the main list", activeNames(P).join() === "Loose-leaf tea sampler");
    t.check("B. never in both places at once", !activeNames(P).some((n) => boughtNames(P).includes(n)));
    t.check("5. Already Taken keeps the owner's order, whatever the state", boughtNames(P).join() === "Cozy oversized blanket,A good mystery novel,Winter candle set", boughtNames(P).join());
    t.check("6. counts are \"1 available · 3 taken\"", counts(P) === "1 available · 3 taken" && purchasedCount(P) === "(3)", counts(P));
    t.check("C. other browsers get no controls at all", ["Cozy oversized blanket", "Winter candle set", "A good mystery novel"].every((n) => !bought(Q, n).querySelector("button")));
    t.check("C. not even for gifts this browser didn't take", !bought(P, "Cozy oversized blanket").querySelector("button") && !bought(P, "Winter candle set").querySelector("button"));
    const link = bought(P, "Cozy oversized blanket").querySelector(".bought-link");
    t.check("14. the shopping link is still in the compact row", link && link.href === "https://example.com/blanket" && link.target === "_blank" && link.rel.includes("noopener"));
    t.check("the database won't let another browser release it either", (await rpc(db, null, "release_claim", { p_gift_id: await giftIdOf("A good mystery novel"), p_token: OTHER })).data === "not_yours");

    t.section("Make Available Again");
    let from = env.server.calls.length;
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await sleep(100);
    t.check("the release dialog opens with \"Keep It\" focused, before \"Make Available\"", P.d.activeElement === P.d.getElementById("confirm-no") && P.d.getElementById("confirm-no").textContent === "Keep It" && (P.d.getElementById("confirm-no").compareDocumentPosition(P.d.getElementById("confirm-yes")) & P.w.Node.DOCUMENT_POSITION_FOLLOWING));
    P.d.activeElement.click(); await sleep(150); // pressing Enter straight away
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await sleep(100);
    P.d.getElementById("confirm").close(); await sleep(150); // Escape
    t.check("Enter straight away, or Escape, keeps the gift and sends nothing", boughtStatus(P, "A good mystery novel") === yours && calls(from) === "" && (await claimState("A good mystery novel")) === "purchased", calls(from));
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').focus();
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await confirmYes(P); await sleep(300);
    t.check("an older purchased record is released fully", chip(P, "A good mystery novel") === "Available" && (await claimState("A good mystery novel")) === "none");
    t.check("afterwards focus is on the gift's name back in the list, not on \"I'll get this!\"", P.d.activeElement === card(P, "A good mystery novel").querySelector(".gift-name"));
    t.check("...using the existing functions in a safe order", calls(from) === "release_claim,mark_not_purchased,release_claim", calls(from));
    t.check("10. it returns to the main list at its original position", activeNames(P).join() === "A good mystery novel,Loose-leaf tea sampler", activeNames(P).join());
    t.check("other people's records weren't touched", (await claimState("Cozy oversized blanket")) === "purchased" && (await claimState("Winter candle set")) === "claimed");
    t.check("K. none of this changed the stored order", (await sortOrders(C)) === ordersBefore);

    btn(P, "A good mystery novel", "claim").click(); await confirmYes(P);
    from = env.server.calls.length;
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await confirmYes(P); await sleep(300);
    t.check("a claimed record is released in one step", chip(P, "A good mystery novel") === "Available" && calls(from) === "release_claim", calls(from));

    // Stale screen: the page thinks it's only claimed, but it's purchased in the database.
    btn(P, "A good mystery novel", "claim").click(); await confirmYes(P);
    await rpc(db, null, "mark_purchased", { p_gift_id: await giftIdOf("A good mystery novel"), p_token: pToken() });
    bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await confirmYes(P); await sleep(300);
    t.check("stale screen: still released correctly", chip(P, "A good mystery novel") === "Available" && (await claimState("A good mystery novel")) === "none");

    t.section("Make Available Again when the connection fails");
    const realFetch = env.fetch;
    const failOn = (name, when, after) => { let seen = 0; env.fetch = async (url, opts) => {
      if (url.includes("/rpc/" + name) && ++seen === when) {
        if (after) { await realFetch(url, opts); }   // the server did it, but the reply was lost
        env.fetch = realFetch;
        throw new TypeError("Failed to fetch");
      }
      return realFetch(url, opts);
    }; };
    const takePurchased = async () => {
      btn(P, "A good mystery novel", "claim").click(); await confirmYes(P);
      await rpc(db, null, "mark_purchased", { p_gift_id: await giftIdOf("A good mystery novel"), p_token: pToken() });
      await refocus(P);
    };
    const release = async () => { bought(P, "A good mystery novel").querySelector('[data-role="release"]').click(); await confirmYes(P); await sleep(400); };

    await takePurchased();
    failOn("release_claim", 2, false); // fails after it was set back to claimed
    await release();
    t.check("fails partway: still Taken and still yours", boughtStatus(P, "A good mystery novel") === yours && (await claimState("A good mystery novel")) === "claimed");
    t.check("fails partway: an honest message", /nothing changed/i.test(toast(P)), toast(P));
    t.check("fails partway: nobody else can take it meanwhile", (await rpc(db, null, "claim_gift", { p_gift_id: await giftIdOf("A good mystery novel"), p_token: OTHER })).data === "taken");
    await release();
    t.check("trying again finishes the job", chip(P, "A good mystery novel") === "Available" && (await claimState("A good mystery novel")) === "none");

    await takePurchased();
    failOn("mark_not_purchased", 1, true); // done, but the reply was lost
    await release();
    t.check("lost reply partway: still yours, and it says to try again", boughtStatus(P, "A good mystery novel") === yours && /try again/i.test(toast(P)), toast(P));
    await release();
    t.check("lost reply partway: trying again works", chip(P, "A good mystery novel") === "Available");

    await takePurchased();
    failOn("release_claim", 2, true); // the final step worked, but its reply was lost
    await release();
    t.check("lost final reply: the page re-checks and confirms it worked", chip(P, "A good mystery novel") === "Available" && toast(P) === "It's available again.", toast(P));

    await takePurchased();
    env.server.down = true;
    await release();
    env.server.down = false;
    t.check("fully offline: nothing changes, and it says so", boughtStatus(P, "A good mystery novel") === yours && (await claimState("A good mystery novel")) === "purchased" && /Nothing has changed/.test(toast(P)), toast(P));
    await refocus(P);

    t.section("Gifts removed after someone took them");
    btn(P, "Loose-leaf tea sampler", "claim").click(); await confirmYes(P);
    await rpc(db, null, "mark_purchased", { p_gift_id: await giftIdOf("Loose-leaf tea sampler"), p_token: pToken() });
    const teaId = await giftIdOf("Loose-leaf tea sampler");
    await rpc(db, C, "owner_archive_gift", { p_id: teaId });
    await refocus(P); await refocus(Q);
    const note = bought(P, "Loose-leaf tea sampler");
    t.check("the taker gets a removal note in Already Taken", note && note.classList.contains("is-removed") && !card(P, "Loose-leaf tea sampler"));
    t.check("the note isn't counted as taken", purchasedCount(P) === "(3)", purchasedCount(P));
    const REMOVED = "This gift was removed from the list. If you've bought it, check with the recipient.";
    t.check("the note's wording doesn't name anyone", note.querySelector(".removed-msg").textContent === REMOVED, note.querySelector(".removed-msg").textContent);
    t.check("others don't see it at all", !bought(Q, "Loose-leaf tea sampler") && !card(Q, "Loose-leaf tea sampler"));
    t.check("the database won't let another browser dismiss it", (await rpc(db, null, "release_claim", { p_gift_id: teaId, p_token: OTHER })).data === "not_yours");
    note.querySelector('[data-role="dismiss"]').focus();
    note.querySelector('[data-role="dismiss"]').click(); await sleep(500);
    t.check("Dismiss still works, even for a gift marked purchased", !bought(P, "Loose-leaf tea sampler") && (await claimState("Loose-leaf tea sampler")) === "none");
    t.check("after dismissing, focus moves to the Already Taken heading", P.d.activeElement === P.d.querySelector("#purchased-details summary"));
    await rpc(db, C, "owner_restore_gift", { p_id: teaId });

    // The same note on Cameron's list
    const camGiftId = (await rpc(db, M, "owner_list", {})).data.find((g) => g.name === "Warm wool socks").id;
    await rpc(db, null, "claim_gift", { p_gift_id: camGiftId, p_token: pToken() });
    await rpc(db, M, "owner_archive_gift", { p_id: camGiftId });
    P.w.location.hash = "#cameron"; await sleep(600);
    const camNote = bought(P, "Warm wool socks");
    t.check("Cameron's list: the same wording", camNote && camNote.classList.contains("is-removed") && camNote.querySelector(".removed-msg").textContent === REMOVED);
    camNote.querySelector('[data-role="dismiss"]').click(); await sleep(500);
    t.check("Cameron's list: Dismiss works", !bought(P, "Warm wool socks"));
    await rpc(db, M, "owner_restore_gift", { p_id: camGiftId });
    P.w.location.hash = "#clara"; await sleep(600);

    // Phone default: compact and tucked away, but reachable
    const P2 = await reopen(P, "clara");
    const details = P2.d.getElementById("purchased-details");
    t.check("mobile: section follows the main list, collapsed to one line", !P2.d.getElementById("purchased").hidden && !details.open);
    const summary = details.querySelector("summary");
    summary.focus();
    t.check("32. the section toggle is keyboard-focusable", P2.d.activeElement === summary);
    summary.click(); await sleep(100);
    t.check("32. it opens and shows the rows", details.open && boughtNames(P2).length === 3);
    t.check("32. Make Available Again has an accessible name", bought(P2, "A good mystery novel").querySelector('[data-role="release"]').getAttribute("aria-label") === "Make A good mystery novel available again");
    t.check("32. the Manage link has a visible name", P2.d.querySelector(".list-foot a").textContent.trim() === "Manage list");

    // Desktop: always open, no toggle, and nothing scrolls on its own
    const W = await open(env, "index.html", "claimant", "clara", { width: 1280, height: 800 });
    const wd = W.d.getElementById("purchased-details");
    t.check("desktop: Already Taken is open from the start", wd.open);
    wd.querySelector("summary").click(); await sleep(100);
    t.check("desktop: its heading doesn't close it", wd.open && getComputedStyle(W.d.querySelector(".purchased-chevron")).display === "none");
    const takenList = W.d.getElementById("purchased-list");
    t.check("desktop: no separately scrolling list", getComputedStyle(takenList).overflowY === "visible" && takenList.scrollHeight <= takenList.clientHeight + 1);
    const WE = await open(env, "index.html", "desktop-empty", "cameron", { width: 1280, height: 800 });
    t.check("desktop: with nothing taken, the column says so quietly", getComputedStyle(WE.d.getElementById("purchased")).display !== "none" && !WE.d.getElementById("taken-empty").hidden && WE.d.getElementById("taken-empty").textContent === "Nothing taken yet.");
    WE.frame.remove();

    // Both themes
    await rpc(db, null, "claim_gift", { p_gift_id: (await rpc(db, M, "owner_list", {})).data[0].id, p_token: OTHER });
    await rpc(db, null, "mark_purchased", { p_gift_id: (await rpc(db, M, "owner_list", {})).data[0].id, p_token: OTHER });
    const themeMark = async (dev) => getComputedStyle(dev.d.querySelector("#purchased summary h2"), "::before").content;
    const claraMark = await themeMark(P2);
    const PC = await open(env, "index.html", "cameron-view", "cameron");
    t.check("15. Clara's area uses her theme (❄)", claraMark.includes("❄") && P2.d.body.dataset.theme === "clara");
    t.check("15. Cameron's area uses his theme (✦)", (await themeMark(PC)).includes("✦") && !PC.d.getElementById("purchased").hidden && boughtNames(PC).includes("Wireless headphones"));

    // The taker still holds an older purchased record (from the offline check), used by the owner-edit checks below.
    t.check("the taker's purchased record is still in place", (await claimState("A good mystery novel")) === "purchased" && boughtStatus(P2, "A good mystery novel") === yours);

    // -------------------------------------------------------------------
    t.section("Owner privacy");
    const O = await open(env, "manage.html", "claimant"); // same browser as the claimant
    await signIn(O, "clara");
    const ownerText = O.d.getElementById("owner-gifts").textContent;
    t.check("20. owner sees only Clara's list", !O.d.getElementById("editor").hidden && !/headphones|socks/i.test(ownerText));
    t.check("16 / D. no claim status on the owner page", !/claimed/i.test(O.d.body.textContent));
    t.check("17 / E. no purchase status on the owner page", !/purchased|bought/i.test(O.d.getElementById("owner-gifts").textContent));
    t.check("16–17. purchased gifts are listed like any other", ownerText.includes("A good mystery novel") && ownerText.includes("Cozy oversized blanket") && !O.d.querySelector(".bought, .chip, #purchased"));
    const ownerCalls = env.server.calls.filter((c) => c.owner);
    t.check("18 / F. owner page never asks for claim data or sends a browser token", ownerCalls.every((c) => c.name.startsWith("owner_") && !("p_token" in (c.args || {}))), [...new Set(ownerCalls.map((c) => c.name))].join());

    // Edit a purchased gift through the owner UI
    const row = (name) => [...O.d.querySelectorAll(".owner-gift")].find((li) => li.querySelector(".gift-name").textContent === name);
    row("A good mystery novel").querySelector('[data-role="edit"]').click(); await sleep(100);
    O.d.getElementById("f-details").value = "Anything twisty. Hardcover please.";
    O.d.getElementById("gift-form").requestSubmit(); await sleep(700);
    await refocus(P2); await refocus(Q);
    t.check("19 / L. editing a gift keeps its stored purchase record", (await claimState("A good mystery novel")) === "purchased");
    t.check("19 / L. the taker still sees \"You're getting this\"", boughtStatus(P2, "A good mystery novel") === yours);
    t.check("19 / L. ...and everyone else \"Taken\"", boughtStatus(Q, "A good mystery novel") === "Taken");
    t.check("19. the taker gets the 'updated since you chose it' note", /Updated since you chose it/.test(bought(P2, "A good mystery novel").textContent));
    t.check("K. owner edit didn't reorder anything", (await sortOrders(C)) === ordersBefore);

    // -------------------------------------------------------------------
    t.section("Manage navigation");
    const door = await open(env, "index.html", "visitor");
    const doorLink = door.d.querySelector(".door-foot a");
    t.check("front door has a quiet 'Manage list' link", doorLink.textContent.trim() === "Manage list" && doorLink.getAttribute("href") === "manage.html");
    for (const who of ["clara", "cameron"]) {
      door.w.location.hash = "#" + who; await sleep(500);
      const a = door.d.querySelector(".list-foot a");
      t.check(`${who}'s list has the 'Manage list' link`, a && a.textContent.trim() === "Manage list" && a.getAttribute("href") === "manage.html" && a.offsetParent !== null);
    }
    // Following the link = opening manage.html in the same browser
    const V = await open(env, door.d.querySelector(".list-foot a").getAttribute("href"), "visitor");
    t.check("21 / I. not signed in -> sign-in page, no editor", !V.d.getElementById("signin").hidden && V.d.getElementById("editor").hidden);
    t.check("I. no gifts or controls are shown without signing in", V.d.querySelectorAll(".owner-gift").length === 0 && V.d.getElementById("sign-out").hidden);

    const CL = await open(env, "manage.html", "clara-browser");
    await signIn(CL, "clara");
    const CLpub = await open(env, "index.html", "clara-browser", "cameron"); // Clara browsing Cameron's public list
    const CLnav = await open(env, CLpub.d.querySelector(".list-foot a").getAttribute("href"), "clara-browser");
    t.check("22. signed-in Clara -> straight to Clara's editor", !CLnav.d.getElementById("editor").hidden && CLnav.d.getElementById("editor-kicker").textContent.startsWith("Clara's list") && CLnav.d.body.dataset.theme === "clara");
    const CLhack = await open(env, "manage.html", "clara-browser", "cameron");
    t.check("24 / G. Clara opening manage.html#cameron still only gets Clara's list", CLhack.d.getElementById("editor-kicker").textContent.startsWith("Clara's list") && ![...CLhack.d.querySelectorAll(".owner-gift .gift-name")].some((n) => n.textContent === "Bonsai pruning shears"));
    const camGift = (await rpc(db, M, "owner_list", {})).data[0].id;
    t.check("G. and Clara's login can't edit Cameron's gift at all", (await rpc(db, C, "owner_update_gift", { p_id: camGift, p_name: "Hacked" })).error?.code === "P0002");

    const CA = await open(env, "manage.html", "cameron-browser");
    await signIn(CA, "cameron");
    const CAnav = await open(env, "manage.html", "cameron-browser");
    t.check("23. signed-in Cameron -> straight to Cameron's editor", !CAnav.d.getElementById("editor").hidden && CAnav.d.getElementById("editor-kicker").textContent.startsWith("Cameron's list") && CAnav.d.body.dataset.theme === "cameron");
    const CAhack = await open(env, "manage.html", "cameron-browser", "clara");
    t.check("25 / H. Cameron opening manage.html#clara still only gets Cameron's list", CAhack.d.getElementById("editor-kicker").textContent.startsWith("Cameron's list") && ![...CAhack.d.querySelectorAll(".owner-gift .gift-name")].some((n) => n.textContent === "Loose-leaf tea sampler"));
    const clGift = (await rpc(db, C, "owner_list", {})).data[0].id;
    t.check("H. and Cameron's login can't edit Clara's gift at all", (await rpc(db, M, "owner_update_gift", { p_id: clGift, p_name: "Hacked" })).error?.code === "P0002");

    const back = CLnav.d.querySelector('.manage-top a[href="index.html"]');
    t.check("26. owner page links back to the family page", !!back);
    const BK = await open(env, back.getAttribute("href"), "clara-browser");
    t.check("26. which opens the public front door", !BK.d.getElementById("door").hidden && BK.d.body.dataset.theme === "home");

    BK.w.location.hash = "#clara"; await sleep(500);
    t.check("27. signed-in owner sees no Edit/Move/Remove on public pages", !BK.d.querySelector('.owner-actions, [data-role="edit"], [data-role="move"], [data-role="remove"]'));
    t.check("27. public page never starts the sign-in client", !env.clientsCreated.includes("index.html"));
    t.check("27. public page looks the same for an owner (normal family view)", BK.d.querySelectorAll("#gifts > li").length === Q.d.querySelectorAll("#gifts > li").length);

    // -------------------------------------------------------------------
    t.section("Finding a gift after taking it");
    const TAKEN = "🎁 You're getting this! It's in Already Taken.";
    // Pin the motion setting for one page, and record how it scrolls.
    const pinMotion = (dev, reduced) => {
      const realMatch = dev.w.matchMedia.bind(dev.w);
      dev.w.matchMedia = (q) => (/reduced-motion/.test(q) ? { matches: reduced } : realMatch(q));
      dev.scrolls = [];
      const realScroll = dev.w.Element.prototype.scrollIntoView;
      dev.w.Element.prototype.scrollIntoView = function (options) { dev.scrolls.push(Object.assign({ target: this }, options)); return realScroll.call(this, options); };
    };
    const onScreen = (dev, el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < dev.w.innerHeight; };
    const toastButton = (dev) => dev.d.querySelector("#toast .toast-action");
    const toastShown = (dev) => dev.d.getElementById("toast").classList.contains("is-visible");
    const toTopOfList = (dev) => dev.w.scrollTo(0, dev.d.querySelector(".list-head").getBoundingClientRect().top + dev.w.scrollY - 8);

    // A long list (in the test database only), so Already Taken is screens away from the top.
    for (let i = 1; i <= 12; i++) {
      await db.query("insert into public.gifts (recipient, name, details, price, sort_order) values ('cameron', $1, 'Filler so the list is long.', '$5', $2)", ["Filler gift " + i, 1000 + i]);
    }


    // Far from Already Taken: a short phone screen, at the top of the list.
    const S = await open(env, "index.html", "showme-a", "cameron", { width: 390, height: 420 });
    pinMotion(S, false);
    toTopOfList(S); await sleep(100);
    const scrollAt = S.w.scrollY;
    btn(S, "Bonsai pruning shears", "claim").click(); await confirmYes(S); await sleep(150);
    const farRow = bought(S, "Bonsai pruning shears");
    t.check("setup: the gift's new row is off screen", !!farRow && !onScreen(S, farRow));
    t.check("off screen: the usual message, plus \"Show me\"", toast(S) === TAKEN && !!toastButton(S) && toastButton(S).textContent === "Show me", toast(S));
    t.check("\"Show me\" has a clear accessible name", toastButton(S).getAttribute("aria-label") === "Show me the gift in Already Taken");
    t.check("\"Show me\" is a real button, reachable by keyboard", toastButton(S).tagName === "BUTTON" && toastButton(S).tabIndex === 0);
    t.check("\"Show me\" is at least 44px tall", toastButton(S).getBoundingClientRect().height >= 43.5, toastButton(S).getBoundingClientRect().height);
    t.check("one message, announced once (the live region holds just the message and the button)", S.d.getElementById("toast").children.length === 2 && S.d.getElementById("toast").getAttribute("aria-live") === "polite");
    t.check("the page itself didn't move", S.w.scrollY === scrollAt && S.scrolls.length === 0);
    t.check("Already Taken still opened by itself", S.d.getElementById("purchased-details").open);
    await sleep(4700);
    t.check("with \"Show me\", the message stays longer than the usual 4 seconds", toastShown(S) && !!toastButton(S));
    toastButton(S).click(); await sleep(300);
    // This runner fast-forwards its clock, which stalls smooth-scroll animations, so here we
    // check the request itself; the reduced-motion case below checks the gift arriving on screen.
    t.check("\"Show me\" scrolls to that gift's row", S.scrolls.length === 1 && S.scrolls[0].target === bought(S, "Bonsai pruning shears"), S.scrolls.length);
    t.check("...smoothly, for viewers who haven't asked for less motion", S.scrolls[0] && S.scrolls[0].behavior === "smooth" && S.scrolls[0].block === "center");
    t.check("...and puts focus on its name", S.d.activeElement === bought(S, "Bonsai pruning shears").querySelector(".bought-name"));
    t.check("the message closes, and its button is gone", !toastShown(S) && !toastButton(S));

    // The same, for someone who asked for less motion.
    const T2 = await open(env, "index.html", "showme-b", "cameron", { width: 390, height: 420 });
    pinMotion(T2, true);
    toTopOfList(T2); await sleep(100);
    btn(T2, "Fancy coffee beans", "claim").click(); await confirmYes(T2); await sleep(150);
    t.check("reduced motion: \"Show me\" is offered too", !!toastButton(T2));
    toastButton(T2).click(); await sleep(300);
    t.check("reduced motion: it jumps straight there, without animating", T2.scrolls[0] && T2.scrolls[0].behavior === "auto" && onScreen(T2, bought(T2, "Fancy coffee beans")));
    t.check("reduced motion: focus is on the gift's name", T2.d.activeElement === bought(T2, "Fancy coffee beans").querySelector(".bought-name"));

    // Ignored: the message simply goes away.
    const U = await open(env, "index.html", "showme-c", "cameron", { width: 390, height: 420 });
    pinMotion(U, false);
    toTopOfList(U); await sleep(100);
    btn(U, "Warm wool socks", "claim").click(); await confirmYes(U); await sleep(150);
    const uScroll = U.w.scrollY;
    t.check("setup: \"Show me\" offered", !!toastButton(U));
    await sleep(7300);
    t.check("left alone, it disappears after about 7 seconds", !toastShown(U));
    t.check("...taking its button with it, so Tab can't reach an invisible button", !toastButton(U));
    t.check("...and the page never moved", U.w.scrollY === uScroll && U.scrolls.length === 0);

    // Already in view: just the short message.
    const NEAR = await open(env, "index.html", "showme-d", "clara", { width: 390, height: 844 });
    pinMotion(NEAR, false);
    NEAR.w.scrollTo(0, NEAR.d.documentElement.scrollHeight); await sleep(150);
    btn(NEAR, "Loose-leaf tea sampler", "claim").click(); await confirmYes(NEAR); await sleep(150);
    const nearRow = bought(NEAR, "Loose-leaf tea sampler");
    t.check("setup: the gift's new row is on screen", !!nearRow && onScreen(NEAR, nearRow));
    t.check("on screen: the message without \"Show me\"", toast(NEAR) === TAKEN && !toastButton(NEAR));
    await sleep(3300);
    t.check("on screen: still showing at about 3 seconds", toastShown(NEAR));
    await sleep(1300);
    t.check("on screen: gone after the usual 4 seconds", !toastShown(NEAR));
    t.check("on screen: nothing scrolled", NEAR.scrolls.length === 0);
    t.check("these claims used only the usual functions", (await rpc(db, null, "get_list", { p_token: "f".repeat(64) })).data.filter((g) => ["Bonsai pruning shears", "Fancy coffee beans", "Warm wool socks", "Loose-leaf tea sampler"].includes(g.name)).every((g) => g.status === "claimed"));

    // -------------------------------------------------------------------
    t.section("Security model unchanged");
    const publicCalls = env.server.calls.filter((c) => !c.owner).map((c) => c.name);
    const allowed = new Set(["get_list", "claim_gift", "release_claim", "mark_purchased", "mark_not_purchased"]);
    t.check("M. family page only uses the five approved functions (no table writes)", publicCalls.length > 0 && publicCalls.every((n) => allowed.has(n)), [...new Set(publicCalls)].join());
    t.check("M. every family request goes to /rpc/, never a table", env.server.calls.filter((c) => !c.owner).every((c) => /\/rest\/v1\/rpc\//.test(c.url)));
    const direct = await T.asRole(db, null, "update public.claims set state = 'claimed'").then(() => "allowed", (e) => "blocked");
    t.check("N. direct claim-table writes are still blocked", direct === "blocked");
  },
});
