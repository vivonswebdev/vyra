// Façade publique du moteur de broderie VYRA.
//
// Contrat : l'interface (Studio, Market, API) n'appelle jamais src/generated/engine.js
// directement ; elle passe par ces fonctions typées. Le moteur lui-même est figé
// (voir scripts/extract.mjs et test/reference.test.ts).

import * as E from "./generated/engine.js";
import type {
  Design,
  DesignObject,
  ExportFormat,
  Hoop,
  Lang,
  MachineProfile,
  Plan,
  PlanStats,
  PlanStitch,
  Point,
  QualityIssue,
  QualityReport,
  RasterImage,
  Shape,
  StitchType,
  StrategyItem,
  Thread,
  ThreadChart,
  TraceOptions,
  TraceResult,
  TranslatedText,
} from "./types.js";
import { readEmbroidery as readRaw, type ReadResult } from "./readers/index.js";

export * from "./types.js";
export { detectFormat, readPES, readDST, EmbroideryReadError, CMD, type ReadResult } from "./readers/index.js";

export const ENGINE_VERSION = "0.2.0";

// Commandes de point
export const STITCH = E.STITCH as 0;
export const JUMP = E.JUMP as 1;
export const TRIM = E.TRIM as 2;
export const END = E.END as 4;
export const COLOR_CHANGE = E.COLOR_CHANGE as 5;

// Paramètres et référentiels
export const DEFAULT_FILL = E.DEFAULT_FILL as DesignObject["fill"];
export const DEFAULT_SATIN = E.DEFAULT_SATIN as DesignObject["satin"];
export const DEFAULT_RUN = E.DEFAULT_RUN as DesignObject["run"];
export const DEFAULT_TRACE_OPTIONS = E.DEFAULT_TRACE_OPTIONS as TraceOptions;
export const QC_THRESHOLDS = E.QC_THRESHOLDS as Record<string, number>;
export const STITCH_TYPES = E.STITCH_TYPES as StitchType[];
export const MACHINES = E.MACHINES as MachineProfile[];
export const PEC_PALETTE = E.PEC_PALETTE as Thread[];
export const PEC_CHART = E.PEC_CHART as ThreadChart;
export const PENDING_CHARTS = E.PENDING_CHARTS as { brand: string; product: string; note: string }[];
export const CHART_BRANDS = E.CHART_BRANDS as string[];
export const DEMO_MOTIFS = E.DEMO_MOTIFS as string[];
export const DEMO_COLORS = E.DEMO_COLORS as Record<string, number>;
export const QC_LABELS = E.QC_LABELS as Record<string, [string, string, string, string]>;
export const REFERENCE_FINGERPRINTS_FILE = E.REFERENCE_FINGERPRINTS_FILE as string;
export const MAX_IMAGE_PX = E.MAX_IMAGE_PX as number;

/** Types de point applicables à un objet : surfaces ou tracés ouverts. */
export function stitchTypesFor(obj: Pick<DesignObject, "path">): StitchType[] {
  return STITCH_TYPES.filter((t) => !obj.path || !["fill", "satin", "applique"].includes(t));
}

// ---------------------------------------------------------------- Analyse et plan

/** Options utilisées par le Studio pour un motif (largeur cible 100 mm, hauteur max 170 mm). */
export function traceOptions(overrides: Partial<TraceOptions> = {}): TraceOptions {
  return { ...DEFAULT_TRACE_OPTIONS, targetWidthMm: 100, maxHeightMm: 170, ...overrides };
}

export function traceImage(img: RasterImage, options: TraceOptions, name: string): TraceResult {
  return E.traceImage(img, options, name) as TraceResult;
}

export function buildPlan(design: Design): Plan {
  return E.buildPlan(design) as Plan;
}

export function computeStats(plan: Pick<Plan, "stitches">): PlanStats {
  return E.computeStats(plan) as PlanStats;
}

export function runQualityChecks(design: Design, plan: Plan, machine: MachineProfile, hoop: Hoop | null): QualityReport {
  return E.runQualityChecks(design, plan, machine, hoop) as QualityReport;
}

export function stitchThreadIndex(plan: Pick<Plan, "stitches">): Int16Array {
  return E.stitchThreadIndex(plan) as Int16Array;
}

export function findMachine(id: string | null | undefined): MachineProfile {
  return MACHINES.find((m) => m.id === id) ?? MACHINES[0];
}

