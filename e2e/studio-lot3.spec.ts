// Compléments du Studio (lot 3) : import d'un projet v0.2, superposition de l'image source,
// fiche de préparation imprimable, nuanciers CSV.
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signupApi, trackErrors } from "./helpers.js";

test("import d'un projet .stitch.json de l'ancien Studio", async ({ page }) => {
  const errors = trackErrors(page);
  await signupApi(page);
  await page.goto("/studio/");
  await page.getByTestId("new-design").click();
  await page.getByTestId("project-file-input").setInputFiles(path.resolve("e2e/fixtures/02-fleur-v0.2.stitch.json"));
  await expect(page).toHaveURL(/\/studio\/p\//);
  await expect(page.getByTestId("stats")).toContainText("9 513 points");
  expect(errors).toEqual([]);
});

test("superposition de l'image source, fiche de préparation et nuancier CSV", async ({ page }) => {
  await signupApi(page);
  await page.goto("/studio/");
  await page.getByTestId("new-design").click();
  await page.getByTestId("demo-02-fleur").click();
  await expect(page.getByTestId("stats")).toContainText("9 513 points");

  // L'image source modifie réellement les pixels du canevas.
  const sample = () =>
    page.getByTestId("stitch-canvas").evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 97) sum += d[i];
      return sum;
    });
  await page.waitForTimeout(300);
  const before = await sample();
  await page.getByTestId("show-source").check();
  await expect.poll(sample).not.toBe(before);

  // Fiche de préparation : 5 blocs de couleur, total des points.
  const id = page.url().split("/p/")[1];
  await page.goto(`/studio/p/${id}/fiche`);
  const sheet = page.getByTestId("prep-sheet");
  await expect(sheet.locator("tbody tr")).toHaveCount(5);
  await expect(sheet).toContainText("9 513");
  const total = await sheet.locator("tbody tr td:nth-child(6)").allInnerTexts();
  expect(total.map((x) => Number(x.replace(/\D/g, ""))).reduce((a, b) => a + b, 0)).toBe(9513);

  // Nuancier CSV importé puis appliqué à un fil.
  await page.goto(`/studio/p/${id}`);
  await page.getByTestId("tab-threads").click();
  const charts = page.getByTestId("charts");
  await charts.locator("summary").click();
  await charts.locator("input[name=brand]").fill("Atelier");
  await charts.locator("input[name=product]").fill("Relevé maison");
  await charts.locator("select[name=status]").selectOption("utilisateur");
  await charts.locator("input[name=source]").fill("Relevé au colorimètre, novembre 2026");
  await charts.getByTestId("chart-file").setInputFiles({ name: "nuancier.csv", mimeType: "text/csv", buffer: Buffer.from("code;nom;hex\nR-1;Rose;#E8508A\nV-2;Vert;#5FB35F\n") });
  await charts.getByRole("button", { name: "Importer un nuancier CSV" }).click();
  await expect(charts.getByTestId("chart-select")).toContainText("Atelier — Relevé maison");
  await expect(charts).toContainText("R-1");
  await charts.locator(".chart-match", { hasText: "R-1" }).first().getByRole("button", { name: "Utiliser" }).click();
  await expect(page.getByTestId("threads-panel").locator("input[aria-label=Référence]").first()).toHaveValue("R-1");
});
