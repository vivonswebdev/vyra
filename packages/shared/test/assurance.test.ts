// Socle H4 (U-MFA-1) : table de décision du niveau de confiance, toutes combinaisons.
import { describe, expect, it } from "vitest";
import { checkAssurance, type SessionAssurance } from "../src/assurance.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const admin: SessionAssurance = { roles: ["admin"], mfaEnabled: true, authLevel: "mfa", mfaAt: ago(1), mfaVia: "totp" };

describe("niveau de confiance des opérations du personnel", () => {
  it.each([
    // [cas, session, opération, raison attendue (null = autorisé)]
    ["admin, TOTP de 1 min : rôles", admin, "roles", null],
    ["admin, TOTP de 14 min : rôles", { ...admin, mfaAt: ago(14) }, "roles", null],
    ["admin, TOTP de 16 min : rôles", { ...admin, mfaAt: ago(16) }, "roles", "mfa_step_up_required"],
    ["admin, code de secours récent : rôles", { ...admin, mfaVia: "recovery" }, "roles", "mfa_step_up_required"],
    ["admin, session mot de passe seul : rôles", { ...admin, authLevel: "password", mfaAt: null, mfaVia: null }, "roles", "mfa_step_up_required"],
    ["admin sans 2FA activée : rôles", { ...admin, mfaEnabled: false }, "roles", "mfa_required"],
    ["modérateur, TOTP récent : rôles", { ...admin, roles: ["moderator"] }, "roles", "role_required"],
    ["vendeur : modération", { ...admin, roles: ["seller"] }, "moderation", "role_required"],
    ["modérateur, code de secours de 30 min : modération", { ...admin, roles: ["moderator"], mfaAt: ago(30), mfaVia: "recovery" }, "moderation", null],
    ["modérateur, 61 min : modération", { ...admin, roles: ["moderator"], mfaAt: ago(61) }, "moderation", "mfa_step_up_required"],
    ["admin, 61 min : modération", { ...admin, mfaAt: ago(61) }, "moderation", "mfa_step_up_required"],
    ["admin, TOTP de 4 min : finance", { ...admin, mfaAt: ago(4) }, "finance", null],
    ["admin, TOTP de 6 min : finance", { ...admin, mfaAt: ago(6) }, "finance", "mfa_step_up_required"],
    ["modérateur : finance", { ...admin, roles: ["moderator"] }, "finance", "role_required"],
    ["horodatage dans le futur : refusé", { ...admin, mfaAt: new Date(NOW.getTime() + 10 * 60_000) }, "roles", "mfa_step_up_required"],
  ] as const)("%s", (_, s, op, reason) => {
    const d = checkAssurance(s as SessionAssurance, op, NOW);
    if (reason == null) expect(d).toEqual({ ok: true });
    else expect(d).toMatchObject({ ok: false, reason });
  });
});
