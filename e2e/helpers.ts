import { expect, type Page } from "@playwright/test";

export const PASSWORD = "motdepasse-solide-42";
const H = { "x-vyra-client": "web" };

export function uniqueEmail(tag = "e2e") {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
}

/** Inscription par l'API : le cookie de session est partagé avec la page. */
export async function signupApi(page: Page, email = uniqueEmail()) {
  const r = await page.request.post("/api/auth/signup", { headers: H, data: { email, password: PASSWORD, displayName: "Atelier E2E", acceptTerms: true, locale: "fr" } });
  expect(r.status()).toBe(201);
  return email;
}

export async function createBlankApi(page: Page, name = "Toile E2E") {
  const r = await page.request.post("/api/projects", {
    headers: H,
    data: { name, design: { name, widthMm: 100, heightMm: 100, threads: [{ rgb: "#5a3a28", name: "Brun", brand: "", code: "" }], objects: [] }, settings: { machineId: "brother-xe1", hoopId: "sa439s" } },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).project as { id: string; name: string };
}

export async function getProject(page: Page, id: string) {
  const r = await page.request.get(`/api/projects/${id}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()).project;
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId("save-state")).toHaveText("Enregistré", { timeout: 20_000 });
}

export async function canvasBox(page: Page) {
  const box = await page.getByTestId("stitch-canvas").boundingBox();
  if (!box) throw new Error("canevas introuvable");
  return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}

export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}
