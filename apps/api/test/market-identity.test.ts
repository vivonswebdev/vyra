// Market LOT 1 : profils professionnels, vérification par la modération, rôles du personnel.
// Chaque route est essayée avec les acteurs qui ne doivent PAS y avoir accès.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, hotp, timeStep } from "../src/lib/totp.js";
import { Client, setup, signup, teardown, type Ctx } from "./helpers.js";

let ctx: Ctx;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(async () => teardown(ctx));

const PW = "un-mot-de-passe-solide";
const profile = (slug: string, over: Record<string, unknown> = {}) => ({ slug, displayName: "Atelier Lin", kind: "workshop", isBusiness: true, country: "BE", languages: ["fr", "nl"], bio: "Broderie sur textile.", ...over });
const slug = () => "atelier-" + Math.random().toString(36).slice(2, 8);

async function enable2fa(c: Client) {
  const { secret } = (await c.post("/api/me/2fa/setup", { password: PW })).json;
  const r = await c.post("/api/me/2fa/enable", { code: hotp(base32Decode(secret), timeStep()) });
  expect(r.status).toBe(200);
}
async function staff(role: "moderator" | "admin", withMfa = true) {
  const s = await signup(ctx.app);
  await ctx.db.query("INSERT INTO user_roles (user_id, role) VALUES ($1, $2)", [s.user.id, role]);
  if (withMfa) await enable2fa(s.c);
  return s;
}
async function seller(withMfa = false) {
  const s = await signup(ctx.app);
  const sl = slug();
  expect((await s.c.post("/api/market/me/seller", profile(sl))).status).toBe(201);
  if (withMfa) await enable2fa(s.c);
  return { ...s, slug: sl };
}

describe("profil professionnel", () => {
  it("visiteur : aucun accès à l'espace vendeur", async () => {
    const anon = new Client(ctx.app);
    expect((await anon.get("/api/market/me/seller")).status).toBe(401);
    const r = await anon.post("/api/market/me/seller", profile(slug()));
    expect(r.status).toBe(401);
    expect(r.json.error.reason).toBe("login_required");
  });

  it("création : profil brouillon, rôle vendeur accordé, historique et journal, non public", async () => {
    const { c, user } = await signup(ctx.app);
    const before = (await c.get("/api/market/me/seller")).json;
    expect(before.profile).toBeNull();
    expect(before.permissions["seller.profile.create"]).toEqual({ ok: true });
    expect(before.permissions["seller.listing.publish"]).toEqual({ ok: false, reason: "seller_profile_required" });
    const sl = slug();
    const r = await c.post("/api/market/me/seller", profile(sl.toUpperCase()));
    expect(r.status).toBe(201);
    expect(r.json.profile).toMatchObject({ slug: sl, status: "draft", kind: "workshop", country: "BE" });
    expect((await c.get("/api/auth/me")).json.user.roles).toContain("seller");
    expect((await ctx.db.query("SELECT to_status FROM seller_status_events WHERE user_id = $1", [user.id])).rows).toEqual([{ to_status: "draft" }]);
    expect((await ctx.db.query("SELECT 1 FROM audit_log WHERE action = 'seller.profile_created' AND actor_id = $1", [user.id])).rowCount).toBe(1);
    expect((await new Client(ctx.app).get(`/api/market/sellers/${sl}`)).status).toBe(404);
    // Un seul profil par compte
    expect((await c.post("/api/market/me/seller", profile(slug()))).json.error.reason).toBe("seller_profile_exists");
  });

  it("adresse déjà prise, réservée ou invalide : refus explicite", async () => {
    const a = await seller();
    const b = await signup(ctx.app);
    const taken = await b.c.post("/api/market/me/seller", profile(a.slug));
    expect(taken.status).toBe(409);
    expect(taken.json.error.reason).toBe("slug_taken");
    expect((await b.c.post("/api/market/me/seller", profile("admin"))).status).toBe(400);
    expect((await b.c.post("/api/market/me/seller", profile("x"))).status).toBe(400);
    expect((await b.c.post("/api/market/me/seller", profile(slug(), { kind: "pirate" }))).status).toBe(400);
    expect((await b.c.post("/api/market/me/seller", profile(slug(), { country: "Belgique" }))).status).toBe(400);
  });

  it("soumission : double authentification exigée, puis une seule soumission à la fois", async () => {
    const s = await seller();
    const r = await s.c.post("/api/market/me/seller/submit");
    expect(r.status).toBe(403);
    expect(r.json.error.reason).toBe("mfa_required");
    await enable2fa(s.c);
    expect((await s.c.post("/api/market/me/seller/submit")).json.profile.status).toBe("pending_review");
    expect((await s.c.post("/api/market/me/seller/submit")).json.error.reason).toBe("invalid_transition");
  });
});

