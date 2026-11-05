/*
 * v1.1 UX: inline thumbnails, viewer-only sorting, and one-tap owner reordering.
 * Same rules as the other suites: the real pages and setup.sql, a database in
 * this browser tab, and nothing that touches the live project.
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "UX: thumbnails, sorting and owner reordering",
  async run(t) {
    const { USERS, sleep, makeDb, makeEnv, open, rpc, card, chip, btn, refocus, confirmYes, bought, activeNames, boughtNames } = T;
    const { db } = await makeDb({ samples: false });
    const env = makeEnv(db);
    const C = USERS.clara.id, M = USERS.cameron.id;
    const OTHER = "e".repeat(64);

    // A real, non-square picture, pinned to a commit. The tests already need the CDN for PGlite.
    const IMG = "https://cdn.jsdelivr.net/gh/drennanarchive/unfold@ed1e1085d8b351250b747351c4fbf00c1198d975/christmas-list/assets/clara-winter-mobile.webp";
    const BAD_IMG = "https://example.invalid/not-a-picture.png";

    const CLARA = [
      ["Zebra mug", "$30", IMG],
      ["apple press", "$69 - $157", IMG],
      ["Mystery surprise", "any", null],
      ["Banana stand", "$10", IMG],
      ["Unpriced thing", null, null],
      ["Cherry pitter", "$30", IMG],
      ["Shoes", "size 10", null],
      ["Date box", "$ 10", null],
      ["Failing picture", "$55 (min)", BAD_IMG],
    ];
    const CAMERON = [["Moss kit", "$5", IMG], ["Aardvark book", "$500", null]];
    for (const [recipient, list] of [["clara", CLARA], ["cameron", CAMERON]]) {
      for (let i = 0; i < list.length; i++) {
        await db.query("insert into public.gifts (recipient, name, price, image_url, sort_order) values ($1, $2, $3, $4, $5)",
          [recipient, list[i][0], list[i][1], list[i][2], i + 1]);
      }
    }
    const ownerOrder = async (uid) => (await rpc(db, uid, "owner_list", {})).data.map((g) => g.name);
    const storedRows = async () => JSON.stringify((await db.query("select id, sort_order, image_url from public.gifts order by id")).rows);
    const setSort = async (dev, value) => {
      const s = dev.d.getElementById("gift-sort");
      s.value = value;
      s.dispatchEvent(new dev.w.Event("change", { bubbles: true }));
      await sleep(80);
    };
    const signIn = async (dev, who) => {
      dev.d.getElementById("signin-email").value = USERS[who].email;
      dev.d.getElementById("signin-password").value = USERS[who].password;
      dev.d.getElementById("signin-form").requestSubmit();
      await sleep(600);
    };
    const buyAs = async (uid, name) => {
      const g = (await rpc(db, uid, "owner_list", {})).data.find((x) => x.name === name);
      await rpc(db, null, "claim_gift", { p_gift_id: g.id, p_token: OTHER });
      await rpc(db, null, "mark_purchased", { p_gift_id: g.id, p_token: OTHER });
      return g.id;
    };
    const undoBuy = async (id) => {
      await rpc(db, null, "mark_not_purchased", { p_gift_id: id, p_token: OTHER });
      await rpc(db, null, "release_claim", { p_gift_id: id, p_token: OTHER });
    };

    // -------------------------------------------------------------------
    t.section("Reading prices");
    const A = await open(env, "index.html", "viewer-a", "clara", { width: 390, height: 844 });
    const price = A.w.XL.priceValue;
    [["$60", 60], ["$99.98", 99.98], ["$69 - $157", 69], ["$69–$157", 69], ["$ 10", 10], ["$55 (min)", 55], ["~$20", 20], ["$90–120", 90],
      ["$1,200", 1200], ["$0", 0], ["$157 - $69", 69], ["about $40", 40], ["under $25", 25], ["$50+", 50], ["$30/month", 30],
      ["50", 50], ["~50", 50], ["90-120", 90], ["90 to 120", 90], ["20-$30", 20], ["about 20 dollars", 20], ["2 for $30", 30]]
      .forEach(([text, want]) => t.check(`"${text}" sorts as ${want}`, price(text) === want, price(text)));
    ["any", "", null, undefined, "Free", "TBD", "size 10", "3-pack", "pack of 6", "2 for 30", "12 oz", "top 10", "$"]
      .forEach((text) => t.check(`${JSON.stringify(text)} is not a price`, price(text) === null, price(text)));

    // -------------------------------------------------------------------
    t.section("Sorting");
    const OWNER = await ownerOrder(C);
    const select = A.d.getElementById("gift-sort");
    t.check("the control is a labelled, native select", select.tagName === "SELECT" && select.closest("label").textContent.includes("Sort by"));
    t.check("offers exactly the four orders", [...select.options].map((o) => o.textContent).join("|") === "Default order|Price: low to high|Price: high to low|Name: A–Z");
    t.check("starts on Default, in the owner's order", select.value === "default" && activeNames(A).join() === OWNER.join(), activeNames(A).join());

    const storedBefore = await storedRows();
    const idsByName = () => Object.fromEntries([...A.d.querySelectorAll("#gifts > li")].map((li) => [li.querySelector(".gift-name").textContent, li.dataset.id]));
    const idsBefore = JSON.stringify(Object.entries(idsByName()).sort());
    const callsBefore = env.server.calls.length;

    const NO_PRICE = ["Mystery surprise", "Unpriced thing", "Shoes"];
    await setSort(A, "price-asc");
    t.check("low to high: lowest of a range, ties in owner order, no price last",
      activeNames(A).join() === ["Banana stand", "Date box", "Zebra mug", "Cherry pitter", "Failing picture", "apple press", ...NO_PRICE].join(), activeNames(A).join());
    await setSort(A, "price-desc");
    t.check("high to low: ties in owner order, no price still last",
      activeNames(A).join() === ["apple press", "Failing picture", "Zebra mug", "Cherry pitter", "Banana stand", "Date box", ...NO_PRICE].join(), activeNames(A).join());
    await setSort(A, "name");
    t.check("A–Z ignores capitals", activeNames(A).join() === ["apple press", "Banana stand", "Cherry pitter", "Date box", "Failing picture", "Mystery surprise", "Shoes", "Unpriced thing", "Zebra mug"].join(), activeNames(A).join());
    t.check("each card keeps its own gift id", JSON.stringify(Object.entries(idsByName()).sort()) === idsBefore);
    await setSort(A, "default");
    t.check("switching back restores the owner's order", activeNames(A).join() === OWNER.join(), activeNames(A).join());
    t.check("sorting makes no requests at all", env.server.calls.length === callsBefore, env.server.calls.slice(callsBefore).map((c) => c.name).join());
    t.check("sorting changes nothing stored", (await storedRows()) === storedBefore);

    await setSort(A, "price-asc");
    await refocus(A);
    t.check("a background refresh keeps the chosen sort", A.d.getElementById("gift-sort").value === "price-asc" && activeNames(A)[0] === "Banana stand");
    A.w.location.hash = "#cameron"; await sleep(500);
    t.check("the other person's list shows only their gifts", activeNames(A).join() === "Moss kit,Aardvark book", activeNames(A).join());
    t.check("changing person starts back on Default", A.d.getElementById("gift-sort").value === "default");
    await setSort(A, "name");
    t.check("sorting never mixes the two lists", activeNames(A).join() === "Aardvark book,Moss kit", activeNames(A).join());
    A.w.location.hash = "#clara"; await sleep(500);
    t.check("back on Clara: Default, her gifts only", A.d.getElementById("gift-sort").value === "default" && activeNames(A).join() === OWNER.join());

    t.section("Sorting and the claim lifecycle");
    const B = await open(env, "index.html", "viewer-b", "clara", { width: 390, height: 844 });
    await setSort(A, "price-desc");
    const cherryId = card(A, "Cherry pitter").dataset.id;
    btn(A, "Cherry pitter", "claim").click(); await confirmYes(A); await sleep(200);
    t.check("claiming from a sorted list claims the right gift", chip(A, "Cherry pitter") === "Claimed by you" && card(A, "Cherry pitter").dataset.id === cherryId);
    const row = (await rpc(db, null, "get_list", { p_token: OTHER })).data.find((g) => g.name === "Cherry pitter");
    t.check("the database agrees, and no other gift changed", row.id === cherryId && row.status === "claimed" &&
      (await rpc(db, null, "get_list", { p_token: OTHER })).data.filter((g) => g.status !== "available").length === 1);
    t.check("the sort holds after claiming", A.d.getElementById("gift-sort").value === "price-desc" && activeNames(A)[2] === "Zebra mug" && activeNames(A)[3] === "Cherry pitter", activeNames(A).join());
    await refocus(B);
    t.check("another browser sees Claimed, never who", chip(B, "Cherry pitter") === "Claimed" && !btn(B, "Cherry pitter", "release") && !btn(B, "Cherry pitter", "claim"));
    await setSort(B, "name");
    t.check("its actions stay correct when sorted", chip(B, "Cherry pitter") === "Claimed" && !btn(B, "Cherry pitter", "release") && !!btn(B, "Zebra mug", "claim"));
    t.check("the claimant still has its own controls", !!btn(A, "Cherry pitter", "purchase") && !!btn(A, "Cherry pitter", "release"));

    btn(A, "Cherry pitter", "purchase").click(); await sleep(500);
    const bananaId = await buyAs(C, "Banana stand");
    await refocus(A);
    t.check("purchased gifts leave the sorted list", !card(A, "Cherry pitter") && !card(A, "Banana stand"));
    t.check("Already purchased keeps the owner's order, whatever the sort", boughtNames(A).join() === "Banana stand,Cherry pitter", boughtNames(A).join());
    t.check("purchase ownership survives sorting", !!bought(A, "Cherry pitter").querySelector('[data-role="unpurchase"]') && !bought(A, "Banana stand").querySelector("button"));
    bought(A, "Cherry pitter").querySelector('[data-role="unpurchase"]').click(); await sleep(500);
    btn(A, "Cherry pitter", "release").click(); await confirmYes(A); await sleep(200);
    await undoBuy(bananaId);
    await setSort(A, "default"); await refocus(A);
    t.check("after undoing, everything is back in the owner's order", activeNames(A).join() === OWNER.join() && A.d.getElementById("purchased").hidden, activeNames(A).join());

    // -------------------------------------------------------------------
    t.section("Thumbnails");
    const thumb = (dev, name) => card(dev, name).querySelector(".gift-thumb");
    t.check("a gift with a picture shows it without expanding", !!thumb(A, "Zebra mug") && thumb(A, "Zebra mug").getAttribute("src") === IMG && card(A, "Zebra mug").querySelector(".gift-extra").hidden);
    t.check("a gift without a picture gets no image or frame", !card(A, "Unpriced thing").querySelector("img") && !card(A, "Unpriced thing").classList.contains("has-thumb"));
    t.check("no empty space where a picture would be",
      card(A, "Unpriced thing").querySelector(".gift-text").getBoundingClientRect().left - card(A, "Unpriced thing").getBoundingClientRect().left < 20);
    const z = thumb(A, "Zebra mug");
    t.check("loads lazily, without leaking the page address", z.loading === "lazy" && z.referrerPolicy === "no-referrer");
    t.check("space is held before it loads", z.getAttribute("width") === "52" && z.getAttribute("height") === "52");
    t.check("decorative to screen readers (the name is right beside it)", z.getAttribute("alt") === "");
    t.check("never stretched or cropped", A.w.getComputedStyle(z).objectFit === "contain");
    z.loading = "eager"; await sleep(1500); // the test frames sit off screen, where lazy images wait
    t.check("a real picture loads and fits its frame", z.naturalWidth > 0 && z.naturalWidth !== z.naturalHeight && Math.round(z.getBoundingClientRect().width) === 52 && Math.round(z.getBoundingClientRect().height) === 52, z.naturalWidth + "x" + z.naturalHeight);

    btn(A, "Zebra mug", "more").click(); await sleep(80);
    t.check("Details still opens the larger picture", !card(A, "Zebra mug").querySelector(".gift-extra").hidden && card(A, "Zebra mug").querySelector(".gift-image").getAttribute("src") === IMG);
    t.check("the thumbnail stays while open", !!thumb(A, "Zebra mug"));
    btn(A, "Zebra mug", "more").click(); await sleep(80);

    btn(A, "Zebra mug", "claim").click(); await confirmYes(A); await sleep(200);
    t.check("a claimed gift keeps its thumbnail", chip(A, "Zebra mug") === "Claimed by you" && !!thumb(A, "Zebra mug"));
    btn(A, "Zebra mug", "release").click(); await confirmYes(A); await sleep(200);

    // A real failure: this address can never resolve. Off-screen frames may not have tried it yet.
    if (thumb(A, "Failing picture")) { thumb(A, "Failing picture").loading = "eager"; await sleep(1500); }
    t.check("when it fails, the image and frame are gone", !thumb(A, "Failing picture") && !card(A, "Failing picture").classList.contains("has-thumb"));
    t.check("no Details button left with nothing behind it", !btn(A, "Failing picture", "more"));
    await refocus(A);
    t.check("it stays gone after a refresh", !thumb(A, "Failing picture"));
    t.check("the stored image address is untouched", (await db.query("select image_url from public.gifts where name = 'Failing picture'")).rows[0].image_url === BAD_IMG);
    t.check("the gift can still be claimed", !!btn(A, "Failing picture", "claim"));

    // -------------------------------------------------------------------
    t.section("Thumbnails at phone and desktop sizes");
    await buyAs(C, "Cherry pitter");
    await buyAs(M, "Moss kit");
    await refocus(A);
    A.w.location.hash = "#cameron"; await sleep(500);
    t.check("with one gift left to order, the sort control steps aside", A.d.getElementById("sort-control").hidden && activeNames(A).length === 1);
    A.w.location.hash = "#clara"; await sleep(500);
    await db.query("insert into public.gifts (recipient, name, price, image_url, sort_order) values ('cameron', 'Pruning shears', '$30', $1, 3)", [IMG]);
    await db.query("update public.gifts set price = $1 where name = 'apple press'", ["about $69 to $157 depending on the size"]);
    for (const person of ["clara", "cameron"]) {
      for (const [w, h, label, low, high] of [[390, 844, "phone", 48, 56], [500, 900, "large phone", 48, 56], [1440, 900, "wide desktop", 64, 76]]) {
        const P = await open(env, "index.html", `size-${person}-${w}`, person, { width: w, height: h, wait: 1000 });
        const d = P.d;
        const li = [...d.querySelectorAll("#gifts > li.has-thumb")][0] || null;
        const size = li ? li.querySelector(".gift-thumb").getBoundingClientRect() : null;
        if (li) t.check(`${person} ${label}: thumbnail is ${low}–${high}px and square`, size.width >= low && size.width <= high && size.height === size.width, size.width + "x" + size.height);
        d.getElementById("purchased-details").open = true; await sleep(50);
        const bt = d.querySelector("#purchased-list .bought-thumb").getBoundingClientRect();
        t.check(`${person} ${label}: purchased thumbnail is smaller`, bt.width >= 28 && bt.width <= 40 && (!size || bt.width < size.width), bt.width);
        const rowH = [...d.querySelectorAll("#purchased-list > li")].map((r) => r.getBoundingClientRect().height);
        t.check(`${person} ${label}: purchased rows stay compact (≤ 90px)`, Math.max(...rowH) <= 90, rowH.map(Math.round).join());
        const cardH = [...d.querySelectorAll("#gifts > li")].map((c) => c.getBoundingClientRect().height);
        t.check(`${person} ${label}: cards stay compact (≤ 200px)`, Math.max(...cardH) <= 200, cardH.map(Math.round).join());
        t.check(`${person} ${label}: no sideways scrolling`, d.documentElement.scrollWidth <= w, d.documentElement.scrollWidth);
        const overflowing = [...d.querySelectorAll(".gift-price, .bought-price")].filter((p) => p.getBoundingClientRect().right > p.closest("li").getBoundingClientRect().right + 0.5);
        t.check(`${person} ${label}: even a long price stays inside its card`, overflowing.length === 0, overflowing.map((p) => p.textContent).join());
        const select = d.getElementById("gift-sort").getBoundingClientRect();
        t.check(`${person} ${label}: sort control is ≥44px tall and inside the header`, select.height >= 43.5 && select.right <= d.querySelector(".list-head").getBoundingClientRect().right + 0.5, select.height);
        t.check(`${person} ${label}: sort control text is big enough to stop iOS zooming`, parseFloat(P.w.getComputedStyle(d.getElementById("gift-sort")).fontSize) >= 16);
        P.frame.remove();
      }
    }

    // -------------------------------------------------------------------
    t.section("Owner reordering");
    const O = await open(env, "manage.html", "owner-clara");
    await signIn(O, "clara");
    const names = () => [...O.d.querySelectorAll(".owner-gift .gift-name")].map((n) => n.textContent);
    const ownerRow = (name) => [...O.d.querySelectorAll(".owner-gift")].find((li) => li.querySelector(".gift-name").textContent === name);
    const step = (name, dir) => ownerRow(name).querySelector(`[data-role="step-${dir}"]`);
    const fresh = await ownerOrder(C);
    const family = await open(env, "index.html", "family-reader", "clara");
    t.check("one-tap arrows on every row, with clear names", names().every((n) => step(n, "up").getAttribute("aria-label") === "Move " + n + " up" && step(n, "down").getAttribute("aria-label") === "Move " + n + " down"));
    t.check("they're real buttons, reachable by keyboard", step(fresh[1], "up").tagName === "BUTTON" && step(fresh[1], "up").tabIndex === 0);
    t.check("up is off for the first, down for the last", step(fresh[0], "up").disabled && step(fresh[fresh.length - 1], "down").disabled);
    t.check("each row shows its number", ownerRow(fresh[2]).querySelector(".position").textContent.replace(/\s+/g, " ").includes("3"));
    t.check("Edit, Move and Remove are all kept", ["edit", "move", "remove"].every((r) => !!ownerRow(fresh[0]).querySelector(`[data-role="${r}"]`)));

    const camBefore = await ownerOrder(M);
    env.server.calls.length = 0;
    const second = fresh[1];
    step(second, "up").focus(); step(second, "up").click();
    t.check("while saving, the list on screen hasn't changed yet", names().join() === fresh.join());
    await sleep(500);
    t.check("up moves it one place", names()[0] === second && names()[1] === fresh[0], names().join());
    t.check("the screen matches what was saved", names().join() === (await ownerOrder(C)).join());
    t.check("confirms it saved", /Saved/.test(ownerRow(second).querySelector(".owner-meta").textContent) && new RegExp("number 1 of " + fresh.length).test(O.d.getElementById("move-status").textContent), O.d.getElementById("move-status").textContent);
    t.check("uses the existing move function, then re-reads the list", env.server.calls.filter((c) => c.owner).map((c) => c.name).join() === "owner_move_gift,owner_list", env.server.calls.filter((c) => c.owner).map((c) => c.name).join());
    t.check("at the top, focus moves to the arrow that still works", O.d.activeElement === step(second, "down"), O.d.activeElement && O.d.activeElement.outerHTML.slice(0, 80));
    step(second, "down").click(); await sleep(500);
    t.check("down moves it back", names().join() === fresh.join(), names().join());
    t.check("focus stays on the arrow just used", O.d.activeElement === step(second, "down"));

    const newLast = fresh[0];
    ownerRow(newLast).querySelector('[data-role="move"]').click(); await sleep(100);
    ownerRow(newLast).querySelector('[data-role="move-bottom"]').click(); await sleep(500);
    t.check("Move → To bottom still works", names()[names().length - 1] === newLast);
    await refocus(family);
    t.check("family Default order follows the saved order", activeNames(family).join() === names().filter((n) => n !== "Cherry pitter").join(), activeNames(family).join());
    await setSort(family, "name");
    const named = activeNames(family).join();
    await setSort(family, "default");
    step(names()[1], "up").click(); await sleep(500); await refocus(family);
    await setSort(family, "name");
    t.check("an owner's reorder doesn't disturb a name sort", activeNames(family).join() === named);
    await setSort(family, "default");
    t.check("and Default shows the newest owner order", activeNames(family).join() === names().filter((n) => n !== "Cherry pitter").join());
    t.check("Clara's reordering never touches Cameron's list", (await ownerOrder(M)).join() === camBefore.join());
    const camGift = (await rpc(db, M, "owner_list", {})).data[0].id;
    t.check("Clara can't move Cameron's gift, even directly", (await rpc(db, C, "owner_move_gift", { p_id: camGift, p_where: "bottom" })).error?.code === "P0002");
    t.check("the owner page never touches claim functions", !env.server.calls.some((c) => c.owner && /claim|purchased|get_list/.test(c.name)));
    t.check("the owner page shows no claim status", !/claimed|purchased/i.test(O.d.getElementById("owner-gifts").textContent));

    t.section("Reordering when saves fail");
    const settled = names().join();
    const target = names()[3];
    env.server.down = true;
    step(target, "up").click(); await sleep(400);
    t.check("offline: the order on screen doesn't change", names().join() === settled);
    t.check("offline: says it may not have saved", /may not have saved/.test(T.toast(O)), T.toast(O));
    t.check("offline: no Saved mark", !O.d.querySelector(".is-moved, .is-saving"));
    env.server.down = false;
    t.check("offline: nothing was stored", (await ownerOrder(C)).join() === settled);

    // Stand-ins for the two awkward network cases, wrapped around the harness's client.
    const realSupabase = env.supabase;
    let lose = null, failNext = null;
    env.supabase = (label) => {
      const client = realSupabase(label);
      const realRpc = client.rpc.bind(client);
      client.rpc = async (name, args) => {
        if (failNext === name) { failNext = null; return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } }; }
        const result = await realRpc(name, args);
        if (lose === name) { lose = null; return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } }; }
        return result;
      };
      return client;
    };
    const O2 = await open(env, "manage.html", "owner-clara");
    const names2 = () => [...O2.d.querySelectorAll(".owner-gift .gift-name")].map((n) => n.textContent);
    const step2 = (name, dir) => [...O2.d.querySelectorAll(".owner-gift")].find((li) => li.querySelector(".gift-name").textContent === name).querySelector(`[data-role="step-${dir}"]`);
    env.supabase = realSupabase;
    t.check("same owner session comes back after reload", names2().join() === settled);

    lose = "owner_move_gift";
    step2(names2()[3], "up").click(); await sleep(500);
    t.check("reply lost but saved: the screen shows the true order, marked Saved", names2().join() === (await ownerOrder(C)).join() && names2().join() !== settled && !!O2.d.querySelector(".is-moved"));
    const afterLost = names2().join();

    failNext = "owner_move_gift";
    step2(names2()[3], "up").click(); await sleep(500);
    t.check("request never arrived: says nothing moved, order unchanged", names2().join() === afterLost && (await ownerOrder(C)).join() === afterLost && /nothing moved/.test(T.toast(O2)), T.toast(O2));

    failNext = "owner_list";
    const beforeRefreshFail = (await ownerOrder(C)).join();
    step2(names2()[3], "up").click(); await sleep(500);
    t.check("saved but couldn't re-read: says so, instead of claiming nothing changed", /Moved, but/.test(T.toast(O2)) && (await ownerOrder(C)).join() !== beforeRefreshFail, T.toast(O2));
    t.check("and doesn't show a new order it hasn't confirmed", names2().join() === beforeRefreshFail, names2().join());
    await sleep(10);
  },
});
