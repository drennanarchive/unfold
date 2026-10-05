/*
 * Layout tests: the family page at real phone / tablet / desktop sizes.
 * These check the mobile-first assumptions that are practical to measure;
 * they don't replace looking at the page (see test/README.md).
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Layout: phone, tablet and desktop",
  async run(t) {
    const { sleep, makeDb, makeEnv, open } = T;
    const { db } = await makeDb();
    const env = makeEnv(db);
    const SIZES = [[390, 844, "phone"], [430, 932, "large phone"], [768, 1024, "tablet"], [1280, 800, "desktop"]];

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
        t.check(`${label}: list column centred`, Math.abs(column.left - (viewW - column.right)) < 2, Math.round(column.left) + " / " + Math.round(viewW - column.right));
        if (portrait && w < 600) {
          if (person === "cameron") {
            t.check(`${label}: art anchored bottom-left so the bonsai is never cropped`, bg.backgroundPosition === "0% 100%", bg.backgroundPosition);
            t.check(`${label}: list starts below the bonsai (≥68% down)`, head.top >= h * 0.68, Math.round(head.top) + " of " + h);
          } else {
            t.check(`${label}: winter scene left open above the list (≥50% down)`, head.top >= h * 0.5, Math.round(head.top) + " of " + h);
          }
          t.check(`${label}: first gift is visible without scrolling`, d.querySelector("#gifts > li").getBoundingClientRect().top < h);
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