describe("examen des profils (back-office)", () => {
  it("accès refusé aux acheteurs, aux vendeurs, et aux modérateurs sans double authentification", async () => {
    const buyer = await signup(ctx.app);
    const s = await seller(true);
    const modNoMfa = await staff("moderator", false);
    for (const [c, why] of [[buyer.c, "role_required"], [s.c, "role_required"], [modNoMfa.c, "mfa_required"]] as const) {
      const r = await c.get("/api/admin/sellers");
      expect(r.status).toBe(403);
      expect(r.json.error.reason).toBe(why);
      expect((await c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "verify" })).status).toBe(403);
    }
    expect((await new Client(ctx.app).get("/api/admin/sellers")).status).toBe(401);
  });

  it("vérification : le profil devient public ; refus et suspension sont motivés et historisés", async () => {
    const mod = await staff("moderator");
    const s = await seller(true);
    await s.c.post("/api/market/me/seller/submit");
    const list = (await mod.c.get("/api/admin/sellers")).json.sellers;
    expect(list.map((x: any) => x.userId)).toContain(s.user.id);
    expect(list.find((x: any) => x.userId === s.user.id).email).toBe(s.email);

    expect((await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "reject", reason: "" })).status).toBe(400);
    expect((await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "verify" })).json.profile.status).toBe("verified");
    const pub = await new Client(ctx.app).get(`/api/market/sellers/${s.slug}`);
    expect(pub.status).toBe(200);
    // Le profil public ne contient ni identifiant interne, ni adresse e-mail, ni statut de modération.
    expect(Object.keys(pub.json.seller).sort()).toEqual(["bio", "country", "displayName", "isBusiness", "kind", "languages", "memberSince", "slug"]);
    expect(JSON.stringify(pub.json)).not.toContain(s.email);
    expect((await s.c.get("/api/market/me/seller")).json.permissions["seller.listing.publish"]).toEqual({ ok: true });

    // Décision impossible depuis cet état
    expect((await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "verify" })).json.error.reason).toBe("invalid_transition");
    // Suspension motivée : profil retiré, vendeur bloqué
    expect((await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "suspend", reason: "Signalements répétés de contrefaçon." })).json.profile).toMatchObject({ status: "suspended", statusReason: "Signalements répétés de contrefaçon." });
    expect((await new Client(ctx.app).get(`/api/market/sellers/${s.slug}`)).status).toBe(404);
    expect((await s.c.patch("/api/market/me/seller", { bio: "x" })).json.error.reason).toBe("seller_suspended");
    // Réintégration : nouvel examen, pas de retour direct au public
    expect((await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "reinstate", reason: "" })).json.profile.status).toBe("pending_review");
    const detail = (await mod.c.get(`/api/admin/sellers/${s.user.id}`)).json;
    expect(detail.events.map((e: any) => e.to_status)).toEqual(["draft", "pending_review", "verified", "suspended", "pending_review"]);
    expect((await ctx.db.query("SELECT count(*)::int n FROM audit_log WHERE action = 'seller.status_changed' AND subject = $1", [s.user.id])).rows[0].n).toBe(3);
  });

  it("un modérateur ne statue pas sur son propre profil", async () => {
    const mod = await staff("moderator");
    await mod.c.post("/api/market/me/seller", profile(slug()));
    await mod.c.post("/api/market/me/seller/submit");
    const r = await mod.c.post(`/api/admin/sellers/${mod.user.id}/decision`, { decision: "verify" });
    expect(r.status).toBe(403);
    expect(r.json.error.reason).toBe("self_review");
  });

  it("modifier l'identité d'un profil vérifié le renvoie en examen et le retire du public", async () => {
    const mod = await staff("moderator");
    const s = await seller(true);
    await s.c.post("/api/market/me/seller/submit");
    await mod.c.post(`/api/admin/sellers/${s.user.id}/decision`, { decision: "verify" });
    expect((await s.c.patch("/api/market/me/seller", { bio: "Nouvelle présentation." })).json.profile.status).toBe("verified");
    const r = (await s.c.patch("/api/market/me/seller", { displayName: "Autre nom" })).json.profile;
    expect(r.status).toBe("pending_review");
    expect(r.statusReason).toContain("displayName");
    expect((await new Client(ctx.app).get(`/api/market/sellers/${s.slug}`)).status).toBe(404);
  });
});

