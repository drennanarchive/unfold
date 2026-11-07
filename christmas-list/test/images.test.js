/*
 * Thumbnail loading: small versions from the shops' own image services, falling back
 * to the original, and an early start for the pictures at the top of the list.
 * The page's image addresses are swapped for local data, so no outside site is involved.
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Images: sized thumbnails and loading order",
  async run(t) {
    const { USERS, sleep, makeDb, makeEnv, open, rpc, card, btn, refocus, confirmYes, bought, activeNames } = T;
    const { db } = await makeDb({ samples: false });
    const env = makeEnv(db);
    const C = USERS.clara.id;
    const OTHER = "d".repeat(64);
    const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";
    const BROKEN = "data:image/gif;base64,AAAA";

    // -------------------------------------------------------------------
    t.section("Choosing the small address");
    const probe = await open(env, "index.html", "images-probe", "clara");
    const small = probe.w.XL.thumbnailUrl;
    [
      ["Shopify", "https://shop.example/cdn/shop/files/a.png?v=17&width=1600", "https://shop.example/cdn/shop/files/a.png?v=17&width=144"],
      ["Amazon", "https://m.media-amazon.com/images/I/51R9t9ED-xL._SL1500_.jpg", "https://m.media-amazon.com/images/I/51R9t9ED-xL._SL144_.jpg"],
      ["Amazon with AC", "https://m.media-amazon.com/images/I/717CQUhixrL._AC_SL1500_.jpg", "https://m.media-amazon.com/images/I/717CQUhixrL._SL144_.jpg"],
      ["Amazon height form", "https://m.media-amazon.com/images/I/716KvMEJXGL._AC_SY695_.jpg", "https://m.media-amazon.com/images/I/716KvMEJXGL._SL144_.jpg"],
      ["Amazon + in the name", "https://m.media-amazon.com/images/I/51F+C+0RJES._SL1000_.jpg", "https://m.media-amazon.com/images/I/51F+C+0RJES._SL144_.jpg"],
      ["Scene7", "https://target.scene7.com/is/image/Target/GUEST_5?wid=1200&hei=1200&qlt=80", "https://target.scene7.com/is/image/Target/GUEST_5?wid=144&hei=144&qlt=80"],
      ["Commerce Cloud", "https://www.shop.example/dw/image/v2/X/a.jpg?sw=800&sh=800&q=70", "https://www.shop.example/dw/image/v2/X/a.jpg?sw=144&sh=144&q=70"],
      ["Commerce Cloud keeps its shape", "https://www.shop.example/dw/image/v2/X/a.jpg?sw=800&sh=400", "https://www.shop.example/dw/image/v2/X/a.jpg?sw=144&sh=72"],
      ["Squarespace", "https://static1.squarespace.com/static/1/t/2/Box+Logo.png?format=1500w", "https://static1.squarespace.com/static/1/t/2/Box+Logo.png?format=300w"],
    ].forEach(([label, from, want]) => t.check(`${label}: asks for the small size`, small(from) === want, small(from)));
    [
      ["no size in the address", "https://shop.example/cdn/shop/files/a.png?v=17"],
      ["already small", "https://shop.example/cdn/shop/files/a.png?width=100"],
      ["already exactly the size", "https://target.scene7.com/is/image/T/G?wid=144"],
      ["a GIF stays whole, so it can still animate", "https://shop.example/cdn/shop/files/a.gif?v=1&width=990"],
      ["a Squarespace GIF too", "https://images.squarespace-cdn.com/content/v1/1/a.gif?format=1500w"],
      ["an unknown site", "https://example.com/photo.png?width=2000"],
      ["width on an unknown path", "https://example.com/img/a.png?width=1600"],
      ["Amazon product page", "https://www.amazon.com/dp/B000?th=1"],
      ["Amazon pre-sized some other way", "https://m.media-amazon.com/images/I/91uAxozhVLL._AC_UF350,350_QL80_FMwebp_.jpg"],
      ["not a web address", "not a url"],
      ["an unusual address is not re-encoded", "https://example.com/a b/ü.png?x=a b"],
      ["nor is one on a known site", "https://shop.example/cdn/shop/files/ü.png?a=b c"],
    ].forEach(([label, from]) => t.check(`${label}: left exactly as stored`, small(from) === from, small(from)));
    probe.frame.remove();

    // -------------------------------------------------------------------
    t.section("On the page");
    const SHOP = "https://shop.test/cdn/shop/files/";
    const GIFTS = [
      ["First", "$9", SHOP + "first.png?width=1600"],
      ["Second", "$8", SHOP + "second.png?width=1600"],
      ["Third no picture", "$7", null],
      ["Small fails", "$6", SHOP + "smallfails.png?width=1600"],
      ["Both fail", "$5", SHOP + "bothfail.png?width=1600"],
      ["Sixth", "$4", "https://plain.test/sixth.png"],
      ["Seventh", "$3", SHOP + "seventh.png?width=1600"],
      ["Eighth", "$2", SHOP + "eighth.png?width=1600"],
      ["Moved up by price", "$1", SHOP + "cheap.png?width=1600"],
      ["Bought", "$10", SHOP + "bought.png?width=1600"],
    ];
    // The page opens first, so its image addresses can be swapped before any gift is shown.
    const P = await open(env, "index.html", "images-page", "clara", { width: 1280, height: 800, wait: 50 });
    const proto = P.w.HTMLImageElement.prototype;
    const real = P.w.Object.getOwnPropertyDescriptor(proto, "src");
    const requests = [];
    P.w.Object.defineProperty(proto, "src", { configurable: true, get: real.get, set(url) {
      requests.push({ url, loading: this.loading, priority: this.fetchPriority, referrer: this.referrerPolicy, cls: this.className });
      if (/smallfails\.png\?width=144|bothfail/.test(url)) real.set.call(this, BROKEN);
      else real.set.call(this, PIXEL);
    } });
    for (let i = 0; i < GIFTS.length; i++) {
      await db.query("insert into public.gifts (recipient, name, price, image_url, sort_order) values ('clara', $1, $2, $3, $4)", [GIFTS[i][0], GIFTS[i][1], GIFTS[i][2], i + 1]);
    }
    const stored = async () => JSON.stringify((await db.query("select name, image_url from public.gifts order by name")).rows);
    const before = await stored();
    const giftId = (await rpc(db, C, "owner_list", {})).data.find((g) => g.name === "Bought").id;
    await rpc(db, null, "claim_gift", { p_gift_id: giftId, p_token: OTHER });
    await rpc(db, null, "mark_purchased", { p_gift_id: giftId, p_token: OTHER });
    await refocus(P); await sleep(700);
    P.d.getElementById("purchased-details").open = true;
    await sleep(300);

    const thumb = (name) => card(P, name).querySelector(".gift-thumb");
    t.check("a thumbnail is showing", !!thumb("First") && thumb("First").naturalWidth > 0, requests.length);
    t.check("a shop thumbnail asks for the small version", requests.some((r) => r.url === SHOP + "first.png?width=144" && /gift-thumb/.test(r.cls)), requests.map((r) => r.url).join(" "));
    t.check("the thumbnail never asks for the original", !requests.some((r) => /first\.png\?width=1600/.test(r.url) && /gift-thumb/.test(r.cls)));
    t.check("a site with no size setting uses its stored address", requests.some((r) => r.url === "https://plain.test/sixth.png"));
    t.check("a purchased thumbnail uses the small version too", requests.some((r) => /bought\.png\?width=144$/.test(r.url) && /bought-thumb/.test(r.cls)));
    t.check("every request keeps the no-referrer policy", requests.length > 0 && requests.every((r) => r.referrer === "no-referrer"));

    t.section("Falling back");
    const smallFail = requests.filter((r) => /smallfails/.test(r.url) && /gift-thumb/.test(r.cls)).map((r) => r.url);
    t.check("if the small version fails, the original is tried", smallFail.includes(SHOP + "smallfails.png?width=144") && smallFail.includes(SHOP + "smallfails.png?width=1600"), smallFail.join(" "));
    t.check("and the picture appears", !!thumb("Small fails") && thumb("Small fails").naturalWidth > 0 && card(P, "Small fails").classList.contains("has-thumb"));
    const bothFail = requests.filter((r) => /bothfail/.test(r.url) && /gift-thumb/.test(r.cls)).map((r) => r.url);
    t.check("if both fail, each is tried once", bothFail.length === 2, bothFail.join(" "));
    t.check("then the frame collapses cleanly", !thumb("Both fail") && !card(P, "Both fail").classList.contains("has-thumb"));
    t.check("no Details left with nothing behind it", !btn(P, "Both fail", "more"));
    t.check("no broken icons remain", ![...P.d.querySelectorAll("img")].some((m) => m.complete && !m.naturalWidth && m.offsetParent));

    t.section("Details still gets the full picture");
    btn(P, "First", "more").click(); await sleep(250);
    const big = card(P, "First").querySelector(".gift-image");
    big.loading = "eager"; await sleep(100);
    t.check("the larger view asks for the original", requests.some((r) => r.url === SHOP + "first.png?width=1600" && /gift-image/.test(r.cls)));
    btn(P, "First", "more").click(); await sleep(100);

    t.section("Loading order");
    const thumbReq = (part) => requests.find((r) => r.url.includes(part) && /gift-thumb/.test(r.cls));
    t.check("the top of the list starts right away, at high priority", thumbReq("first.png").loading === "eager" && thumbReq("first.png").priority === "high", JSON.stringify(thumbReq("first.png")));
    t.check("further down stays lazy", thumbReq("eighth.png").loading === "lazy" && thumbReq("eighth.png").priority !== "high", JSON.stringify(thumbReq("eighth.png")));
    t.check("purchased thumbnails stay lazy", requests.filter((r) => /bought-thumb/.test(r.cls)).every((r) => r.loading === "lazy"));
    t.check("Details pictures stay lazy", requests.filter((r) => /gift-image/.test(r.cls)).every((r) => r.loading === "lazy"));

    t.section("Nothing else changes");
    const elementBefore = thumb("First");
    const seen = requests.length;
    await refocus(P);
    t.check("a refresh reuses the same picture and asks for nothing", thumb("First") === elementBefore && requests.length === seen);
    const select = P.d.getElementById("gift-sort");
    select.value = "price-asc"; select.dispatchEvent(new P.w.Event("change")); await sleep(100);
    t.check("sorting reuses the same pictures and asks for nothing", thumb("First") === elementBefore && requests.length === seen && activeNames(P)[0] === "Moved up by price");
    select.value = "default"; select.dispatchEvent(new P.w.Event("change")); await sleep(100);
    btn(P, "First", "claim").click(); await confirmYes(P); await sleep(300);
    t.check("taking a gift still works, and its row keeps a sized thumbnail", !!bought(P, "First") && bought(P, "First").querySelector(".bought-status").textContent === "You're getting this 🎁" && /first\.png\?width=144$/.test(bought(P, "First").querySelector(".bought-thumb").getAttribute("src") === PIXEL ? requests.filter((r) => /first/.test(r.url) && /bought-thumb/.test(r.cls)).pop().url : ""));
    bought(P, "First").querySelector('[data-role="release"]').click(); await confirmYes(P); await sleep(300);
    t.check("someone else's taken row shows \"Taken\" and no controls", bought(P, "Bought").querySelector(".bought-status").textContent === "Taken" && !bought(P, "Bought").querySelector("button"));
    t.check("stored image addresses are untouched", (await stored()) === before);
    await sleep(10);
  },
});
