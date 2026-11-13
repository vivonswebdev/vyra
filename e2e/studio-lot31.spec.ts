// Lot 3.1 : poignées de transformation, copier/coller/dupliquer et erreurs de l'API traduites.
// Exécuté sur ordinateur (souris, clavier), tablette et mobile (toucher, boutons).
import { expect, test, type Page } from "@playwright/test";
import { canvasBox, createBlankApi, drag, getProject, PASSWORD, signupApi, uniqueEmail, waitSaved } from "./helpers.js";

type Pt = { x: number; y: number };
const touchDevice = (page: Page) => (page.viewportSize()?.width ?? 1440) < 1200;

/** Glisser au doigt (événements tactiles réels de Chromium, donc pointeurs de type « touch »). */
async function touchDrag(page: Page, from: Pt, to: Pt) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (p: Pt) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from) });
  for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt({ x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 }) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const gesture = (page: Page, from: Pt, to: Pt) => (touchDevice(page) ? touchDrag(page, from, to) : drag(page, from, to));

function bounds(o: any) {
  const pts = o.path ?? o.shape.outer;
  const xs = pts.map((p: Pt) => p.x);
  const ys = pts.map((p: Pt) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
async function handles(page: Page) {
  const c = await canvasBox(page);
  const raw = await page.getByTestId("stitch-canvas").getAttribute("data-handles");
  expect(raw, "poignées affichées pour l'objet sélectionné").toBeTruthy();
  const h = JSON.parse(raw!) as Record<string, Pt>;
  return Object.fromEntries(Object.entries(h).map(([k, p]) => [k, { x: c.x + p.x, y: c.y + p.y }])) as Record<"nw" | "ne" | "se" | "sw" | "rot", Pt>;
}
/** Projet avec un rectangle plus large que haut, dessiné à l'outil Rectangle puis sélectionné. */
async function projectWithRect(page: Page) {
  await signupApi(page);
  const p = await createBlankApi(page, "Poignées");
  await page.goto(`/studio/p/${p.id}`);
  const c = await canvasBox(page);
  await page.getByTestId("tool-rect").click();
  const s = Math.min(c.width, c.height) / 6;
  await drag(page, { x: c.cx - s, y: c.cy - s / 2 }, { x: c.cx + s / 2, y: c.cy + s / 4 });
  await page.getByTestId("tool-select").click();
  await waitSaved(page);
  const proj = await getProject(page, p.id);
  expect(proj.design.objects).toHaveLength(1);
  return { id: p.id as string, before: bounds(proj.design.objects[0]) };
}

test("poignées : agrandir par un coin (coin opposé fixe), tourner, une étape d'annulation chacune", async ({ page }) => {
  const { id, before } = await projectWithRect(page);
  let h = await handles(page);
  await gesture(page, h.se, { x: h.se.x + (h.se.x - h.nw.x) * 0.5, y: h.se.y + (h.se.y - h.nw.y) * 0.5 });
  await waitSaved(page);
  let after = bounds((await getProject(page, id)).design.objects[0]);
  expect(after.w / before.w).toBeGreaterThan(1.3);
  expect(after.w / after.h).toBeCloseTo(before.w / before.h, 1); // rapport conservé
  expect(after.minX).toBeCloseTo(before.minX, 1); // coin opposé fixe
  expect(after.minY).toBeCloseTo(before.minY, 1);

  await page.getByTestId("undo").click();
  await waitSaved(page);
  after = bounds((await getProject(page, id)).design.objects[0]);
  expect(after.w).toBeCloseTo(before.w, 2);

  // Rotation d'un quart de tour : la largeur et la hauteur s'échangent.
  h = await handles(page);
  const cx = (h.nw.x + h.se.x) / 2;
  const cy = (h.nw.y + h.se.y) / 2;
  await gesture(page, h.rot, { x: cx + (cy - h.rot.y), y: cy });
  await waitSaved(page);
  after = bounds((await getProject(page, id)).design.objects[0]);
  expect(after.w).toBeCloseTo(before.h, 0);
  expect(after.h).toBeCloseTo(before.w, 0);
  await page.getByTestId("undo").click();
  await waitSaved(page);
  after = bounds((await getProject(page, id)).design.objects[0]);
  expect(after.w).toBeCloseTo(before.w, 2);
});

test("copier, coller, dupliquer : nouveaux objets décalés, annulables, collables dans un autre projet", async ({ page }) => {
  const { id, before } = await projectWithRect(page);
  const kb = !touchDevice(page);
  if (kb) {
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
  } else {
    await page.getByTestId("copy-object").click();
    await page.getByTestId("paste-object").click();
  }
  await waitSaved(page);
  let objs = (await getProject(page, id)).design.objects;
  expect(objs).toHaveLength(2);
  expect(objs[1].id).not.toBe(objs[0].id);
  expect(objs[1].name).toMatch(/\(copie\)$/);
  expect(bounds(objs[1]).minX - before.minX).toBeCloseTo(5, 1);

  if (kb) await page.keyboard.press("Control+d");
  else await page.getByTestId("duplicate-object").click();
  await waitSaved(page);
  objs = (await getProject(page, id)).design.objects;
  expect(objs).toHaveLength(3);
  expect(new Set(objs.map((o: any) => o.id)).size).toBe(3);

  await page.getByTestId("undo").click();
  await waitSaved(page);
  expect((await getProject(page, id)).design.objects).toHaveLength(2);

  // Coller dans un autre projet : l'objet et son fil suivent.
  const other = await page.request.post("/api/projects", {
    headers: { "x-vyra-client": "web" },
    data: { name: "Autre", design: { name: "Autre", widthMm: 100, heightMm: 100, threads: [{ rgb: "#ffffff", name: "Blanc", brand: "", code: "" }], objects: [] } },
  });
  const otherId = (await other.json()).project.id;
  await page.goto(`/studio/p/${otherId}`);
  await expect(page.getByTestId("paste-object")).toBeEnabled();
  await page.getByTestId("paste-object").click();
  await waitSaved(page);
  const d = (await getProject(page, otherId)).design;
  expect(d.objects).toHaveLength(1);
  expect(d.threads.map((t: any) => t.rgb)).toEqual(["#ffffff", "#5a3a28"]);
  expect(d.objects[0].color).toBe(1);
});

test("erreurs de l'API affichées dans la langue choisie (arabe, néerlandais)", async ({ page }) => {
  const email = await signupApi(page);
  await page.context().clearCookies();
  await page.goto("/studio/");
  await page.getByTestId("lang-switch").getByRole("button", { name: "ع" }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.locator("input[name=email]").fill(email);
  await page.locator("input[name=password]").fill("mauvais-" + PASSWORD);
  await page.locator("input[name=password]").press("Enter");
  await expect(page.getByRole("alert")).toHaveText("البريد الإلكتروني أو كلمة المرور غير صحيحة.");

  await page.getByTestId("lang-switch").getByRole("button", { name: "NL" }).click();
  await page.goto("/studio/signup");
  await page.locator("input[name=email]").fill(uniqueEmail("nl"));
  await page.locator("input[name=password]").fill("kort");
  await page.locator("input[name=displayName]").fill("Atelier");
  await page.locator("input[name=acceptTerms]").check();
  await page.locator("input[name=password]").press("Enter");
  await expect(page.getByText("Minstens 10 tekens.")).toBeVisible();
});
