// Contrats d'API partagés entre le serveur et les applications.
// Le serveur valide chaque entrée avec ces schémas ; les applications s'en servent pour leurs formulaires.
import { z } from "zod";

export const LANGS = ["fr", "nl", "en", "ar"] as const;
export type Lang = (typeof LANGS)[number];
export const THEMES = ["auto", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const email = z.string().trim().toLowerCase().pipe(z.email({ error: "Adresse e-mail invalide." })).pipe(z.string().max(254));
export const PASSWORD_MIN = 10;
const password = z
  .string()
  .min(PASSWORD_MIN, { error: `Au moins ${PASSWORD_MIN} caractères.` })
  .max(200, { error: "200 caractères au plus." });
const displayName = z.string().trim().min(1, { error: "Nom requis." }).max(80);

export const SignupInput = z.object({
  email,
  password,
  displayName,
  locale: z.enum(LANGS).default("fr"),
  acceptTerms: z.literal(true, { error: "Vous devez accepter les conditions d'utilisation." }),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const LoginInput = z.object({ email, password: z.string().min(1).max(200) });
export type LoginInput = z.infer<typeof LoginInput>;

export const ForgotPasswordInput = z.object({ email });
export const ResetPasswordInput = z.object({ token: z.string().min(20).max(200), password });
export const VerifyEmailInput = z.object({ token: z.string().min(20).max(200) });
export const ChangePasswordInput = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });

export const UpdateProfileInput = z.object({
  displayName: displayName.optional(),
  locale: z.enum(LANGS).optional(),
  theme: z.enum(THEMES).optional(),
  preferences: z
    .object({
      defaultMachineId: z.string().max(80).optional(),
      defaultHoopId: z.string().max(80).optional(),
      uiMode: z.enum(["simple", "expert"]).optional(),
      units: z.enum(["mm", "in"]).optional(),
    })
    .partial()
    .optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInput>;

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  locale: Lang;
  theme: Theme;
  roles: string[];
  preferences: Record<string, unknown>;
  createdAt: string;
}

// ------------------------------------------------------------------ Projets Studio

/** Réglages du projet hors document de broderie : machine, cadre, options d'analyse, source. */
export const ProjectSettings = z
  .object({
    machineId: z.string().max(80).optional(),
    hoopId: z.string().max(80).optional(),
    traceOptions: z.record(z.string(), z.unknown()).optional(),
    sourceFileId: z.uuid().nullable().optional(),
    sourceName: z.string().max(200).optional(),
    demoMotif: z.string().max(80).optional(),
  })
  .passthrough();
export type ProjectSettings = z.infer<typeof ProjectSettings>;

/**
 * Document de broderie (Design du moteur). Validation structurelle légère côté API :
 * le moteur reste l'autorité sur le contenu ; la taille est bornée par la limite du corps.
 */
export const DesignDoc = z
  .object({
    name: z.string().max(200),
    widthMm: z.number().finite().nonnegative(),
    heightMm: z.number().finite().nonnegative(),
    threads: z.array(z.object({ rgb: z.string().regex(/^#[0-9a-fA-F]{6}$/), name: z.string().max(120), brand: z.string().max(120), code: z.string().max(60) }).passthrough()).max(255),
    objects: z.array(z.object({ id: z.string().max(80), type: z.string().max(40), color: z.number().int().min(0) }).passthrough()).max(5000),
  })
  .passthrough();

export const ProjectCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  design: DesignDoc.nullable().optional(),
  settings: ProjectSettings.optional(),
});
export type ProjectCreateInput = z.infer<typeof ProjectCreateInput>;

export const ProjectUpdateInput = z.object({
  baseRevision: z.number().int().min(0),
  name: z.string().trim().min(1).max(120).optional(),
  design: DesignDoc.nullable().optional(),
  settings: ProjectSettings.optional(),
  /** Crée un point de l'historique des versions (enregistrement explicite). */
  snapshot: z.boolean().optional(),
  snapshotLabel: z.string().trim().max(120).optional(),
});
export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInput>;

export const ExportInput = z.object({ format: z.enum(["pes", "pes6", "dst"]) });

export interface ProjectSummaryDTO {
  id: string;
  name: string;
  revision: number;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
  hasDesign: boolean;
  stats: { objects: number; colors: number; widthMm: number; heightMm: number } | null;
  thumbnailUrl: string | null;
}

export interface ProjectDTO extends ProjectSummaryDTO {
  design: unknown | null;
  settings: ProjectSettings;
}

export interface ProjectVersionDTO {
  id: string;
  revision: number;
  label: string | null;
  createdAt: string;
}

export interface ExportDTO {
  id: string;
  format: "pes" | "pes6" | "dst";
  filename: string;
  size: number;
  sha256: string;
  revision: number;
  stats: Record<string, number>;
  createdAt: string;
  downloadUrl: string;
}

export interface FileDTO {
  id: string;
  kind: string;
  filename: string;
  mime: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