describe("rôles du personnel", () => {
  it("seul un administrateur avec double authentification attribue un rôle ; jamais à lui-même", async () => {
    const admin = await staff("admin");
    const adminNoMfa = await staff("admin", false);
    const mod = await staff("moderator");
    const target = await signup(ctx.app);
    const url = `/api/admin/users/${target.user.id}/roles`;
    expect((await mod.c.post(url, { role: "moderator", grant: true })).json.error.reason).toBe("role_required");
    expect((await adminNoMfa.c.post(url, { role: "moderator", grant: true })).json.error.reason).toBe("mfa_required");
    expect((await admin.c.post(url, { role: "seller", grant: true })).status).toBe(400);
    expect((await admin.c.post(url, { role: "moderator", grant: true })).json.roles).toEqual(["moderator"]);
    expect((await admin.c.post(`/api/admin/users/${admin.user.id}/roles`, { role: "admin", grant: false })).json.error.reason).toBe("self_role_change");
    expect((await admin.c.post(url, { role: "moderator", grant: false })).json.roles).toEqual([]);
    const log = (await ctx.db.query("SELECT action FROM audit_log WHERE subject = $1 AND action LIKE 'role.%' ORDER BY id", [target.user.id])).rows.map((r) => r.action);
    expect(log).toEqual(["role.granted", "role.revoked"]);
  });

  it("supprimer le compte d'un administrateur qui a attribué des rôles fonctionne (correction de clé étrangère)", async () => {
    const admin = await staff("admin");
    const target = await signup(ctx.app);
    await admin.c.post(`/api/admin/users/${target.user.id}/roles`, { role: "moderator", grant: true });
    await ctx.db.query("DELETE FROM users WHERE id = $1", [admin.user.id]);
    expect((await ctx.db.query("SELECT granted_by FROM user_roles WHERE user_id = $1", [target.user.id])).rows).toEqual([{ granted_by: null }]);
  });
});

describe("données personnelles", () => {
  it("l'export du compte contient le profil professionnel ; la suppression du compte l'efface", async () => {
    const s = await seller();
    const exp = await s.c.req("GET", "/api/me/export");
    expect(exp.status).toBe(200);
    expect(exp.res.rawPayload.includes(Buffer.from("profil-professionnel.json"))).toBe(true);
    await ctx.db.query("DELETE FROM users WHERE id = $1", [s.user.id]);
    expect((await ctx.db.query("SELECT count(*)::int n FROM seller_profiles WHERE user_id = $1", [s.user.id])).rows[0].n).toBe(0);
    expect((await ctx.db.query("SELECT count(*)::int n FROM seller_status_events WHERE user_id = $1", [s.user.id])).rows[0].n).toBe(0);
  });
});
