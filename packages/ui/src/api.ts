// Client d'API : même origine, cookie de session httpOnly, en-tête anti-CSRF sur chaque écriture.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public reason?: string,
    public params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        ...(method === "GET" ? {} : { "x-vyra-client": "web" }),
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
        accept: "application/json",
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      ...init,
    });
  } catch {
    throw new ApiError(0, "offline", "offline");
  }
  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? `HTTP ${res.status}`, e.details, e.reason, e.params);
  }
  return json as T;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

export const get = <T = any>(url: string) => api<T>("GET", url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>("POST", url, body);
export const patch = <T = any>(url: string, body: unknown = {}) => api<T>("PATCH", url, body);
export const del = <T = any>(url: string, body?: unknown) => api<T>("DELETE", url, body);

/** Erreurs de validation par champ, pour les formulaires (`text` traduit chaque détail). */
export function fieldErrors(e: unknown, text: (d: any) => string = (d) => d.message): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== "validation" || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details) if (d?.path && !out[d.path]) out[d.path] = text(d);
  return out;
}

/** Télécharge un fichier servi par l'API (contrôle d'accès côté serveur). */
export async function downloadUrl(url: string, filename: string) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "download", `HTTP ${res.status}`);
  saveBlob(await res.blob(), filename);
}

export function saveBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
