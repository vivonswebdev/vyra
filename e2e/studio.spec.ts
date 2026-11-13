// Tests navigateur de VYRA Studio : ils vérifient le fonctionnement réel (données enregistrées
// par l'API, fichiers exportés relus), pas la seule présence des composants.
import { expect, test } from "@playwright/test";
import { canvasBox, createBlankApi, drag, getProject, mailToken, PASSWORD, signupApi, trackErrors, uniqueEmail, waitSaved } from "./helpers.js";

test("parcours complet : compte, motif, modification, enregistrement, rechargement, export", async ({ page }) => {
  const errors = trackErrors(page);
  const email = uniqueEmail("parcours");
  await page.goto("/studio/");
  await expect(page).toHaveURL(/\/studio\/login/);
  await page.getByRole("link", { name: "Créer un compte" }).click();
  await page.locator("input[name=displayName]").fill("Atelier Parcours");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.locator("input[name=acceptTerms]").check();
  await page.getByRole("button", { name: "Créer un compte" }).click();
  // Aucune session avant confirmation : le lien reçu par e-mail active le compte et connecte.
  await expect(page.getByTestId("signup-sent")).toContainText(email);
  await page.goto(`/account/verify?token=${await mailToken(page, email, "verify")}`);
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();

  // Création depuis le motif de test « Fleur » : analyse par le moteur dans un Web Worker.
  await page.getByTestId("new-design").click();
  await page.getByTestId("new-name").fill("Fleur d'été");
  await page.getByTestId("demo-02-fleur").click();
  await expect(page).toHaveURL(/\/studio\/p\//);
  await expect(page.getByTestId("stats")).toContainText("9 513 points");
  const projectId = page.url().split("/p/")[1];

  // Modification : densité de l'objet 1 (pétales), annuler, rétablir.
  await page.getByTestId("layers").getByRole("button", { name: /Couleur 1 · 1/ }).click();
  const spacing = page.getByTestId("fill-spacing");
  await spacing.fill("0.6");
  await spacing.press("Enter");
  await expect(page.getByTestId("stats")).not.toContainText("9 513 points");
  const changed = await page.getByTestId("stats").innerText();
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("stats")).toContainText("9 513 points");
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("stats")).toHaveText(changed);
  await waitSaved(page);

  // Le serveur a bien enregistré la modification.
  const saved = await getProject(page, projectId);
  expect(saved.design.objects[0].fill.spacing).toBe(0.6);
  expect(saved.name).toBe("Fleur d'été");

  // Rechargement : le projet revient tel qu'il a été laissé.
  await page.reload();
  await expect(page.getByTestId("stats")).toHaveText(changed);

  // Export PES v1 par le serveur, téléchargé et relu.
  await page.getByTestId("open-export").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
  expect(download.suggestedFilename()).toBe("Fleur-d-ete.pes");
  const bytes = await (await download.createReadStream()).toArray();
  const buf = Buffer.concat(bytes as Buffer[]);
  expect(buf.subarray(0, 8).toString("latin1")).toBe("#PES0001");
  await expect(page.getByTestId("export-history").locator("li")).toHaveCount(1);

  // Retour au tableau de bord : la miniature est calculée par le serveur.
  await page.getByRole("link", { name: "Projets" }).click();
  const card = page.getByTestId("project-list").locator("li", { hasText: "Fleur d'été" });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveJSProperty("complete", true);
  expect(await card.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // La miniature reste dans sa carte.
  const img = (await card.locator("img").boundingBox())!;
  const thumb = (await card.locator(".thumb").boundingBox())!;
  expect(img.y + img.height).toBeLessThanOrEqual(thumb.y + thumb.height + 0.5);
  expect(img.x + img.width).toBeLessThanOrEqual(thumb.x + thumb.width + 0.5);
  expect(errors).toEqual([]);
});

test("déconnexion puis reconnexion : les projets sont retrouvés", async ({ page }) => {
  const email = await signupApi(page);
  await createBlankApi(page, "Projet persistant");
  await page.goto("/studio/");
  await expect(page.getByText("Projet persistant")).toBeVisible();
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/studio\/login/);
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill(PASSWORD);
  await page.getByRole("button", { name: "Connexion" }).click();
  await expect(page.getByText("Projet persistant")).toBeVisible();
});

