// Erreurs de l'API : chaque code ou raison que le serveur peut renvoyer a un message dans les quatre langues,
// avec les mêmes paramètres ; l'affichage n'utilise jamais le texte français brut du serveur.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../packages/ui/src/api.js";
import { API_ERRORS, apiDetailText, apiErrorText } from "../../../packages/ui/src/api-errors.js";
import { COMMON, type Lang } from "../../../packages/ui/src/i18n.js";

const API_SRC = path.resolve(__dirname, "../../api/src");
function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : /\.ts$/.test(e.name) ? [p] : [];
  });
}
/** Toutes les catégories et raisons d'erreur présentes dans le code du serveur. */
function emittedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const f of sources(API_SRC)) {
    const s = fs.readFileSync(f, "utf8");
    for (const m of s.matchAll(/new HttpError\(\d+, "([a-z_]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/\b(?:badRequest|notFound|conflict|unauthorized|forbidden)\("([a-z_]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/code: "([a-z_]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/reason: "([a-z_]+)"/g)) keys.add(m[1]);
    for (const m of s.matchAll(/, "(chart_[a-z_]+)"\]/g)) keys.add(m[1]);
  }
  // Valeurs par défaut des aides de lib/errors.ts
  ["unauthorized", "forbidden", "not_found", "bad_request", "conflict"].forEach((k) => keys.add(k));
  keys.delete("bad_request"); // catégorie toujours précisée par une raison (premier argument obligatoire)
  keys.delete("conflict");
  keys.delete("custom"); // code d'un problème zod, pas une erreur de l'API
  return keys;
}
const tFor = (lang: Lang) => (key: string, vars?: Record<string, string | number>) => {
  let s = COMMON[lang][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
};

describe("erreurs de l'API traduites", () => {
  it("chaque erreur émise par le serveur a un message en FR, NL, EN et AR", () => {
    const keys = emittedKeys();
    expect(keys.size).toBeGreaterThan(40);
    const missing = [...keys].filter((k) => !API_ERRORS[k]);
    expect(missing).toEqual([]);
  });

  it("aucun texte vide, mêmes paramètres dans les quatre langues", () => {
    for (const [k, v] of Object.entries(API_ERRORS)) {
      expect(v, k).toHaveLength(4);
      const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const s of v) {
        expect(s.trim(), k).not.toBe("");
        expect(vars(s), k).toEqual(vars(v[0]));
      }
      expect(v[3], k).toMatch(/[؀-ۿ]/); // l'arabe est bien en arabe
    }
  });

  it("affiche la raison traduite, jamais le message français du serveur", () => {
    const e = new ApiError(400, "bad_request", "Mot de passe actuel incorrect.", undefined, "wrong_current_password");
    expect(apiErrorText(tFor("ar"), e)).toBe("كلمة المرور الحالية غير صحيحة.");
    expect(apiErrorText(tFor("nl"), e)).toBe("Huidig wachtwoord onjuist.");
    expect(apiErrorText(tFor("en"), new ApiError(401, "invalid_credentials", "Adresse e-mail ou mot de passe incorrect."))).toBe("Incorrect email address or password.");
    const chart = new ApiError(400, "bad_request", "Ligne 3 : …", undefined, "chart_line_color", { line: 3, value: "#zz" });
    expect(apiErrorText(tFor("en"), chart)).toBe("Line 3: colour “#zz” invalid (expected #RRGGBB).");
  });

  it("repli : catégorie, puis statut HTTP, puis message générique", () => {
    const en = tFor("en");
    expect(apiErrorText(en, new ApiError(404, "not_found", "Introuvable.", undefined, "raison_inconnue"))).toBe("Not found.");
    expect(apiErrorText(en, new ApiError(413, "FST_ERR_CTP_BODY_TOO_LARGE", "Contenu trop volumineux."))).toBe("Content too large.");
    expect(apiErrorText(en, new ApiError(502, "error", "HTTP 502"))).toBe("The server ran into a problem. Try again in a moment.");
    expect(apiErrorText(en, new ApiError(415, "FST_ERR_CTP_INVALID_MEDIA_TYPE", "Unsupported Media Type"))).toBe("Request refused.");
    expect(apiErrorText(en, new ApiError(0, "offline", "offline"))).toBe(COMMON.en["common.offline"]);
    expect(apiErrorText(en, new Error("x"))).toBe(COMMON.en["common.error"]);
  });

  it("détails de validation traduits par champ", () => {
    const ar = tFor("ar");
    expect(apiDetailText(ar, { path: "email", issue: "invalid_format", format: "email" })).toBe("عنوان بريد إلكتروني غير صالح.");
    expect(apiDetailText(tFor("fr"), { path: "password", issue: "too_small", origin: "string", minimum: 10 })).toBe("Au moins 10 caractères.");
    expect(apiDetailText(tFor("nl"), { path: "displayName", issue: "too_small", origin: "string", minimum: 1 })).toBe("Verplicht veld.");
    expect(apiDetailText(tFor("en"), { path: "acceptTerms", issue: "invalid_value" })).toBe("You must accept the terms of use.");
    const e = new ApiError(400, "validation", "Adresse e-mail invalide.", [{ path: "email", issue: "invalid_format", format: "email" }]);
    expect(apiErrorText(tFor("en"), e)).toBe("Invalid email address.");
  });
});
