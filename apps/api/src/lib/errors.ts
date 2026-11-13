// Erreurs HTTP de l'API. `code` est la catégorie stable (contrat existant) ; `reason` précise le cas pour que
// les applications affichent un message traduit (clé `apierr.<reason>` en FR, NL, EN et AR) ; `params` porte
// les valeurs à insérer. `message` reste un texte français lisible pour les journaux et les clients bruts.
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public reason?: string,
    public params?: Record<string, string | number>,
  ) {
    super(message);
  }
}

export const badRequest = (reason: string, message: string, details?: unknown, params?: Record<string, string | number>) =>
  new HttpError(400, "bad_request", message, details, reason, params);
export const unauthorized = (reason = "unauthorized", message = "Connexion requise.") => new HttpError(401, "unauthorized", message, undefined, reason);
export const forbidden = (reason = "forbidden", message = "Accès refusé.") => new HttpError(403, "forbidden", message, undefined, reason);
export const notFound = (reason = "not_found", message = "Introuvable.") => new HttpError(404, "not_found", message, undefined, reason);
export const conflict = (reason: string, message: string, details?: unknown) => new HttpError(409, "conflict", message, details, reason);