test("toile vierge : rectangle dessiné, déplacé, enregistré puis exporté en DST", async ({ page }) => {
  await signupApi(page);
  const p = await createBlankApi(page, "Dessin");
  await page.goto(`/studio/p/${p.id}`);
  await expect(page.getByTestId("editor")).toBeVisible();
  const c = await canvasBox(page);
  await page.getByTestId("tool-rect").click();
  await drag(page, { x: c.cx - 60, y: c.cy - 40 }, { x: c.cx + 60, y: c.cy + 40 });
  await expect(page.getByTestId("layers").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("stats")).toContainText("points");
  await waitSaved(page);
  const before = (await getProject(page, p.id)).design.objects[0].shape.outer[0];

  await page.getByTestId("tool-select").click();
  await drag(page, { x: c.cx, y: c.cy }, { x: c.cx + 50, y: c.cy });
  await waitSaved(page);
  const after = (await getProject(page, p.id)).design.objects[0].shape.outer[0];
  expect(after.x).toBeGreaterThan(before.x + 1);
  expect(after.y).toBeCloseTo(before.y, 1);

  await page.getByTestId("open-export").click();
  await page.getByLabel(/DST \(Tajima\)/).check();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-run").click()]);
  const buf = Buffer.concat((await (await download.createReadStream()).toArray()) as Buffer[]);
  expect(buf.subarray(0, 3).toString("latin1")).toBe("LA:");
  expect(buf.length).toBeGreaterThan(512);

  // Suppression de l'objet au clavier, puis annulation.
  await page.getByTestId("layers").locator("li button.layer-main").first().click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("layers")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("layers").locator("li")).toHaveCount(1);
});

test("le contrôle qualité bloque l'export d'un motif plus grand que le cadre", async ({ page }) => {
  await signupApi(page);
  const p = await createBlankApi(page, "Trop grand");
  await page.goto(`/studio/p/${p.id}`);
  const c = await canvasBox(page);
  await page.getByTestId("tool-rect").click();
  await drag(page, { x: c.x + 5, y: c.y + 5 }, { x: c.x + c.width - 5, y: c.y + c.height - 5 });
  await page.getByTestId("tab-quality").click();
  await expect(page.getByTestId("quality-panel")).toContainText("Export bloqué");
  await page.getByTestId("tab-export").click();
  await expect(page.getByTestId("export-run")).toBeDisabled();
  await expect(page.getByTestId("export-panel")).toContainText("Export impossible");
});

test("mot de passe oublié : lien reçu par e-mail, nouveau mot de passe, reconnexion", async ({ page }) => {
  const email = await signupApi(page);
  await page.request.post("/api/auth/logout", { headers: { "x-vyra-client": "web" } });
  await page.goto("/studio/forgot-password");
  await page.locator("input[name=email]").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(page.getByRole("status")).toContainText("Si un compte existe");
  const mails = await (await page.request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`)).json();
  const link = /http\S+\/account\/reset\?token=\S+/.exec(mails.emails[0].body_text)![0];
  await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page).toHaveURL(/\/studio\/reset-password/);
  await page.locator("input[name=password]").fill("un-tout-nouveau-secret");
  await page.getByRole("button", { name: "Enregistrer le mot de passe" }).click();
  await expect(page.getByRole("heading", { name: "Mes projets" })).toBeVisible();
  await page.request.post("/api/auth/logout", { headers: { "x-vyra-client": "web" } });
  const ok = await page.request.post("/api/auth/login", { headers: { "x-vyra-client": "web" }, data: { email, password: "un-tout-nouveau-secret" } });
  expect(ok.status()).toBe(200);
});

test("corbeille : mise à la corbeille, restauration, suppression définitive confirmée", async ({ page }) => {
  await signupApi(page);
  await createBlankApi(page, "À jeter");
  await page.goto("/studio/");
  await page.getByTestId("project-list").locator("li", { hasText: "À jeter" }).getByTestId("to-trash").click();
  await expect(page.getByText("Aucun projet pour l'instant")).toBeVisible();
  await page.getByTestId("trash-tab").click();
  await page.getByRole("button", { name: "Restaurer" }).click();
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();
  await page.getByRole("tab", { name: "Projets" }).click();
  await page.getByTestId("to-trash").click();
  await page.getByTestId("trash-tab").click();
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Supprimer définitivement" });
  await expect(confirm).toBeDisabled();
  await page.getByTestId("confirm-name").fill("À jeter");
  await confirm.click();
  await expect(page.getByText("La corbeille est vide.")).toBeVisible();
  expect((await (await page.request.get("/api/projects?trash=1")).json()).projects).toEqual([]);
});

test("langue et thème : enregistrés dans le profil et appliqués", async ({ page }) => {
  await signupApi(page);
  await page.goto("/studio/");
  await page.getByTestId("lang-switch").getByRole("button", { name: "NL" }).click();
  await expect(page.getByRole("heading", { name: "Mijn projecten" })).toBeVisible();
  await page.getByTestId("lang-switch").getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByTestId("lang-switch").getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("heading", { name: "My projects" })).toBeVisible();
  // auto -> clair -> sombre
  await page.getByTestId("theme-switch").click();
  await page.getByTestId("theme-switch").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await (await page.request.get("/api/auth/me")).json()).user).toMatchObject({ locale: "en", theme: "dark" });
});