export function findHoop(machine: MachineProfile, hoopId: string | null | undefined): Hoop | null {
  return machine.hoops.find((h) => h.id === hoopId) ?? machine.hoops[0] ?? null;
}

export interface Analysis {
  plan: Plan;
  stats: PlanStats;
  qc: QualityReport;
}

/** Plan, statistiques et contrôle qualité d'un document pour une machine et un cadre. */
export function analyze(design: Design, machineId?: string | null, hoopId?: string | null): Analysis {
  const plan = buildPlan(design);
  const machine = findMachine(machineId);
  return { plan, stats: computeStats(plan), qc: runQualityChecks(design, plan, machine, findHoop(machine, hoopId)) };
}

// ---------------------------------------------------------------- Export

export class ExportBlockedError extends Error {
  constructor(public issues: QualityIssue[]) {
    super("Export bloqué : " + issues.map((i) => i.message).join(" ; "));
    this.name = "ExportBlockedError";
  }
}

export const EXPORT_FORMATS: Record<ExportFormat, { ext: string; label: string; mime: string }> = {
  pes: { ext: ".pes", label: "PES v1", mime: "application/octet-stream" },
  pes6: { ext: "-v6.pes", label: "PES v6", mime: "application/octet-stream" },
  dst: { ext: ".dst", label: "DST (Tajima)", mime: "application/octet-stream" },
};

/** Encode un plan. N'applique pas le contrôle qualité : voir exportDesign. */
export function encodePlan(plan: Plan, format: ExportFormat, label: string): Uint8Array {
  if (format === "pes") return E.writePES1(plan, label) as Uint8Array;
  if (format === "pes6") return E.writePES6(plan, label) as Uint8Array;
  if (format === "dst") return E.writeDST(plan, label) as Uint8Array;
  throw new Error("Format inconnu : " + format);
}

/**
 * Export machine d'un document : refusé tant qu'une erreur bloquante existe
 * (règle métier du Studio v0.2, conservée).
 */
export function exportDesign(
  design: Design,
  format: ExportFormat,
  opts: { label: string; machineId?: string | null; hoopId?: string | null },
): { bytes: Uint8Array; filename: string; analysis: Analysis } {
  const analysis = analyze(design, opts.machineId, opts.hoopId);
  if (analysis.qc.blocking) throw new ExportBlockedError(analysis.qc.issues.filter((i) => i.level === "error"));
  const bytes = encodePlan(analysis.plan, format, opts.label);
  return { bytes, filename: safeFileName(opts.label) + EXPORT_FORMATS[format].ext, analysis };
}

export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "motif"
  );
}

export function planToSvg(plan: Plan, title: string): string {
  return (E.planToSvg(plan, title) as string).replace("aperçu StitchStudio AI", "aperçu VYRA");
}

