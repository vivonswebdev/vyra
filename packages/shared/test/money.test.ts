import { describe, expect, it } from "vitest";
import { commissionCents, SignupInput, ProjectUpdateInput } from "../src/index.js";

describe("commission", () => {
  it("arrondit en faveur du vendeur et borne au montant", () => {
    expect(commissionCents(999, 1500)).toBe(149); // 149,85 -> 149
    expect(commissionCents(100, 10_000)).toBe(100);
    expect(commissionCents(500, 1000, 25)).toBe(75);
    expect(commissionCents(10, 0, 50)).toBe(10);
  });
  it("refuse les montants et taux invalides", () => {
    expect(() => commissionCents(-1, 100)).toThrow();
    expect(() => commissionCents(1.5, 100)).toThrow();
    expect(() => commissionCents(100, 10_001)).toThrow();
  });
});

describe("contrats", () => {
  it("normalise l'e-mail et exige l'acceptation des conditions", () => {
    const ok = SignupInput.safeParse({ email: "  Ana@Example.COM ", password: "motdepasse-long", displayName: "Ana", acceptTerms: true });
    expect(ok.success && ok.data.email).toBe("ana@example.com");
    expect(SignupInput.safeParse({ email: "ana@example.com", password: "motdepasse-long", displayName: "Ana", acceptTerms: false }).success).toBe(false);
    expect(SignupInput.safeParse({ email: "pas-un-mail", password: "motdepasse-long", displayName: "Ana", acceptTerms: true }).success).toBe(false);
    expect(SignupInput.safeParse({ email: "a@b.co", password: "court", displayName: "Ana", acceptTerms: true }).success).toBe(false);
  });
  it("exige une révision de base pour toute mise à jour de projet", () => {
    expect(ProjectUpdateInput.safeParse({ name: "x" }).success).toBe(false);
    expect(ProjectUpdateInput.safeParse({ baseRevision: 3, name: "x" }).success).toBe(true);
  });
});
