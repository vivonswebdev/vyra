// Mise en page sur ordinateur, tablette et mobile : aucune barre de défilement horizontale,
// zone de travail dominante, panneaux accessibles au toucher.
import { expect, test } from "@playwright/test";
import { createBlankApi, signupApi } from "./helpers.js";

const noHorizontalScroll = async (page: import("@playwright/test").Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("tableau de bord et éditeur utilisables à cette largeur", async ({ page }) => {
  await signupApi(page);
  const p = await createBlankApi(page, "Responsive");
  await page.goto("/studio/");
  await expect(page.getByText("Responsive")).toBeVisible();
  await noHorizontalScroll(page);

  await page.goto(`/studio/p/${p.id}`);
  const canvas = await page.getByTestId("stitch-canvas").boundingBox();
  const vp = page.viewportSize()!;
  expect(canvas!.width * canvas!.height).toBeGreaterThan(vp.width * vp.height * 0.35);
  await noHorizontalScroll(page);

  // Les réglages (fils) restent atteignables sans clavier ni souris.
  await page.getByTestId("tab-threads").click();
  await expect(page.getByTestId("threads-panel")).toBeVisible();
  await expect(page.getByTestId("threads-panel").locator("input[type=color]")).toHaveCount(1);
  // Les calques sont accessibles à toutes les largeurs.
  if (vp.width < 1200) await page.getByTestId("tab-layers").click();
  await expect(page.getByText("Aucun objet.")).toBeVisible();
});

test("la barre supérieure de l'éditeur tient dans la largeur de l'écran", async ({ page }) => {
  await signupApi(page);
  const p = await createBlankApi(page, "Un nom de projet assez long pour tester la barre");
  await page.goto(`/studio/p/${p.id}`);
  const vp = page.viewportSize()!;
  for (const id of ["user-menu", "open-export", "undo", "redo"]) {
    const b = await page.getByTestId(id).boundingBox();
    expect(b!.x + b!.width, id).toBeLessThanOrEqual(vp.width + 0.5);
  }
});
