/*
 * "Already purchased" area and the public "Manage list" link.
 * Numbers in the check names refer to the acceptance cases (1–33, A–N).
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Purchased area and Manage navigation",
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
    t.section("Main list vs Already purchased");
    const P = await open(env, "index.html", "claimant", "clara");   // the browser that claims
    const Q = await open(env, "index.html", "someone-else", "clara"); // another family member
    t.check("1. available gifts are in the main list", activeNames(P).join() === (await ownerOrder(C)).join());
    t.check("13. no purchased gifts -> section hidden entirely", P.d.getElementById("purchased").hidden);

    btn(P, "A good mystery novel", "claim").click(); await confirmYes(P);
    t.check("2. claimed-but-not-purchased stays in the main list", chip(P, "A good mystery novel") === "Claimed by you");
    t.check("8 / A. claiming does not move it to Already purchased", !bought(P, "A good mystery novel") && P.d.getElementById("purchased").hidden);

    const purchaseButton = btn(P, "A good mystery novel", "purchase");
    purchaseButton.focus(); purchaseButton.click(); await sleep(500); // as a keyboard user would
    t.check("9. marking purchased moves it to Already purchased", !!bought(P, "A good mystery novel"));
    t.check("3. it no longer appears as a full-size card", !card(P, "A good mystery novel"));
    t.check("B. it is never in both places at once", activeNames(P).concat(boughtNames(P)).filter((n) => n === "A good mystery novel").length === 1);
    t.check("4 / 12. claimant sees 'Purchased by you' with an Undo control", boughtStatus(P, "A good mystery novel") === "Purchased by you" && !!bought(P, "A good mystery novel").querySelector('[data-role="unpurchase"]'));
    t.check("purchase message explains where it went", /Already purchased/.test(toast(P)), toast(P));
    t.check("area opens to show where it went", P.d.getElementById("purchased-details").open);
    t.check("32. keyboard focus follows the gift to its new place (its Undo button)", P.d.activeElement && P.d.activeElement.dataset.role === "unpurchase", P.d.activeElement && P.d.activeElement.outerHTML.slice(0, 80));

    await refocus(Q);
    t.check("4. other browsers also see it under Already purchased", boughtStatus(Q, "A good mystery novel") === "Purchased" && !card(Q, "A good mystery novel"));
    t.check("C. other browsers get no Undo control", !bought(Q, "A good mystery novel").querySelector("button"));
    t.check("other browsers never see who bought it", !/by you/i.test(bought(Q, "A good mystery novel").textContent));

    // A second purchase, made by the other browser
    btn(Q, "Cozy oversized blanket", "claim").click(); await confirmYes(Q);
    btn(Q, "Cozy oversized blanket", "purchase").click(); await sleep(500);
    await refocus(P);
    t.check("5. several purchased gifts are listed", boughtNames(P).length === 2);
    t.check("5. listed in the owner's order", boughtNames(P).join() === "Cozy oversized blanket,A good mystery novel", boughtNames(P).join());
    t.check("6. purchased count is correct", purchasedCount(P) === "(2)" && /2 purchased/.test(P.d.getElementById("summary").textContent));
    const availableShown = [...P.d.querySelectorAll("#gifts > li .chip")].filter((c) => c.textContent === "Available").length;
    t.check("7. available count still matches the list", /2 available/.test(P.d.getElementById("summary").textContent) && availableShown === 2, P.d.getElementById("summary").textContent);
    t.check("C. this browser can't undo the other browser's purchase", !bought(P, "Cozy oversized blanket").querySelector("button") && boughtStatus(P, "Cozy oversized blanket") === "Purchased");
    const link = bought(P, "Cozy oversized blanket").querySelector(".bought-link");
    t.check("14. product link still available in the compact row", link && link.href === "https://example.com/blanket" && link.target === "_blank" && link.rel.includes("noopener"));

    bought(P, "A good mystery novel").querySelector('[data-role="unpurchase"]').click(); await sleep(500);
    t.check("10. marking not purchased moves it back to the main list", chip(P, "A good mystery novel") === "Claimed by you" && !bought(P, "A good mystery novel"));
    const expectedOrder = (await ownerOrder(C)).filter((n) => n !== "Cozy oversized blanket");
    t.check("11. it returns to its original position", activeNames(P).join() === expectedOrder.join(), activeNames(P).join());
    t.check("K. none of this changed the stored order", (await sortOrders(C)) === ordersBefore);

    btn(P, "A good mystery novel", "purchase").click(); await sleep(500);

    // Phone default: compact and tucked away, but reachable
    const P2 = await reopen(P, "clara");
    const details = P2.d.getElementById("purchased-details");
    t.check("mobile: section follows the main list, collapsed to one line", !P2.d.getElementById("purchased").hidden && !details.open);
    const summary = details.querySelector("summary");
    summary.focus();
    t.check("32. the section toggle is keyboard-focusable", P2.d.activeElement === summary);
    summary.click(); await sleep(100);
    t.check("32. it opens and shows the rows", details.open && boughtNames(P2).length === 2);
    t.check("32. Undo has an accessible name", bought(P2, "A good mystery novel").querySelector('[data-role="unpurchase"]').getAttribute("aria-label") === "Mark A good mystery novel as not purchased");
    t.check("32. the Manage link has a visible name", P2.d.querySelector(".list-foot a").textContent.trim() === "Manage list");

    // Both themes
    await rpc(db, null, "claim_gift", { p_gift_id: (await rpc(db, M, "owner_list", {})).data[0].id, p_token: "e".repeat(64) });
    await rpc(db, null, "mark_purchased", { p_gift_id: (await rpc(db, M, "owner_list", {})).data[0].id, p_token: "e".repeat(64) });
    const themeMark = async (dev) => getComputedStyle(dev.d.querySelector("#purchased summary h2"), "::before").content;
    const claraMark = await themeMark(P2);
    const PC = await open(env, "index.html", "cameron-view", "cameron");
    t.check("15. Clara's area uses her theme (❄)", claraMark.includes("❄") && P2.d.body.dataset.theme === "clara");
    t.check("15. Cameron's area uses his theme (✦)", (await themeMark(PC)).includes("✦") && !PC.d.getElementById("purchased").hidden && boughtNames(PC).includes("Wireless headphones"));

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
    t.check("19 / L. editing a purchased gift keeps it purchased (claimant)", boughtStatus(P2, "A good mystery novel") === "Purchased by you");
    t.check("19 / L. ...and for everyone else", boughtStatus(Q, "A good mystery novel") === "Purchased");
    t.check("19. claimant gets the 'updated since you claimed' note", /Updated since you claimed/.test(bought(P2, "A good mystery novel").textContent));
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
    t.section("Security model unchanged");
    const publicCalls = env.server.calls.filter((c) => !c.owner).map((c) => c.name);
    const allowed = new Set(["get_list", "claim_gift", "release_claim", "mark_purchased", "mark_not_purchased"]);
    t.check("M. family page only uses the five approved functions (no table writes)", publicCalls.length > 0 && publicCalls.every((n) => allowed.has(n)), [...new Set(publicCalls)].join());
    t.check("M. every family request goes to /rpc/, never a table", env.server.calls.filter((c) => !c.owner).every((c) => /\/rest\/v1\/rpc\//.test(c.url)));
    const direct = await T.asRole(db, null, "update public.claims set state = 'claimed'").then(() => "allowed", (e) => "blocked");
    t.check("N. direct claim-table writes are still blocked", direct === "blocked");
  },
});
