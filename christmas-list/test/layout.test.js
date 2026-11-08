/*
 * Layout tests: the family page at real phone / tablet / desktop sizes.
 * These check the mobile-first assumptions that are practical to measure;
 * they don't replace looking at the page (see test/README.md).
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Layout: phone, tablet and desktop",
  async run(t) {
    const { sleep, makeDb, makeEnv, open, rpc, USERS } = T;
    const { db } = await makeDb();
    const env = makeEnv(db);
    const SIZES = [[390, 844, "phone"], [430, 932, "large phone"], [768, 1024, "tablet"], [820, 1180, "tablet / narrow"],
      [1280, 800, "desktop"], [1440, 900, "wide desktop"]];

    // Some taken gifts on both lists (stored as purchased), so "Already Taken" shows.
    const OTHER = "f".repeat(64);
    for (const [uid, names] of [[USERS.clara.id, ["Winter candle set", "Loose-leaf tea sampler"]], [USERS.cameron.id, ["Warm wool socks"]]]) {
      for (const g of (await rpc(db, uid, "owner_list", {})).data.filter((x) => names.includes(x.name))) {
        await rpc(db, null, "claim_gift", { p_gift_id: g.id, p_token: OTHER });
        await rpc(db, null, "mark_purchased", { p_gift_id: g.id, p_token: OTHER });
      }
    }

    const smallTargets = (d) => [...d.querySelectorAll("button, a.nav-link, a.choice")]
      .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5)
      .map((b) => b.textContent.trim().slice(0, 24));

    t.section("Front door");
    for (const [w, h, label] of [[390, 844, "phone"], [1280, 800, "desktop"]]) {
      const P = await open(env, "index.html", "door-" + w, null, { width: w, height: h });
      const [a, b] = [...P.d.querySelectorAll(".choice")].map((el) => el.getBoundingClientRect());
      t.check(`${label}: no sideways scrolling`, P.d.documentElement.scrollWidth <= w);
      t.check(`${label}: comfortable tap targets`, smallTargets(P.d).length === 0, smallTargets(P.d).join(", "));
      if (w < 680) t.check("phone: the two lists are stacked", b.top > a.bottom - 1);
      else t.check("desktop: the two lists sit side by side", Math.abs(a.top - b.top) < 2 && b.left > a.right);
      P.frame.remove();
    }

    const layoutOf = {}; // Clara's layout at each width, to compare Cameron's against
    for (const person of ["clara", "cameron"]) {
      t.section(person === "clara" ? "Clara's list" : "Cameron's list");
      for (const [w, h, label] of SIZES) {
        const P = await open(env, "index.html", `${person}-${w}`, person, { width: w, height: h, wait: 1200 });
        const d = P.d;
        const bg = getComputedStyle(d.querySelector(".backdrop"));
        const portrait = h > w;
        const cards = [...d.querySelectorAll("#gifts > li")].map((li) => li.getBoundingClientRect().height);
        const head = d.querySelector(".list-head").getBoundingClientRect();
        const column = d.querySelector(".list-column").getBoundingClientRect();

        t.check(`${label}: no sideways scrolling`, d.documentElement.scrollWidth <= w, d.documentElement.scrollWidth);
        t.check(`${label}: comfortable tap targets (≥44px)`, smallTargets(d).length === 0, smallTargets(d).join(", "));
        t.check(`${label}: ${portrait ? "portrait" : "landscape"} art is used`,
          bg.backgroundImage.includes(`${person}-${person === "clara" ? "winter" : "bonsai"}-${portrait ? "mobile" : "desktop"}.webp`), bg.backgroundImage.slice(0, 90));
        t.check(`${label}: gift cards stay compact`, cards.length > 0 && Math.max(...cards) <= 200, cards.map(Math.round).join(","));
        const viewW = d.documentElement.clientWidth; // excludes the scrollbar
        const page = d.querySelector(".list-view").getBoundingClientRect(); // the content area (any reserved scrollbar space excluded)
        t.check(`${label}: list column centred`, Math.abs((column.left - page.left) - (page.right - column.right)) < 2, Math.round(column.left - page.left) + " / " + Math.round(page.right - column.right));
        // Both lists share one layout, so switching between them doesn't move anything.
        const shape = [column.left, column.right, d.querySelector(".list-main").getBoundingClientRect().width, d.getElementById("purchased").getBoundingClientRect().width].map(Math.round).join(",");
        if (person === "clara") layoutOf[w] = shape;
        else t.check(`${label}: same placement and widths as Clara's list`, layoutOf[w] === shape, shape + " vs " + layoutOf[w]);
        if (w >= 1100 && !portrait) {
          t.check(`${label}: a slimmer desktop column (at most 1000px wide)`, column.width <= 1000 + 1, Math.round(column.width));
          const cardBg = getComputedStyle(d.querySelector("#gifts > li")).backgroundImage;
          t.check(`${label}: panels a little more see-through on desktop`, /rgba\(253, 249, 240, 0\.88\)|rgba\(255, 255, 255, 0\.74\)/.test(cardBg), cardBg.slice(0, 80));
        } else {
          const cardBg = getComputedStyle(d.querySelector("#gifts > li")).backgroundImage;
          t.check(`${label}: phone and tablet panels unchanged`, /rgba\(253, 249, 240, 0\.95\)|rgba\(255, 255, 255, 0\.82\)/.test(cardBg), cardBg.slice(0, 80));
        }
        if (portrait && w < 600) {
          if (person === "cameron") {
            t.check(`${label}: art anchored bottom-left so the bonsai is never cropped`, bg.backgroundPosition === "0% 100%", bg.backgroundPosition);
            t.check(`${label}: list starts below the bonsai (≥68% down)`, head.top >= h * 0.68, Math.round(head.top) + " of " + h);
          } else {
            t.check(`${label}: winter scene left open above the list (≥50% down)`, head.top >= h * 0.5, Math.round(head.top) + " of " + h);
          }
          t.check(`${label}: first gift is visible without scrolling`, d.querySelector("#gifts > li").getBoundingClientRect().top < h);
        }

        // "Already Taken" — measured opened, its largest state
        const section = d.getElementById("purchased");
        const wasOpen = d.getElementById("purchased-details").open;
        d.getElementById("purchased-details").open = true;
        await sleep(50);
        const box = section.getBoundingClientRect();
        const main = d.querySelector(".list-main").getBoundingClientRect();
        const rowsH = [...d.querySelectorAll("#purchased-list > li")].map((li) => li.getBoundingClientRect().height);
        const lastCard = [...d.querySelectorAll("#gifts > li")].pop().getBoundingClientRect();
        const twoColumns = w >= 1100 && !portrait;
        t.check(`${label}: Already Taken shown with its rows`, !section.hidden && rowsH.length === (person === "clara" ? 2 : 1));
        t.check(`${label}: 28/29/J. Already Taken causes no sideways scrolling`, d.documentElement.scrollWidth <= w && box.right <= viewW + 0.5, Math.round(box.right) + " vs " + viewW);
        t.check(`${label}: taken rows are compact (≤ 90px, smaller than cards)`, Math.max(...rowsH) <= 90 && Math.max(...rowsH) < Math.min(...cards), rowsH.map(Math.round).join(","));
        t.check(`${label}: tap targets still ≥44px with it open`, smallTargets(d).length === 0, smallTargets(d).join(", "));
        t.check(`${label}: nothing scrolls on its own`, getComputedStyle(d.getElementById("purchased-list")).overflowY === "visible");
        if (twoColumns) {
          t.check(`${label}: 31. two columns: Already Taken sits beside Available without overlapping`, box.left >= main.right + 8 && Math.abs(box.top - main.top) < 2, Math.round(box.left) + " vs " + Math.round(main.right));
          const share = box.width / (box.width + main.width);
          t.check(`${label}: 31. Available gets about 70%, Already Taken about 30%`, share >= 0.25 && share <= 0.36, share.toFixed(2));
          t.check(`${label}: Already Taken starts open`, wasOpen);
          const h1 = d.querySelector(".hero h1").getBoundingClientRect();
          t.check(`${label}: header stays centred over both columns`, Math.abs((h1.left + h1.right) / 2 - (main.left + box.right) / 2) < 3, Math.round((h1.left + h1.right) / 2) + " vs " + Math.round((main.left + box.right) / 2));
        } else {
          t.check(`${label}: 30. Already Taken follows the main list`, box.top >= lastCard.bottom - 1, Math.round(box.top) + " vs " + Math.round(lastCard.bottom));
          t.check(`${label}: Already Taken stays within the list column`, box.left >= column.left - 1 && box.right <= column.right + 1);
          t.check(`${label}: Already Taken starts open`, wasOpen);
        }
        P.frame.remove();
      }
    }

    t.section("Motion");
    const P = await open(env, "index.html", "motion", "clara", { width: 390, height: 844 });
    const reduced = P.w.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const flakes = P.d.querySelectorAll(".sky span").length;
    if (reduced) {
      t.check("reduced motion: no snow", flakes === 0);
      t.check("reduced motion: no card animations", getComputedStyle(P.d.querySelector("#gifts > li")).animationName === "none");
    } else {
      t.check("snow falls on Clara's list", flakes > 0);
      t.note("Run with reduced motion to check that path: test/run-headless.sh does both.");
    }
    P.frame.remove();
    await sleep(10);
  },
});