export function zipSingleFile(name: string, bytes: Uint8Array): Uint8Array {
  return E.zipSingleFile(name, bytes) as Uint8Array;
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string | null> {
  return (await E.sha256Hex(bytes)) as string | null;
}

// ---------------------------------------------------------------- Lecture de fichiers

export function readEmbroidery(bytes: Uint8Array): ReadResult {
  return readRaw(bytes, PEC_PALETTE);
}

export interface TechnicalSheet {
  format: "PES" | "DST";
  version: string | null;
  stitches: number;
  colorChanges: number;
  colors: number;
  trims: number;
  jumps: number;
  widthMm: number;
  heightMm: number;
  maxStitchMm: number;
  threadLengthM: number;
  estMinutes: number;
  threads: Thread[];
  warnings: string[];
}

/** Fiche technique lue dans un fichier PES ou DST (aucune donnée supposée). */
export function technicalSheet(bytes: Uint8Array): { sheet: TechnicalSheet; plan: Plan } {
  const r = readEmbroidery(bytes);
  const plan: Plan = {
    stitches: r.stitches,
    threads: r.threads,
    objectRanges: [],
    diag: { trims: { couleur: 0, entreObjets: 0, dansObjet: 0 }, travelMm: 0, travelSegments: 0 },
  };
  const s = computeStats(plan);
  return {
    plan,
    sheet: {
      format: r.format,
      version: r.version,
      stitches: s.stitches,
      colorChanges: s.colorChanges,
      colors: r.threads.length,
      trims: s.trims,
      jumps: s.jumps,
      widthMm: round1(s.widthMm),
      heightMm: round1(s.heightMm),
      maxStitchMm: round1(s.maxStitchMm),
      threadLengthM: round1(s.threadLengthM),
      estMinutes: Math.round(s.estMinutes),
      threads: r.threads,
      warnings: r.warnings,
    },
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- Édition

export function createObject(
  id: string,
  type: StitchType,
  color: number,
  shape: Shape,
  path?: Point[],
): DesignObject {
  return E.createObject(id, type, color, shape, path) as DesignObject;
}

export function mapObjectPoints(obj: DesignObject, fn: (p: Point) => Point): DesignObject {
  return E.mapObjectPoints(obj, fn) as DesignObject;
}

export function objectBounds(obj: DesignObject): { minX: number; minY: number; maxX: number; maxY: number } {
  return E.objectBounds(obj);
}

export function objectCenter(obj: DesignObject): Point {
  return E.objectCenter(obj) as Point;
}

export function hitTestObject(design: Design, p: Point, tolerance: number): DesignObject | null {
  return E.hitTestObject(design, p, tolerance) as DesignObject | null;
}

export function simplifyPath(points: Point[], tolerance: number): Point[] {
  return E.simplifyPath(points, tolerance) as Point[];
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  return E.pointSegmentDistance(p, a, b) as number;
}

export function distance(a: Point, b: Point): number {
  return E.distance(a, b) as number;
}

export function nearestPecThread(rgb: string): Thread {
  return E.nearestPecThread(rgb) as Thread;
}

export function threadFromChartEntry(entry: Thread): Thread {
  return E.threadFromChartEntry(entry) as Thread;
}

export function matchChartEntries(rgb: string, chart: ThreadChart, n = 3) {
  return E.matchChartEntries(rgb, chart, n) as { entry: Thread & { code: string }; delta: number }[];
}

export function parseChartCsv(text: string, meta: Partial<ThreadChart>) {
  return E.parseChartCsv(text, meta) as { chart: ThreadChart | null; errors: string[] };
}

export function planBounds(plan: Pick<Plan, "stitches">) {
  return E.planBounds(plan) as { minX: number; minY: number; maxX: number; maxY: number };
}

// ---------------------------------------------------------------- Traductions des messages du moteur

export function translateIssue(lang: Lang, issue: QualityIssue, ctx: { hoop?: string; model?: string } = {}): TranslatedText {
  return E.translateIssue(lang, issue, ctx) as TranslatedText;
}

export function translateStrategy(lang: Lang, item: StrategyItem): TranslatedText {
  return E.translateStrategy(lang, item) as TranslatedText;
}

export function translateHoopSource(lang: Lang, hoop: Hoop): TranslatedText {
  return E.translateHoopSource(lang, hoop) as TranslatedText;
}

export function translateMachineNote(lang: Lang, note: string): TranslatedText {
  return E.translateMachineNote(lang, note) as TranslatedText;
}

export function translateChartSource(lang: Lang, source: string): TranslatedText {
  return E.translateChartSource(lang, source) as TranslatedText;
}

export function qcLabel(lang: Lang, code: string): string {
  const row = QC_LABELS[code];
  const i = ["fr", "nl", "en", "ar"].indexOf(lang);
  return row?.[i] ?? code;
}

// ---------------------------------------------------------------- Registre d'essais et empreintes

export type TrialStatus = "untested" | "planned" | "running" | "success" | "reserves" | "failure" | "insufficient";

export interface RegistrySummary {
  available: boolean;
  overall: TrialStatus;
  total: number;
  tested: number;
  counts: Record<TrialStatus, number>;
  files: { path: string; format: string; status: TrialStatus; date: string | null; registryStatus: string | null }[];
  reference: string | null;
}

export function summarizeRegistry(registry: unknown): RegistrySummary {
  return E.summarizeRegistry(registry) as RegistrySummary;
}

/** Empreintes SHA-256 de référence : empreinte -> chemin relatif (sans « 13_EXPORTS/ »). */
export function parseFingerprints(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const [hash, file] = s.split(/\s+/);
    if (/^[0-9a-f]{64}$/.test(hash) && file) map.set(hash, file.replace(/^13_EXPORTS\//, ""));
  }
  return map;
}

export type { PlanStitch };
