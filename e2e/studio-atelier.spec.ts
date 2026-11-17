// Atelier vêtement : la broderie du projet, à taille réelle, sur un vêtement simulé ; patron 2D relié ; textes
// imprimés d'aperçu ; mise en scène gardée dans le navigateur.
import { expect, test, type Page } from "@playwright/test";
import { signupApi, trackErrors, waitSaved } from "./helpers";

/** Somme d'échantillons de pixels d'un canevas (0 si vide), pour vérifier qu'il dessine et qu'il change. */
const sample = (page: Page, id: string) =>
  page.getByTestId(id).evaluate((c: HTMLCanvasElement) => {
    const probe = document.createElement("canvas");
    probe.width = 160; probe.height = 120;
    const ctx = probe.getContext("2d")!;
    ctx.drawImage(c, 0, 0, probe.width, probe.height);
    const d = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3];
    return sum;
  });

test("atelier : broderie du projet sur un vêtement 3D et un patron 2D, textes imprimés, mise en scène gardée", async ({ page }) => {
  const errors = trackErrors(page);
  await signupApi(page);
  await page.goto("/studio/");
  await page.getByTestId("new-design").click();
  await page.getByTestId("demo-02-fleur").click();
  await page.waitForURL(/\/studio\/p\//);
  await waitSaved(page);
  const id = page.url().split("/p/")[1];

  await page.goto(`/studio/p/${id}/atelier`);
  await expect(page.getByTestId("atelier")).toBeVisible();
  const layers = page.getByTestId("at-layers").getByRole("listitem");
  await expect(layers).toHaveCount(2);
  await expect(page.getByTestId("at-layers")).toContainText("Broderie du projet");

  // La broderie est montrée à sa taille réelle et ne se redimensionne pas ici.
  await page.getByTestId("at-layers").getByRole("button", { name: /Broderie du projet/ }).click();
  await expect(page.getByTestId("at-props")).toContainText(/Taille réelle : \d+,\d × \d+,\d cm/);

  // Les deux vues dessinent réellement.
  await expect.poll(() => sample(page, "at-3d")).toBeGreaterThan(0);
  await expect.poll(() => sample(page, "at-2d")).toBeGreaterThan(0);

  // Changer de vêtement change le patron.
  const before = await sample(page, "at-2d");
  await page.getByRole("group", { name: "Vêtement" }).getByRole("button", { name: "Hoodie" }).click();
  await expect.poll(() => sample(page, "at-2d")).not.toBe(before);

  // Texte imprimé d'aperçu : ajouté, modifié, il apparaît dans le patron.
  await page.getByTestId("at-add-text").click();
  await expect(layers).toHaveCount(3);
  const withText = await sample(page, "at-2d");
  await page.getByTestId("at-text").fill("ATELIER VYRA");
  await expect(page.getByTestId("at-layers")).toContainText("ATELIER VYRA");
  await expect.poll(() => sample(page, "at-2d")).not.toBe(withText);

  // Rendu tissu et redrapé : aucune erreur.
  await page.getByRole("button", { name: "Marine" }).click();
  await page.getByTestId("at-redrape").click();

  // Mise en scène gardée dans ce navigateur, par projet.
  await page.reload();
  await expect(page.getByTestId("at-layers").getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("group", { name: "Vêtement" }).getByRole("button", { name: "Hoodie" })).toHaveAttribute("aria-pressed", "true");

  // L'éditeur propose l'atelier.
  await page.goto(`/studio/p/${id}`);
  await page.getByTestId("tab-export").click();
  await expect(page.getByTestId("open-atelier")).toHaveAttribute("href", `/studio/p/${id}/atelier`);
  expect(errors).toEqual([]);
});

test("atelier : image importée et motif continu sur tout le vêtement (devant, manches, dos)", async ({ page }) => {
  const errors = trackErrors(page);
  await signupApi(page);
  await page.goto("/studio/");
  await page.getByTestId("new-design").click();
  await page.getByTestId("demo-02-fleur").click();
  await page.waitForURL(/\/studio\/p\//);
  await waitSaved(page);
  const id = page.url().split("/p/")[1];
  await page.goto(`/studio/p/${id}/atelier`);
  await expect(page.getByTestId("atelier")).toBeVisible();
  const layers = page.getByTestId("at-layers").getByRole("listitem");
  await expect(layers).toHaveCount(2);
  await expect.poll(() => sample(page, "at-2d")).toBeGreaterThan(0);

  // Image : importée, posée sur le devant, puis étendue à tout le vêtement.
  const before = await sample(page, "at-2d");
  await page.getByTestId("at-image-file").setInputFiles("packages/engine/fixtures/motifs/02-fleur.png");
  await expect(layers).toHaveCount(3);
  await expect(page.getByTestId("at-layers")).toContainText("02-fleur.png");
  await expect.poll(() => sample(page, "at-2d")).not.toBe(before);
  await page.getByRole("group", { name: "Pièce" }).getByRole("button", { name: "Tout le vêtement" }).click();
  await expect(page.getByTestId("at-props")).toContainText("Motif continu");
  const onSheet = await sample(page, "at-2d");
  await page.locator("#at-img-w").fill("120");
  await expect.poll(() => sample(page, "at-2d")).not.toBe(onSheet);

  // Forme : une bande sur toute la feuille, donc tout le tour du vêtement.
  const withImage = await sample(page, "at-2d");
  await page.getByTestId("at-add-shape").click();
  await expect(layers).toHaveCount(4);
  await expect(page.getByTestId("at-layers")).toContainText("Tout le vêtement");
  await expect.poll(() => sample(page, "at-2d")).not.toBe(withImage);
  await expect.poll(() => sample(page, "at-3d")).toBeGreaterThan(0);

  // Gardés dans ce navigateur, image comprise.
  await page.reload();
  await expect(page.getByTestId("at-layers").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("at-layers")).toContainText("02-fleur.png");
  expect(errors).toEqual([]);
});
