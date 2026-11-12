export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, "bad_request", message, details);
export const unauthorized = (message = "Connexion requise.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Accès refusé.") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Introuvable.") => new HttpError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, "conflict", message, details);
