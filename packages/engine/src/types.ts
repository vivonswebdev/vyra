// Contrats de données du moteur VYRA. Ces types décrivent exactement les structures
// produites et consommées par src/generated/engine.js (v0.2.x) ; ils ne changent pas
// son comportement. Unités : millimètres, angles en degrés, couleurs en #rrggbb.

export type Lang = "fr" | "nl" | "en" | "ar";

export interface Point {
  x: number;
  y: number;
}

export interface Shape {
  outer: Point[];
  holes: Point[][];
}

export type StitchType =
  | "fill"
  | "satin"
  | "satinBorder"
  | "zigzag"
  | "running"
  | "triple"
  | "bean"
  | "applique";

export interface FillParams {
  angle: number;
  spacing: number;
  stitchLength: number;
  stagger: number;
  pullComp: number;
  underlay: "none" | "edge" | "tatami" | "edge+tatami" | string;
  underlaySpacing: number;
  underlayInset: number;
}

export interface SatinParams {
  angle: number | null;
  spacing: number;
  pullComp: number;
  underlay: "none" | "center" | "edge" | "zigzag" | string;
  width: number;
}

export interface RunParams {
  stitchLength: number;
  repeats: number;
}

export interface Thread {
  rgb: string;
  name: string;
  brand: string;
  code: string;
}

export interface DesignObject {
  id: string;
  name: string;
  type: StitchType;
  /** Indice dans Design.threads */
  color: number;
  shape: Shape;
  /** Tracé ouvert (points droits, triple, bean, satin de bordure) */
  path?: Point[];
  closed: boolean;
  fill: FillParams;
  satin: SatinParams;
  run: RunParams;
  visible: boolean;
}

/** Document de travail du Studio : ce qui est enregistré dans un projet. */
export interface Design {
  name: string;
  widthMm: number;
  heightMm: number;
  threads: Thread[];
  objects: DesignObject[];
}

/** Commandes de point (valeurs du moteur). */
export type StitchCommand = 0 | 1 | 2 | 4 | 5;

export interface PlanStitch {
  x: number;
  y: number;
  c: StitchCommand;
  obj?: number;
}

export interface ObjectRange {
  objectId: string;
  start: number;
  end: number;
  color: number;
}

export interface Plan {
  stitches: PlanStitch[];
  threads: Thread[];
  objectRanges: ObjectRange[];
  diag: {
    trims: { couleur: number; entreObjets: number; dansObjet: number };
    travelMm: number;
    travelSegments: number;
  };
}

export interface PlanStats {
  stitches: number;
  jumps: number;
  trims: number;
  colorChanges: number;
  widthMm: number;
  heightMm: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  maxStitchMm: number;
  threadLengthM: number;
  estMinutes: number;
}

export type IssueLevel = "error" | "warning" | "info";

export interface QualityIssue {
  level: IssueLevel;
  code: string;
  message: string;
  objectId?: string;
  value?: number;
  at?: Point[];
}

export interface QualityReport {
  issues: QualityIssue[];
  blocking: boolean;
  densityMax: number;
}

export interface Hoop {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  source: string;
  confirmed: boolean;
}

export interface MachineProfile {
  id: string;
  brand: string;
  model: string;
  formats: string[];
  maxFieldMm: { w: number; h: number } | null;
  maxStitches: number | null;
  maxColors: number | null;
  hoops: Hoop[];
  /** « vérifié » = fiche technique sourcée, jamais un essai physique. */
  status: string;
  sources: string[];
  notes: string;
}

export type BackgroundMode = "auto" | "none" | string;

export interface TraceOptions {
  colors: number;
  targetWidthMm: number;
  maxHeightMm: number;
  removeBackground: BackgroundMode;
  minDetailMm2: number;
  satinMaxWidthMm: number;
  runMaxWidthMm: number;
  overlapMm: number;
  smoothing: number;
  simplifyPx: number;
}

export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface StrategyItem {
  id: string;
  color: number;
  type: StitchType;
  areaMm2: number;
  widthMm: number;
  reason: string;
}

export interface TraceReport {
  workWidth: number;
  workHeight: number;
  mmPerPx: number;
  palette: string[];
  mergedIslands: number;
  droppedRegions: number;
  objects: StrategyItem[];
}

export interface TraceResult {
  design: Design;
  report: TraceReport;
}

export interface ViewTransform {
  scale: number;
  ox: number;
  oy: number;
}

export interface RenderOptions {
  upto?: number;
  realistic?: boolean;
  showJumps?: boolean;
  dimColor?: number | null;
  highlight?: string | null;
  mode?: "thread" | "directions" | "density" | "types";
}

export type ExportFormat = "pes" | "pes6" | "dst";

export interface TranslatedText {
  text: string;
  /** true quand la traduction manque et que le texte source français est rendu */
  fallback: boolean;
}

export interface ChartEntry {
  code: string;
  name: string;
  rgb: string;
}

export interface ThreadChart {
  id: string;
  brand: string;
  product: string;
  /** « officiel » ou « approximatif » : jamais une référence inventée */
  status: string;
  source: string;
  sourceUrl?: string;
  importedAt?: string;
  entries: ChartEntry[];
}
