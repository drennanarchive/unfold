/*
 * Database tests: supabase/setup.sql on real Postgres, called the way the
 * browser calls it (anon, or as a signed-in user).
 */
window.SUITES = window.SUITES || [];
window.SUITES.push({
  name: "Database: security, ownership, claim lifecycle",
  async run(t) {
    const { USERS, makeDb, asRole, rpc: call } = T;
    const C = USERS.clara.id, M = USERS.cameron.id, X = USERS.stray.id;
    const T1 = "a".repeat(64), T2 = "b".repeat(64), T3 = "c".repeat(64);

    const { db, setup } = await makeDb({ round1First: true });
    const rpc = (uid, name, args) => call(db, uid, name, args || {});
    const fails = async (uid, sql) => { try { await asRole(db, uid, sql); return false; } catch (e) { return e.message || true; } };
    const ownerNames = async (uid) => (await rpc(uid, "owner_list")).data.map((g) => g.name);

    t.section("Setup script");
    t.check("runs on top of a Round 1 database", true);
    await db.exec(setup);
    t.check("is safe to run again", true);
    t.check("Round 1 claims table renamed, not deleted", (await db.query("select count(*)::int n from public.claims_round1_old")).rows[0].n === 1);
    t.check("Round 1 functions removed", (await db.query("select count(*)::int n from pg_proc where proname in ('list_claims','unclaim_gift')")).rows[0].n === 0);

    t.section("No direct table access");
    for (const [label, uid] of [["anon", null], ["owner", C], ["stray user", X]]) {
      for (const table of ["gifts", "claims", "list_owners"]) {
        t.check(`${label} cannot read ${table}`, !!(await fails(uid, `select * from public.${table}`)));
      }
      t.check(`${label} cannot insert gifts`, !!(await fails(uid, "insert into public.gifts (recipient, name) values ('clara','x')")));
      t.check(`${label} cannot update claims`, !!(await fails(uid, "update public.claims set state = 'purchased'")));
      t.check(`${label} cannot delete gifts`, !!(await fails(uid, "delete from public.gifts")));
      t.check(`${label} cannot add itself as an owner`, !!(await fails(uid, `insert into public.list_owners values ('${X}','clara')`)));
      t.check(`${label} cannot call private helpers`, !!(await fails(uid, "select private.token_hash('x')")));
    }

    t.section("Owner authorization");
    t.check("Clara's login maps to clara", (await rpc(C, "owner_recipient")).data === "clara");
    t.check("Cameron's login maps to cameron", (await rpc(M, "owner_recipient")).data === "cameron");
    t.check("stray login maps to nothing", (await rpc(X, "owner_recipient")).data === null);
    t.check("anon cannot call owner functions", (await rpc(null, "owner_recipient")).error?.code === "42501");
    let r = await rpc(C, "owner_list");
    t.check("Clara sees only her gifts", r.data.length === 4 && !r.data.some((g) => /headphones|socks/i.test(g.name)));
    t.check("owner_list has no claim/status/hash columns", Object.keys(r.data[0]).join(",") === "id,name,details,price,link,image_url,sort_order", Object.keys(r.data[0]).join(","));
    t.check("Cameron sees only his gifts", (await ownerNames(M)).includes("Wireless headphones") && (await ownerNames(M)).length === 4);
    t.check("stray user cannot list", (await rpc(X, "owner_list")).error?.code === "42501");
    t.check("stray user cannot add", (await rpc(X, "owner_add_gift", { p_name: "Sneaky" })).error?.code === "42501");

    t.section("Add / validation");
    r = await rpc(C, "owner_add_gift", { p_name: "  Silver earrings  ", p_details: " Small hoops ", p_price: "", p_link: "https://shop.example.com/e", p_image_url: "" });
    t.check("Clara can add a gift", typeof r.data === "string", JSON.stringify(r));
    const earrings = r.data;
    const list = (await rpc(C, "owner_list")).data;
    const e1 = list.find((g) => g.id === earrings);
    t.check("added at the bottom, trimmed, blanks become null", list[list.length - 1].id === earrings && e1.name === "Silver earrings" && e1.details === "Small hoops" && e1.price === null && e1.image_url === null, JSON.stringify(e1));
    t.check("stored on Clara's list (derived from the login)", (await db.query("select recipient from public.gifts where id = $1", [earrings])).rows[0].recipient === "clara");
    t.check("browser cannot pass a recipient (no such parameter)", !!(await rpc(C, "owner_add_gift", { p_name: "x", p_recipient: "cameron" })).error);
    t.check("rejects empty name", /name/i.test((await rpc(C, "owner_add_gift", { p_name: "   " })).error?.message));
    t.check("rejects 121-char name", /too long/i.test((await rpc(C, "owner_add_gift", { p_name: "x".repeat(121) })).error?.message));
    t.check("rejects javascript: link", /shopping link/i.test((await rpc(C, "owner_add_gift", { p_name: "x", p_link: "javascript:alert(1)" })).error?.message));
    t.check("rejects link with spaces", /shopping link/i.test((await rpc(C, "owner_add_gift", { p_name: "x", p_link: "https://a b.com" })).error?.message));
    t.check("rejects non-http image URL", /image link/i.test((await rpc(C, "owner_add_gift", { p_name: "x", p_image_url: "data:image/png;base64,AAA" })).error?.message));
    t.check("rejects 1001-char details", /too long/i.test((await rpc(C, "owner_add_gift", { p_name: "x", p_details: "d".repeat(1001) })).error?.message));

    t.section("Owners can't reach each other's lists");
    const camGift = (await rpc(M, "owner_list")).data[0].id;
    t.check("Clara cannot edit Cameron's gift", (await rpc(C, "owner_update_gift", { p_id: camGift, p_name: "Hacked" })).error?.code === "P0002");
    t.check("Clara cannot remove Cameron's gift", (await rpc(C, "owner_archive_gift", { p_id: camGift })).error?.code === "P0002");
    t.check("Clara cannot restore Cameron's gift", (await rpc(C, "owner_restore_gift", { p_id: camGift })).error?.code === "P0002");
    t.check("Clara cannot move Cameron's gift", (await rpc(C, "owner_move_gift", { p_id: camGift, p_where: "top" })).error?.code === "P0002");
    t.check("Cameron cannot edit Clara's gift", (await rpc(M, "owner_update_gift", { p_id: earrings, p_name: "Hacked" })).error?.code === "P0002");
    t.check("stray user cannot edit anything", (await rpc(X, "owner_update_gift", { p_id: earrings, p_name: "Hacked" })).error?.code === "42501");
    t.check("nothing was changed", (await db.query("select count(*)::int n from public.gifts where name = 'Hacked'")).rows[0].n === 0);

    t.section("Reordering");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "top" });
    t.check("move to top", (await ownerNames(C))[0] === "Silver earrings");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "down" });
    t.check("move down", (await ownerNames(C))[1] === "Silver earrings");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "up" });
    t.check("move up", (await ownerNames(C))[0] === "Silver earrings");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "up" });
    t.check("move up at the top does nothing", (await ownerNames(C))[0] === "Silver earrings");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "bottom" });
    const names = await ownerNames(C);
    t.check("move to bottom", names[names.length - 1] === "Silver earrings");
    t.check("rejects an unknown move", (await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "sideways" })).error?.code === "22023");
    t.check("Cameron's order untouched", (await ownerNames(M))[0] === "Wireless headphones");

    t.section("Claims: anonymous, one per gift, browser-owned");
    const view = async (tok, id) => (await rpc(null, "get_list", { p_token: tok })).data.find((g) => g.id === (id || earrings));
    r = await rpc(null, "get_list", { p_token: T1 });
    t.check("get_list returns both lists", r.data.length === 9, r.data.length);
    t.check("get_list exposes no hash/token/time/user columns", !Object.keys(r.data[0]).some((k) => /hash|token|claimed_at|purchased_at|user/.test(k)), Object.keys(r.data[0]).join(","));
    t.check("claim -> claimed", (await rpc(null, "claim_gift", { p_gift_id: earrings, p_token: T1 })).data === "claimed");
    t.check("second browser -> taken", (await rpc(null, "claim_gift", { p_gift_id: earrings, p_token: T2 })).data === "taken");
    t.check("same browser again (a retry) -> already_yours", (await rpc(null, "claim_gift", { p_gift_id: earrings, p_token: T1 })).data === "already_yours");
    t.check("malformed token rejected", (await rpc(null, "claim_gift", { p_gift_id: earrings, p_token: "short" })).error?.code === "22023");
    t.check("unknown gift -> gone", (await rpc(null, "claim_gift", { p_gift_id: "99999999-9999-9999-9999-999999999999", p_token: T1 })).data === "gone");
    const stored = (await db.query("select token_hash from public.claims where gift_id = $1", [earrings])).rows[0].token_hash;
    const expected = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(T1))), (b) => b.toString(16).padStart(2, "0")).join("");
    t.check("only the SHA-256 hash of the token is stored", stored === expected && stored !== T1);
    t.check("claimant sees claimed + mine", (await view(T1)).status === "claimed" && (await view(T1)).mine === true);
    t.check("other browsers see claimed, not mine", (await view(T2)).status === "claimed" && (await view(T2)).mine === false);
    t.check("a viewer with no token sees claimed", (await view(null)).status === "claimed");

    t.section("Simultaneous claims");
    const target = (await rpc(M, "owner_list")).data[2].id;
    const tokens = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "d"));
    const results = await Promise.all(tokens.map((tok) => rpc(null, "claim_gift", { p_gift_id: target, p_token: tok })));
    const outcomes = results.map((x) => x.data);
    t.check("six claims fired at once: exactly one wins", outcomes.filter((x) => x === "claimed").length === 1 && outcomes.filter((x) => x === "taken").length === 5, outcomes.join(","));
    t.check("one-claim-per-gift primary key exists", (await db.query("select count(*)::int n from pg_constraint where conrelid = 'public.claims'::regclass and contype = 'p'")).rows[0].n === 1);
    await rpc(null, "release_claim", { p_gift_id: target, p_token: tokens[outcomes.indexOf("claimed")] });

    t.section("Purchase lifecycle");
    t.check("others cannot mark it purchased", (await rpc(null, "mark_purchased", { p_gift_id: earrings, p_token: T2 })).data === "not_yours");
    t.check("others cannot release it", (await rpc(null, "release_claim", { p_gift_id: earrings, p_token: T2 })).data === "not_yours");
    t.check("claimant marks purchased", (await rpc(null, "mark_purchased", { p_gift_id: earrings, p_token: T1 })).data === "purchased");
    t.check("marking purchased again (a retry) is fine", (await rpc(null, "mark_purchased", { p_gift_id: earrings, p_token: T1 })).data === "purchased");
    t.check("others see purchased, anonymously", (await view(T2)).status === "purchased" && !(await view(T2)).mine);
    t.check("can't release while purchased", (await rpc(null, "release_claim", { p_gift_id: earrings, p_token: T1 })).data === "purchased");
    t.check("mark not purchased", (await rpc(null, "mark_not_purchased", { p_gift_id: earrings, p_token: T1 })).data === "claimed");
    t.check("mark not purchased again (a retry) is fine", (await rpc(null, "mark_not_purchased", { p_gift_id: earrings, p_token: T1 })).data === "claimed");
    t.check("others cannot mark not purchased", (await rpc(null, "mark_not_purchased", { p_gift_id: earrings, p_token: T2 })).data === "not_yours");

    t.section("Owner edits never touch claims (revision behaviour)");
    await rpc(C, "owner_update_gift", { p_id: earrings, p_name: "Silver earrings", p_details: "Small hoops", p_link: "https://shop.example.com/e" });
    t.check("saving with no changes doesn't flag an update", (await view(T1)).updated_since_claim === false);
    await rpc(C, "owner_update_gift", { p_id: earrings, p_name: "Silver earrings", p_details: "Small hoops, sterling only", p_link: "https://shop.example.com/e" });
    t.check("claim survives an edit", (await view(T1)).mine && (await view(T1)).status === "claimed");
    t.check("claimant sees 'updated since you claimed'", (await view(T1)).updated_since_claim === true);
    t.check("others don't get the update flag", (await view(T2)).updated_since_claim === false);
    const after = (await db.query("select token_hash, state from public.claims where gift_id = $1", [earrings])).rows[0];
    t.check("editing left the claim record exactly as it was", after.token_hash === stored && after.state === "claimed");
    await rpc(C, "owner_move_gift", { p_id: earrings, p_where: "top" });
    t.check("reordering doesn't count as an edit", (await db.query("select revision from public.gifts where id = $1", [earrings])).rows[0].revision === 2);

    t.section("Remove, removal note, restore");
    await rpc(null, "mark_purchased", { p_gift_id: earrings, p_token: T1 });
    t.check("owner can remove (soft delete)", !(await rpc(C, "owner_archive_gift", { p_id: earrings })).error);
    t.check("gone from the owner's list", !(await ownerNames(C)).includes("Silver earrings"));
    t.check("hidden from other browsers", !(await view(T2)));
    const tomb = await view(T1);
    t.check("claimant still sees it, flagged removed", tomb && tomb.removed === true && tomb.mine === true);
    t.check("removed note hides details and link", tomb.details === null && tomb.link === null);
    t.check("claim record kept", (await db.query("select count(*)::int n from public.claims where gift_id = $1", [earrings])).rows[0].n === 1);
    t.check("can't claim a removed gift", (await rpc(null, "claim_gift", { p_gift_id: earrings, p_token: T3 })).data === "gone");
    t.check("can't change purchase state on a removed gift", (await rpc(null, "mark_not_purchased", { p_gift_id: earrings, p_token: T1 })).data === "not_yours");
    t.check("owner can restore", !(await rpc(C, "owner_restore_gift", { p_id: earrings })).error);
    t.check("restored gift comes back with its claim", (await view(T2)).status === "purchased");
    await rpc(C, "owner_archive_gift", { p_id: earrings });
    t.check("claimant can dismiss the note even when purchased", (await rpc(null, "release_claim", { p_gift_id: earrings, p_token: T1 })).data === "released");
    t.check("note gone after dismissing", !(await view(T1)));
    t.check("releasing again (a retry) still 'released'", (await rpc(null, "release_claim", { p_gift_id: earrings, p_token: T1 })).data === "released");

    t.section("Function hygiene and grants");
    const fns = await db.query(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_list','claim_gift','release_claim','mark_purchased','mark_not_purchased','owner_recipient','owner_list','owner_add_gift','owner_update_gift','owner_move_gift','owner_archive_gift','owner_restore_gift')`);
    t.check("all 12 public functions exist", fns.rows.length === 12, fns.rows.length);
    t.check("all are security definer with an empty search_path", fns.rows.every((f) => f.prosecdef && String(f.proconfig).includes('search_path=""')));
    const p = (await db.query(`select
        has_function_privilege('anon', 'public.owner_add_gift(text,text,text,text,text)', 'execute') anon_owner,
        has_function_privilege('anon', 'public.get_list(text)', 'execute') anon_list,
        has_function_privilege('public', 'public.claim_gift(uuid,text)', 'execute') public_claim,
        has_function_privilege('authenticated', 'private.require_owner()', 'execute') auth_private,
        has_schema_privilege('anon', 'private', 'usage') anon_private_schema`)).rows[0];
    t.check("anon can't execute owner functions", p.anon_owner === false);
    t.check("anon can execute get_list", p.anon_list === true);
    t.check("PUBLIC has no execute grants", p.public_claim === false);
    t.check("signed-in users can't call private helpers", p.auth_private === false);
    t.check("anon has no access to the private schema", p.anon_private_schema === false);
    const rls = await db.query("select relrowsecurity from pg_class where relname in ('gifts','claims','list_owners') and relnamespace = 'public'::regnamespace");
    t.check("RLS on for all three tables", rls.rows.length === 3 && rls.rows.every((x) => x.relrowsecurity));
  },
});
