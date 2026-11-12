// Sécurité du compte dans le navigateur : double authentification, appareils, export des données,
// suppression du compte.
import { expect, test } from "@playwright/test";
import { base32Decode, hotp, timeStep } from "../apps/api/src/lib/totp.js";
import { createBlankApi, PASSWORD, signupApi, trackErrors } from "./helpers.js";

const code = (secret: string, offset = 0) => hotp(base32Decode(secret), timeStep() + offset);

test("double authentification : activation, codes de secours, connexion en deux étapes", async ({ page }) => {
  const errors = trackErrors(page);
  const email = await signupApi(page);
  await page.goto("/studio/account");
  const mfa = page.getByTestId("mfa-section");
  await mfa.getByTestId("mfa-password").fill(PASSWORD);
  await mfa.getByRole("button", { name: "Activer" }).click();
  const secret = (await mfa.getByTestId("mfa-secret").innerText()).replace(/\s+/g, "");
  await expect(mfa.locator("img.qr")).toBeVisible();
  await mfa.getByTestId("mfa-enable-code").fill(code(secret));
  await mfa.getByRole("button", { name: "Confirmer l'activation" }).click();
  await expect(mfa.getByTestId("recovery-codes").locator("li")).toHaveCount(10);
  await expect(mfa).toContainText("Codes de secours restants : 10");

  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Connexion" }).click();
  await expect(page.getByRole("heading", { name: "Vérification en deux étapes" })).toBeVisible();
  await page.getByTestId("mfa-code").fill("000000");
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page.getByRole("alert")).toContainText("Code incorrect");
  await page.getByTestId("mfa-code").fill(code(secret, 1));
  await page.getByRole("button", { name: "Vérifier" }).click();
  // Retour à la page demandée avant la déconnexion (Mon compte), session ouverte.
  await expect(page.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/auth/me")).json()).user.email).toBe(email);
  expect(errors.filter((e) => !/401/.test(e))).toEqual([]);
});

test("appareils connectés : la session d'un autre appareil est révoquée depuis le compte", async ({ page, browser }) => {
  const email = await signupApi(page);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:8788" });
  const o = await other.newPage();
  await o.request.post("/api/auth/login", { headers: { "x-vyra-client": "web" }, data: { email, password: PASSWORD } });
  await page.goto("/studio/account");
  const list = page.getByTestId("sessions");
  await expect(list.locator("li")).toHaveCount(2);
  await list.getByRole("button", { name: "Déconnecter" }).click();
  await expect(list.locator("li")).toHaveCount(1);
  expect((await (await o.request.get("/api/auth/me")).json()).user).toBeNull();
  await other.close();
});

test("export des données puis suppression du compte", async ({ page }) => {
  const email = await signupApi(page);
  await createBlankApi(page, "Projet à exporter");
  await page.goto("/studio/account");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-data").click()]);
  const buf = Buffer.concat((await (await dl.createReadStream()).toArray()) as Buffer[]);
  expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(buf.toString("latin1")).toContain("compte.json");
  expect(buf.toString("utf8")).toContain("Projet à exporter");

  await expect(page.getByTestId("delete-account")).toBeDisabled();
  await page.getByTestId("delete-password").fill(PASSWORD);
  await page.getByTestId("delete-confirm").fill("SUPPRIMER");
  await page.getByTestId("delete-account").click();
  await expect(page).toHaveURL(/\/studio\/login/);
  const r = await page.request.post("/api/auth/login", { headers: { "x-vyra-client": "web" }, data: { email, password: PASSWORD } });
  expect(r.status()).toBe(401);
});
