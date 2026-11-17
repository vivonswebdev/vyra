// Atelier vêtement : aperçu de la broderie du projet, à taille réelle, sur un vêtement simulé (T-shirt, sweat,
// hoodie), avec des textes imprimés d'aperçu. Le vêtement 3D et le patron 2D partagent la même texture : une
// impression déplacée dans une vue bouge dans l'autre. Rien n'est envoyé au serveur : la mise en scène est
// gardée dans ce navigateur, par projet.
import "@fontsource/anton/400.css";
import "@fontsource/unbounded/800.css";
import "@fontsource/bodoni-moda/600.css";
import "@fontsource/fraunces/500-italic.css";
import "@fontsource/caveat/600.css";
import "@fontsource/jetbrains-mono/700.css";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { analyze, planBounds, type Design } from "@vyra/engine";
import { renderPlan } from "@vyra/engine/browser";
import { get, Icon, Segmented, Spinner, useErrorText, useI18n, useToast } from "@vyra/ui";
import type { ProjectDTO } from "@vyra/shared";
import { Atlas, FONTS, fontOf, pickLayer, type AtelierLayer, type EmbroideryArt, type ImageLayer, type Placement, type PrintType, type RenderMode, type ShapeLayer, type TextLayer } from "../atelier/atlas.js";
import { clampToSheet, pieceToSheet, sheetExtent, sheetToPiece } from "../atelier/sheet.js";
import { AUTO_INK_DARK, autoInk, clampToPiece, GARMENTS, layoutFor, PIECES, type Garment, type GarmentId, type Layout, type PieceId } from "../atelier/garments.js";
import { PatternView, type LayerPatch, type Unit } from "../atelier/pattern2d.js";
import { GarmentScene, type CameraView, type Fabric, type LightPreset, type SceneStats } from "../atelier/scene.js";

const COLORWAYS: { id: string; hex: string }[] = [
  { id: "ecru", hex: "#f4f2ec" }, { id: "heather", hex: "#b9bdc3" }, { id: "black", hex: "#1b1c20" }, { id: "navy", hex: "#1f2d4f" },
  { id: "forest", hex: "#2f4f3e" }, { id: "burgundy", hex: "#7e2b2e" }, { id: "lavender", hex: "#b9aed8" }, { id: "mustard", hex: "#d6b45a" },
];
const INKS = ["#fbfaf6", "#16181d", "#1f2c5c", "#c23a2b", "#2f56c9", "#e3b23c", "#e58bb0", "#2e6b45"];

interface Saved { garment: GarmentId; render: RenderMode; colorway: string; printType: PrintType; layers: AtelierLayer[]; scene?: Partial<SceneSaved> }
const storeKey = (id: string) => `vyra.atelier.${id}`;
function loadSaved(id: string): Saved | null {
  try {
    const raw = localStorage.getItem(storeKey(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!(s.garment in GARMENTS) || !Array.isArray(s.layers)) return null;
    s.layers = s.layers.filter((l) =>
      ((l.kind === "text" || l.kind === "embroidery") && PIECES.includes(l.piece as PieceId)) ||
      ((l.kind === "image" || l.kind === "shape") && (l.piece === "sheet" || PIECES.includes(l.piece as PieceId))));
    return s;
  } catch {
    return null;
  }
}

/** Broderie rendue point par point par le moteur, à sa taille réelle (cm). */
function embroideryArt(project: ProjectDTO | null): EmbroideryArt | null {
  if (!project?.design) return null;
  const s = project.settings ?? {};
  const plan = analyze(project.design as Design, s.machineId, s.hoopId).plan;
  if (!plan.stitches.length) return null;
  const b = planBounds(plan);
  const wMm = b.maxX - b.minX, hMm = b.maxY - b.minY;
  if (!(wMm > 0 && hMm > 0)) return null;
  const k = Math.min(6, 2400 / Math.max(wMm, hMm)); // pixels par mm
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(wMm * k);
  canvas.height = Math.ceil(hMm * k);
  renderPlan(canvas.getContext("2d")!, plan, { scale: k, ox: -b.minX * k, oy: -b.minY * k }, { realistic: true, showJumps: false });
  return { canvas, wCm: wMm / 10, hCm: hMm / 10 };
}

/** Garde un calque dans son emplacement : sa pièce, ou la feuille entière pour un motif continu. */
function clampLayer(g: Garment, layout: Layout, L: AtelierLayer, box?: { w: number; h: number }): [number, number] {
  if (L.piece === "sheet") return clampToSheet(g, L.x, L.y);
  return clampToPiece(layout, L.piece, L.x, L.y, L.kind === "embroidery" ? box?.w : 0, L.kind === "embroidery" ? box?.h : 0);
}

/** Image choisie par l'utilisateur → réduite (1 600 px au plus) et encodée, gardée dans le navigateur. */
async function importImage(file: File): Promise<{ src: string; aspect: number } | null> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 15 * 1024 * 1024) return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    // PNG et WEBP peuvent être transparents : gardés en PNG ; les photos (JPG) restent en JPG, plus légères.
    const src = file.type === "image/jpeg" ? c.toDataURL("image/jpeg", 0.9) : c.toDataURL("image/png");
    return { src, aspect: c.height / c.width };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

type LayerFields = Partial<Omit<TextLayer, "kind">> & Partial<Omit<ImageLayer, "kind">> & Partial<Omit<ShapeLayer, "kind">>;
const SHAPES = ["rect", "triangle", "circle"] as const;

let nextId = 1;
const newId = (layers: AtelierLayer[]) => Math.max(nextId++, ...layers.map((l) => l.id + 1));

function Range({ id, label, min, max, step, value, format, onChange }: { id: string; label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="at-range" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <output htmlFor={id} className="num">{format(value)}</output>
    </label>
  );
}
function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="at-sec">
      <h2>{title}{aside != null && <span className="num">{aside}</span>}</h2>
      {children}
    </section>
  );
}

export default function Atelier() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const errText = useErrorText();
  const toast = useToast();
  const [project, setProject] = useState<ProjectDTO | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    get<{ project: ProjectDTO }>(`/api/projects/${id}`).then((r) => setProject(r.project), (e) => setError(errText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (error) return <p className="page">{error}</p>;
  if (!project) return <div className="auth-shell"><Spinner /></div>;
  return <AtelierView project={project} t={t} lang={lang} toast={toast} />;
}

const BACKDROPS: { id: string; hex: string }[] = [
  { id: "sand", hex: "#d9d3c8" }, { id: "sage", hex: "#a9b8a0" }, { id: "concrete", hex: "#b9b6b1" }, { id: "clay", hex: "#c98f72" },
  { id: "sky", hex: "#b7c7d6" }, { id: "white", hex: "#efeee9" }, { id: "charcoal", hex: "#3a3734" },
];
type ViewMode = "pattern" | "split" | "3d";
interface SceneSaved { backdrop: string; leaves: boolean; light: LightPreset; hanger: boolean; material: Fabric; relief: number; unit: Unit }
const SCENE_DEFAULT: SceneSaved = { backdrop: BACKDROPS[0].hex, leaves: true, light: "studio", hanger: true, material: "cotton", relief: 1, unit: "cm" };
const UNIT_K: Record<Unit, number> = { mm: 10, cm: 1, in: 1 / 2.54 };

const ICON = {
  select: "M5 3l13 8-6 1.5L9 19z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  shape: "M4 4h9v9H4zM16 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8",
  emb: "M12 3v18M3 12h18M6 6l12 12M18 6L6 18",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  reset: "M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5",
};

/** Vignette d'un calque dans la liste : l'image, la forme dans sa couleur, le texte dans sa police. */
function LayerThumb({ L, bg, emb }: { L: AtelierLayer; bg: string; emb: string | null }) {
  if (L.kind === "image") return <span className="at-thumb" style={{ background: bg }}><img src={L.src} alt="" /></span>;
  if (L.kind === "embroidery") return <span className="at-thumb" style={{ background: bg }}>{emb ? <img src={emb} alt="" /> : "✶"}</span>;
  if (L.kind === "shape") {
    const clip = L.shape === "circle" ? "circle(50%)" : L.shape === "triangle" ? "polygon(50% 0, 100% 100%, 0 100%)" : "inset(30% 0)";
    return <span className="at-thumb" style={{ background: bg }}><i style={{ background: L.fill, clipPath: clip, opacity: L.opacity }} /></span>;
  }
  const f = fontOf(L.font);
  return <span className="at-thumb" style={{ background: bg, color: L.ink, fontFamily: f.css, fontWeight: Number(f.weight), fontStyle: f.style }}>Aa</span>;
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="at-toggle" htmlFor={id}>
      <span>{label}</span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function AtelierView({ project, t, lang, toast }: { project: ProjectDTO; t: ReturnType<typeof useI18n>["t"]; lang: string; toast: (m: string) => void }) {
  const saved = useMemo(() => loadSaved(project.id), [project.id]);
  const art = useMemo(() => embroideryArt(project), [project]);
  const embThumb = useMemo(() => (art ? art.canvas.toDataURL("image/png") : null), [art]);
  const [garmentId, setGarmentId] = useState<GarmentId>(saved?.garment ?? "tee");
  const [render, setRender] = useState<RenderMode>(saved?.render ?? "fabric");
  const [colorway, setColorway] = useState(saved?.colorway ?? COLORWAYS[0].hex);
  const [printType, setPrintType] = useState<PrintType>(saved?.printType ?? "screen");
  const [sc, setSc] = useState<SceneSaved>(() => ({ ...SCENE_DEFAULT, ...saved?.scene }));
  const setScene = (p: Partial<SceneSaved>) => setSc((s) => ({ ...s, ...p }));
  const garment = GARMENTS[garmentId];
  const layout = useMemo(() => layoutFor(garment), [garment]);
  const [layers, setLayers] = useState<AtelierLayer[]>(() => {
    if (saved) return saved.layers;
    const g = GARMENTS.tee;
    const out: AtelierLayer[] = [];
    if (art) out.push({ id: 1, kind: "embroidery", piece: "front", x: 0, y: g.neckDrop + 6 + art.hCm / 2, rotate: 0, visible: true });
    out.push({ id: 2, kind: "text", piece: "back", x: 0, y: 9, rotate: 0, visible: true, text: project.name.toUpperCase(), font: "mono", layout: "box", align: "center", cap: 0.7, width: 30, bend: 0.3, leading: 1.2, tracking: 0.12, ink: AUTO_INK_DARK, autoInk: true, opacity: 1 });
    return out;
  });
  const [selected, setSelected] = useState<number | null>(() => layers[0]?.id ?? null);
  // Fond réellement visible sous les textes : le plan est presque blanc, le rendu tissu prend la couleur choisie.
  const background = render === "blueprint" ? "#fbfcfd" : colorway;
  // Une encre automatique (jamais une encre choisie à la main) suit le fond, pour que le texte reste lisible :
  // un texte bleu marine sur un sweat marine devenait invisible.
  useEffect(() => {
    const ink = autoInk(background);
    // Calques enregistrés avant l'indicateur : l'ancienne encre par défaut (marine) est traitée comme automatique.
    const isAuto = (l: AtelierLayer) => l.kind === "text" && (l.autoInk ?? l.ink === AUTO_INK_DARK);
    setLayers((ls) => (ls.some((l) => isAuto(l) && (l as { ink: string }).ink !== ink)
      ? ls.map((l) => (isAuto(l) ? { ...l, ink, autoInk: true } : l))
      : ls));
  }, [background]);

  // Historique des calques (annuler / rétablir) : un état est retenu après une pause de 400 ms, pour qu'un
  // glisser-déposer compte pour une seule étape.
  const hist = useRef({ past: [] as AtelierLayer[][], future: [] as AtelierLayer[][], prev: layers, at: 0, skip: false });
  const [histTick, setHistTick] = useState(0);
  useEffect(() => {
    const h = hist.current;
    if (h.skip) { h.skip = false; h.prev = layers; return; }
    if (layers === h.prev) return;
    const now = performance.now();
    if (now - h.at > 400) { h.past.push(h.prev); if (h.past.length > 60) h.past.shift(); h.future = []; setHistTick((n) => n + 1); }
    h.at = now;
    h.prev = layers;
  }, [layers]);
  const undo = useCallback((dir: 1 | -1) => {
    const h = hist.current, from = dir === 1 ? h.past : h.future, to = dir === 1 ? h.future : h.past;
    const st = from.pop();
    if (!st) return;
    to.push(h.prev);
    h.skip = true; h.at = 0;
    setLayers(st);
    setHistTick((n) => n + 1);
  }, []);

  const [view3, setView3] = useState<ViewMode>("split");
  const [tab, setTab] = useState<"design" | "scene">("design");
  const [mode, setMode] = useState<"pull" | "move">("pull");
  const [turntable, setTurntable] = useState(false);
  const [breeze, setBreeze] = useState(false);
  const [view, setView] = useState<CameraView | null>("front");
  const [stats, setStats] = useState<SceneStats | null>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [fontsTick, setFontsTick] = useState(0);

  const c3d = useRef<HTMLCanvasElement>(null);
  const c2d = useRef<HTMLCanvasElement>(null);
  const atlas = useMemo(() => new Atlas(), []);
  const scene = useRef<GarmentScene | null>(null);
  const pattern = useRef<PatternView | null>(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const garmentRef = useRef(garment);
  garmentRef.current = garment;
  const fileInput = useRef<HTMLInputElement>(null);
  // Images décodées des calques image (par identifiant de calque).
  const [images, setImages] = useState(() => new Map<number, HTMLImageElement>());
  const moveOffset = useRef<{ id: number; dx: number; dy: number } | null>(null);

  const fmt = useCallback((v: number, d = 1) => v.toLocaleString(lang, { minimumFractionDigits: d, maximumFractionDigits: d }), [lang]);
  const fabric = t(garment.fabric);

  const edit = useCallback((lid: number, patch: LayerPatch) => {
    setLayers((ls) => ls.map((l) => {
      if (l.id !== lid) return l;
      const n = { ...l, ...patch } as AtelierLayer;
      [n.x, n.y] = clampLayer(garmentRef.current, layoutRef.current, n, atlas.boxes.get(lid));
      return n;
    }));
  }, [atlas]);

  // Vues : création unique, destruction au départ de la page.
  useEffect(() => {
    const pv = new PatternView(c2d.current!);
    pv.onPick = (lid) => setSelected(lid);
    pv.onEdit = (lid, patch) => edit(lid, patch);
    pattern.current = pv;
    let gs: GarmentScene | null = null;
    try {
      gs = new GarmentScene(c3d.current!, atlas);
      gs.onStats = setStats;
      gs.onViewChange = setView;
      gs.onPrint = (phase, at) => {
        // Le point touché est connu dans sa pièce et sur la feuille : un motif continu se déplace sur la feuille.
        const sheetAt = (a: NonNullable<typeof at>) => pieceToSheet(garmentRef.current, a.piece, a.x, a.y);
        if (phase === "down") {
          if (!at) return false;
          const [sx, sy] = sheetAt(at);
          const hit = pickLayer(layersRef.current, atlas.boxes, { sheet: [sx, sy], piece: at });
          if (!hit) return false;
          setSelected(hit.id);
          const [qx, qy] = hit.piece === "sheet" ? [sx, sy] : [at.x, at.y];
          moveOffset.current = { id: hit.id, dx: hit.x - qx, dy: hit.y - qy };
          return true;
        }
        if (phase === "move" && at && moveOffset.current) {
          const m = moveOffset.current, L = layersRef.current.find((l) => l.id === m.id);
          if (L?.piece === "sheet") { const [sx, sy] = sheetAt(at); edit(m.id, { x: sx + m.dx, y: sy + m.dy }); }
          else if (L && L.piece === at.piece) edit(m.id, { x: at.x + m.dx, y: at.y + m.dy });
        }
        if (phase === "up") moveOffset.current = null;
      };
      gs.start();
      scene.current = gs;
    } catch {
      setNoWebgl(true);
    }
    // Polices des textes : le dessin sur canvas les attend.
    let alive = true;
    Promise.all(FONTS.map((f) => document.fonts.load(`${f.style} ${f.weight} 100px ${f.css.split(",")[0]}`).catch(() => null))).then(() => alive && setFontsTick((n) => n + 1));
    return () => {
      alive = false;
      pv.dispose();
      gs?.dispose();
      scene.current = null;
      pattern.current = null;
    };
  }, [atlas, edit]);

  useEffect(() => {
    scene.current?.setGarment(garment, layout);
    setLayers((ls) => ls.map((l) => {
      const [x, y] = clampLayer(garment, layout, l, atlas.boxes.get(l.id));
      return x === l.x && y === l.y ? l : { ...l, x, y };
    }));
  }, [garment, layout, atlas]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.mode = mode; s.turntable = turntable; s.breeze = breeze;
    s.setCordColor(render === "blueprint" ? "#e6ebf2" : colorway);
    s.setRelief(printType === "puff");
  }, [mode, turntable, breeze, render, colorway, printType]);

  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    s.setBackdrop({ color: sc.backdrop, leaves: sc.leaves });
    s.setLight(sc.light);
    s.setHanger(sc.hanger);
    s.setFabric(sc.material, sc.relief);
  }, [sc]);

  // Images des calques : décodées une fois (y compris celles gardées dans ce navigateur), puis texture redessinée.
  useEffect(() => {
    let alive = true;
    for (const l of layers) {
      if (l.kind !== "image" || images.has(l.id)) continue;
      const img = new Image();
      img.src = l.src;
      img.decode().then(() => alive && setImages((m) => (m.has(l.id) ? m : new Map(m).set(l.id, img))), () => {});
    }
    return () => { alive = false; };
  }, [layers, images]);

  // Cotes dans l'unité choisie : entiers en cm et mm, une décimale en pouces.
  const len = useCallback((cmv: number) => {
    const v = cmv * UNIT_K[sc.unit];
    return sc.unit === "in" ? fmt(v, 1) : Math.round(v).toLocaleString(lang);
  }, [sc.unit, fmt, lang]);

  // Texture et patron : redessinés à chaque changement.
  useEffect(() => {
    atlas.render({
      garment, layout, render, colorway, printType, layers, embroidery: art, images,
      labels: { front: t("at.sheetFront", { fabric: fabric.toUpperCase() }), back: t("at.sheetBack", { fabric: fabric.toUpperCase() }) },
    });
    const pv = pattern.current;
    if (pv) {
      pv.set({
        garment, layout, atlas, layers, selected, hoodFill: render === "blueprint" ? "#fbfcfd" : colorway, unit: sc.unit,
        labels: {
          front: t("at.pc.front"), back: t("at.pc.back"), hood: t("at.pc.hood"), sleeveL: t("at.sleeveLFull"), sleeveR: t("at.sleeveRFull"),
          dims: (w, h) => t("at.dims", { w: len(w), h: len(h), u: sc.unit }),
        },
      });
    }
  }, [atlas, garment, layout, render, colorway, printType, layers, art, images, selected, fontsTick, t, fabric, sc.unit, len]);

  useEffect(() => {
    try {
      localStorage.setItem(storeKey(project.id), JSON.stringify({ garment: garmentId, render, colorway, printType, layers, scene: sc } satisfies Saved));
    } catch {
      /* stockage indisponible : la mise en scène n'est simplement pas gardée */
    }
  }, [project.id, garmentId, render, colorway, printType, layers, sc]);

  const sel = layers.find((l) => l.id === selected) ?? null;
  const box = sel ? atlas.boxes.get(sel.id) : undefined;
  const patch = (p: LayerFields) => sel && setLayers((ls) => ls.map((l) => (l.id === sel.id ? ({ ...l, ...p } as AtelierLayer) : l)));
  const add = (L: AtelierLayer) => { setLayers((ls) => [...ls, L]); setSelected(L.id); setTab("design"); };
  const addEmbroidery = () => art && add({ id: newId(layers), kind: "embroidery", piece: "front", x: 0, y: garment.neckDrop + 6 + art.hCm / 2, rotate: 0, visible: true });
  const addText = () => add({ id: newId(layers), kind: "text", piece: "front", x: 0, y: Math.min(garment.H - 12, 38), rotate: 0, visible: true, text: t("at.newText"), font: "anton", layout: "box", align: "center", cap: 2.4, width: 26, bend: 0.3, leading: 1.15, tracking: 0.02, ink: autoInk(background), autoInk: true, opacity: 1 });
  const extent = sheetExtent(garment);
  const addImage = async (file: File) => {
    const im = await importImage(file);
    if (!im) { toast(t("at.imageError")); return; }
    const w = Math.min(24, garment.W * 0.6);
    add({ id: newId(layers), kind: "image", piece: "front", x: 0, y: Math.min(garment.H - 6, garment.neckDrop + 8 + (w * im.aspect) / 2), rotate: 0, visible: true, src: im.src, name: file.name.slice(0, 60), w, aspect: im.aspect, opacity: 1 });
  };
  // Forme par défaut : une bande sur toute la feuille, donc tout le tour du vêtement (devant, manches, dos).
  const addShape = () => add({ id: newId(layers), kind: "shape", piece: "sheet", shape: "rect", x: extent.w / 2, y: extent.top + Math.min(40, garment.H * 0.55), rotate: 0, visible: true, w: extent.w, h: 6, fill: "#c23a2b", opacity: 1 });
  /** Change l'emplacement d'un calque en gardant sa position sur le vêtement quand c'est possible. */
  const place = (L: AtelierLayer, to: Placement) => {
    if (to === L.piece) return;
    if (to === "sheet") {
      const [x, y] = pieceToSheet(garment, L.piece as PieceId, L.x, L.y);
      patch({ piece: "sheet", x, y });
      return;
    }
    const at = L.piece === "sheet" ? sheetToPiece(garment, L.x, L.y) : null;
    if (at && at.piece === to) { patch({ piece: to, x: at.x, y: at.y }); return; }
    const r = layout.regions[to], sleeve = to.startsWith("sleeve");
    patch({ piece: to, x: sleeve ? r.w / 8 : 0, y: Math.min(L.piece === "sheet" ? r.h * 0.4 : L.y, r.h * 0.5), rotate: sleeve ? 90 : 0 });
  };
  const reorder = (dir: 1 | -1) => setLayers((ls) => {
    const i = ls.findIndex((l) => l.id === selected), j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return ls;
    const n = [...ls];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const remove = (lid: number) => { setLayers((ls) => ls.filter((l) => l.id !== lid)); setSelected(null); toast(t("at.deleted")); };
  const layerName = (l: AtelierLayer) =>
    l.kind === "embroidery" ? t("at.embroidery") : l.kind === "image" ? l.name || t("at.image") : l.kind === "shape" ? t("at.sh." + l.shape) : l.text.replace(/\s+/g, " ") || t("at.text");
  const kindName = (l: AtelierLayer) => t(l.kind === "embroidery" ? "at.k.embroidery" : l.kind === "image" ? "at.image" : l.kind === "shape" ? "at.shape" : "at.text");
  const cm = (v: number) => `${fmt(v)} cm`;
  const pieceCount = 4 + (garment.hood ? 1 : 0);

  // Raccourcis : annuler / rétablir, supprimer le calque choisi (hors champs de saisie).
  const removeRef = useRef(remove);
  removeRef.current = remove;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(e.shiftKey ? -1 : 1); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); undo(-1); }
      else if ((e.key === "Delete" || e.key === "Backspace") && selected != null) { e.preventDefault(); removeRef.current(selected); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, selected]);

  const snapshot = () => {
    const s = scene.current;
    if (!s) return;
    const a = document.createElement("a");
    a.href = s.snapshot();
    a.download = `${project.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "vyra"}-${garmentId}-3d.png`;
    a.click();
    toast(t("at.snapshotDone"));
  };
  void histTick;

  return (
    <div className="atelier" data-testid="atelier" data-view={view3}>
      <header className="at-top">
        <Link to={`/p/${project.id}`} className="at-ibtn" title={t("at.back")} aria-label={t("at.back")}>
          <Icon d="M15 18l-6-6 6-6" />
        </Link>
        <span className="at-brand" aria-hidden="true">VYRA</span>
        <div className="at-title">
          <h1>{project.name}</h1>
          <small>{t("at.g." + garmentId)} · {fabric}</small>
        </div>
        <span className="spacer" />
        <Segmented label={t("at.viewMode")} value={view3} onChange={setView3}
          options={[{ id: "pattern", label: t("at.v.pattern") }, { id: "split", label: t("at.v.split") }, { id: "3d", label: "3D" }]} />
        <span className="spacer" />
        <div className="at-acts">
          <button type="button" className="at-ibtn" onClick={() => undo(1)} disabled={!hist.current.past.length} title={t("at.undo")} aria-label={t("at.undo")}><Icon d={ICON.undo} /></button>
          <button type="button" className="at-ibtn" onClick={() => undo(-1)} disabled={!hist.current.future.length} title={t("at.redo")} aria-label={t("at.redo")}><Icon d={ICON.redo} /></button>
          <button type="button" className="at-btn" onClick={snapshot} disabled={noWebgl} data-testid="at-snapshot"><Icon d={ICON.camera} size={17} /> <span className="lbl">{t("at.snapshot")}</span></button>
        </div>
      </header>

      <div className="at-body">
        <section className="at-col at-v2" aria-label={t("at.pattern")}>
          <div className="at-chead">
            <h2>{t("at.pattern")} <small>{t("at.pieces", { n: pieceCount })}</small></h2>
            <button type="button" className="at-ibtn sm" onClick={() => { pattern.current?.fit(); pattern.current?.draw(); }} title={t("at.fit")} aria-label={t("at.fit")}><Icon d={ICON.fit} size={17} /></button>
          </div>
          <div className="at-stage">
            <canvas ref={c2d} className="at-canvas" data-testid="at-2d" aria-label={t("at.pattern")} />
            <div className="at-tools">
              <div className="at-toolgrp" role="toolbar" aria-label={t("at.artwork")}>
                <button type="button" aria-pressed="true" title={t("at.tool.select")} aria-label={t("at.tool.select")}><Icon d={ICON.select} size={18} /></button>
                <button type="button" onClick={() => fileInput.current?.click()} title={t("at.image")} aria-label={t("at.image")}><Icon d={ICON.image} size={18} /></button>
                <button type="button" onClick={addText} title={t("at.text")} aria-label={t("at.text")}><Icon d={ICON.text} size={18} /></button>
                <button type="button" onClick={addShape} title={t("at.shape")} aria-label={t("at.shape")}><Icon d={ICON.shape} size={18} /></button>
                <button type="button" onClick={addEmbroidery} disabled={!art} title={t("at.embroidery")} aria-label={t("at.embroidery")}><Icon d={ICON.emb} size={18} /></button>
              </div>
              <div className="at-toolgrp" role="group" aria-label={t("at.unit")}>
                {(["mm", "cm", "in"] as const).map((u) => <button key={u} type="button" aria-pressed={sc.unit === u} onClick={() => setScene({ unit: u })}>{u}</button>)}
              </div>
            </div>
          </div>
        </section>

        <section className="at-col at-v3" aria-label={t("at.view3d")}>
          <div className="at-chead">
            <h2>{t("at.preview3d")}</h2>
            {!noWebgl && (
              <Segmented label={t("at.camera")} value={view ?? ("" as CameraView)} onChange={(v) => { scene.current?.view(v); setView(v); setTurntable(false); }}
                options={(["front", "back", "side"] as const).map((v) => ({ id: v, label: t("at.cam." + v) }))} />
            )}
          </div>
          <div className="at-stage">
            <canvas ref={c3d} className="at-canvas" data-testid="at-3d" aria-label={`${t("at.view3d")} — ${t("at.hint3d")}`} />
            {noWebgl ? <p className="alert info at-overlay">{t("at.noWebgl")}</p> : (
              <>
                <div className="at-chip">
                  <strong>{t("at.g." + garmentId)}</strong>
                  <small>{fabric}</small>
                </div>
                <span className="at-live"><i />{t("at.live")}</span>
                <div className="at-dock">
                  <button type="button" onClick={() => { scene.current?.resetView(); setView("front"); setTurntable(false); }}><Icon d={ICON.reset} size={16} /> {t("at.resetView")}</button>
                  <span className="sep" />
                  <Segmented label={t("at.mode")} value={mode} onChange={setMode} options={[{ id: "pull", label: t("at.pull") }, { id: "move", label: t("at.move") }]} />
                  <span className="sep" />
                  <button type="button" aria-pressed={turntable} onClick={() => { setTurntable(!turntable); setView(null); }}>{t("at.turntable")}</button>
                  <button type="button" aria-pressed={breeze} onClick={() => setBreeze(!breeze)}>{t("at.breeze")}</button>
                  <button type="button" onClick={() => { scene.current?.redrape(); toast(t("at.dropped")); }} data-testid="at-redrape">{t("at.redrape")}</button>
                </div>
                {stats && <p className="at-stats num">{t("at.stats", { n: stats.nodes.toLocaleString(lang), c: stats.constraints.toLocaleString(lang), ms: fmt(stats.solverMs), fps: stats.fps })}</p>}
              </>
            )}
          </div>
        </section>

        <aside className="at-panel">
          <div className="at-tabs" role="tablist" aria-label={t("at.title")}>
            <button type="button" role="tab" aria-selected={tab === "design"} onClick={() => setTab("design")}>{t("at.tab.design")}</button>
            <button type="button" role="tab" aria-selected={tab === "scene"} onClick={() => setTab("scene")}>{t("at.tab.scene")}</button>
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden data-testid="at-image-file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addImage(f); }} />
          {tab === "design" ? (
            <div className="at-pscroll">
              <Section title={t("at.artwork")}>
                <div className="at-adds">
                  <button type="button" className="at-add" onClick={() => fileInput.current?.click()} data-testid="at-add-image"><Icon d={ICON.image} size={17} />{t("at.image")}</button>
                  <button type="button" className="at-add" onClick={addText} data-testid="at-add-text"><Icon d={ICON.text} size={17} />{t("at.text")}</button>
                  <button type="button" className="at-add" onClick={addShape} data-testid="at-add-shape"><Icon d={ICON.shape} size={17} />{t("at.shape")}</button>
                  <button type="button" className="at-add" onClick={addEmbroidery} disabled={!art} data-testid="at-add-emb"><Icon d={ICON.emb} size={17} />{t("at.k.embroidery")}</button>
                </div>
                {!art && <p className="small muted">{t("at.embEmpty")}</p>}
              </Section>
              <Section title={t("at.layers")} aside={layers.length}>
                <ul className="at-layers" data-testid="at-layers">
                  {[...layers].reverse().map((l) => (
                    <li key={l.id} className={l.id === selected ? "sel" : ""}>
                      <button type="button" className={"at-eye" + (l.visible ? "" : " off")} aria-label={l.visible ? t("at.hide") : t("at.show")}
                        onClick={() => setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, visible: !x.visible } : x)))} />
                      <button type="button" className="at-layer" onClick={() => setSelected(l.id)} aria-pressed={l.id === selected}>
                        <LayerThumb L={l} bg={background} emb={embThumb} />
                        <span className="tx">
                          <span className="nm">{layerName(l)}</span>
                          <span className="pc">{kindName(l)} · {t("at.pc." + l.piece)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
              {sel && (
                <Section title={t("at.selected")}>
                  <div className="at-props" data-testid="at-props">
                    <Segmented label={t("at.piece")} value={sel.piece} onChange={(p: Placement) => place(sel, p)}
                      options={[...PIECES.map((p) => ({ id: p as Placement, label: t("at.pc." + p) })), ...(sel.kind === "embroidery" ? [] : [{ id: "sheet" as Placement, label: t("at.pc.sheet") }])]} />
                    {sel.piece === "sheet" ? <p className="small muted">{t("at.sheetHint")}</p> : <p className="small muted num">{t("at.coords", { x: fmt(sel.x), y: fmt(sel.y) })}</p>}
                    {sel.kind === "embroidery" && (
                      <p className="small">{t("at.embSize", { w: fmt(box?.w ?? art?.wCm ?? 0), h: fmt(box?.h ?? art?.hCm ?? 0) })}</p>
                    )}
                    {sel.kind === "image" && (
                      <>
                        <Range id="at-img-w" label={t("at.size")} min={1} max={160} step={0.5} value={sel.w} format={(v) => `${fmt(v)} × ${fmt(v * sel.aspect)} cm`} onChange={(v) => patch({ w: v })} />
                        <Range id="at-opacity" label={t("at.opacity")} min={0.1} max={1} step={0.01} value={sel.opacity} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch({ opacity: v })} />
                        <p className="small muted">{t("at.imageNote")}</p>
                      </>
                    )}
                    {sel.kind === "shape" && (
                      <>
                        <Segmented label={t("at.shape")} value={sel.shape} onChange={(v) => patch({ shape: v })} options={SHAPES.map((k) => ({ id: k, label: t("at.sh." + k) }))} />
                        <Range id="at-sh-w" label={t("at.shW")} min={0.5} max={220} step={0.5} value={sel.w} format={cm} onChange={(v) => patch({ w: v })} />
                        <Range id="at-sh-h" label={t("at.shH")} min={0.5} max={220} step={0.5} value={sel.h} format={cm} onChange={(v) => patch({ h: v })} />
                        <div className="at-inks" role="group" aria-label={t("at.fill")}>
                          {INKS.map((c) => <button key={c} type="button" className="at-sw" style={{ background: c }} aria-label={`${t("at.fill")} ${c}`} aria-pressed={c === sel.fill} onClick={() => patch({ fill: c })} />)}
                          <input type="color" id="at-fill" value={sel.fill} aria-label={t("at.fill")} onChange={(e) => patch({ fill: e.target.value })} />
                        </div>
                        <Range id="at-opacity" label={t("at.opacity")} min={0.1} max={1} step={0.01} value={sel.opacity} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch({ opacity: v })} />
                      </>
                    )}
                    {sel.kind === "text" && (
                      <>
                        <label className="at-field">
                          <span>{t("at.text")}</span>
                          <textarea id="at-text" className="input" value={sel.text} rows={3} maxLength={400} onChange={(e) => patch({ text: e.target.value })} data-testid="at-text" />
                        </label>
                        <div className="at-fonts" role="group" aria-label={t("at.font")}>
                          {FONTS.map((f) => (
                            <button key={f.id} type="button" aria-pressed={f.id === sel.font} onClick={() => patch({ font: f.id })} style={{ fontFamily: f.css, fontWeight: Number(f.weight), fontStyle: f.style }}>
                              {fontOf(f.id).name}
                            </button>
                          ))}
                        </div>
                        <Segmented label={t("at.layout")} value={sel.layout} onChange={(v) => patch({ layout: v })} options={[{ id: "box", label: t("at.l.box") }, { id: "arc", label: t("at.l.arc") }, { id: "circle", label: t("at.l.circle") }]} />
                        {sel.layout === "box" && (
                          <Segmented label={t("at.align")} value={sel.align} onChange={(v) => patch({ align: v })} options={(["left", "center", "right", "justify"] as const).map((a) => ({ id: a, label: t("at.a." + a) }))} />
                        )}
                        <Range id="at-cap" label={t("at.cap")} min={0.3} max={12} step={0.1} value={sel.cap} format={cm} onChange={(v) => patch({ cap: v })} />
                        {sel.layout !== "arc" && <Range id="at-width" label={t(sel.layout === "circle" ? "at.diameter" : "at.width")} min={4} max={50} step={0.5} value={sel.width} format={cm} onChange={(v) => patch({ width: v })} />}
                        {sel.layout === "arc" && <Range id="at-bend" label={t("at.bend")} min={-1} max={1} step={0.01} value={sel.bend} format={(v) => fmt(v, 2)} onChange={(v) => patch({ bend: v })} />}
                        {sel.layout !== "arc" && <Range id="at-leading" label={t("at.leading")} min={0.7} max={2.2} step={0.01} value={sel.leading} format={(v) => fmt(v, 2)} onChange={(v) => patch({ leading: v })} />}
                        <Range id="at-tracking" label={t("at.tracking")} min={-0.08} max={0.5} step={0.01} value={sel.tracking} format={(v) => fmt(v, 2)} onChange={(v) => patch({ tracking: v })} />
                        <div className="at-inks" role="group" aria-label={t("at.ink")}>
                          {INKS.map((c) => <button key={c} type="button" className="at-sw" style={{ background: c }} aria-label={`${t("at.ink")} ${c}`} aria-pressed={c === sel.ink} onClick={() => patch({ ink: c, autoInk: false })} />)}
                          <input type="color" id="at-ink" value={sel.ink} aria-label={t("at.inkCustom")} onChange={(e) => patch({ ink: e.target.value, autoInk: false })} />
                        </div>
                        <Range id="at-opacity" label={t("at.opacity")} min={0.1} max={1} step={0.01} value={sel.opacity} format={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch({ opacity: v })} />
                      </>
                    )}
                    <Range id="at-rotate" label={t("at.rotate")} min={-180} max={180} step={1} value={sel.rotate} format={(v) => `${Math.round(v)}°`} onChange={(v) => patch({ rotate: v })} />
                    <div className="at-row2">
                      <button type="button" className="at-btn sm" onClick={() => edit(sel.id, { x: sel.piece === "sheet" ? (sel.x < (extent.frontX + extent.backX) / 2 ? extent.frontX : extent.backX) : sel.piece.startsWith("sleeve") ? layout.regions[sel.piece].w / 8 : 0 })}>{t("at.center")}</button>
                      <button type="button" className="at-btn sm" onClick={() => add({ ...sel, id: newId(layers), y: Math.min(sel.y + 4, sel.piece === "sheet" ? extent.h - 2 : layout.regions[sel.piece].h - 2) })}>{t("at.duplicate")}</button>
                      <button type="button" className="at-btn sm" onClick={() => reorder(1)}>{t("at.forward")}</button>
                      <button type="button" className="at-btn sm" onClick={() => reorder(-1)}>{t("at.backward")}</button>
                      <button type="button" className="at-btn sm danger" onClick={() => remove(sel.id)}>{t("at.delete")}</button>
                    </div>
                  </div>
                </Section>
              )}
              <Section title={t("at.fabricSec")}>
                <Segmented label={t("at.garment")} value={garmentId} onChange={(v) => { setGarmentId(v); toast(t("at.dropped")); }} options={(Object.keys(GARMENTS) as GarmentId[]).map((g) => ({ id: g, label: t("at.g." + g) }))} />
                <p className="small muted">{fabric}</p>
                <div className="at-swatches" role="group" aria-label={t("at.colorway")}>
                  {COLORWAYS.map((c) => (
                    <button key={c.id} type="button" className="at-sw lg" style={{ background: c.hex }} title={t("at.cw." + c.id)} aria-label={t("at.cw." + c.id)} aria-pressed={render === "fabric" && c.hex === colorway}
                      onClick={() => { setColorway(c.hex); setRender("fabric"); }} />
                  ))}
                  <input type="color" className="lg" value={colorway} aria-label={t("at.customColor")} onChange={(e) => { setColorway(e.target.value); setRender("fabric"); }} />
                </div>
                <Segmented label={t("at.render")} value={render} onChange={setRender} options={[{ id: "fabric", label: t("at.r.fabric") }, { id: "blueprint", label: t("at.r.blueprint") }]} />
              </Section>
              <Section title={t("at.appearance")}>
                <label className="at-select">
                  <span>{t("at.material")}</span>
                  <select value={sc.material} onChange={(e) => setScene({ material: e.target.value as Fabric })}>
                    {(["cotton", "fleece", "jersey"] as const).map((m) => <option key={m} value={m}>{t("at.m." + m)}</option>)}
                  </select>
                </label>
                <Range id="at-relief" label={t("at.relief")} min={0} max={2} step={0.05} value={sc.relief} format={(v) => fmt(v, 2)} onChange={(v) => setScene({ relief: v })} />
                <Segmented label={t("at.print")} value={printType} onChange={setPrintType} options={[{ id: "screen", label: t("at.p.screen") }, { id: "puff", label: t("at.p.puff") }]} />
              </Section>
              <p className="small muted at-note">{t("at.note")}</p>
            </div>
          ) : (
            <div className="at-pscroll">
              <Section title={t("at.backdrop")}>
                <div className="at-swatches" role="group" aria-label={t("at.bgColor")}>
                  {BACKDROPS.map((b) => (
                    <button key={b.id} type="button" className="at-sw lg" style={{ background: b.hex }} title={t("at.bg." + b.id)} aria-label={t("at.bg." + b.id)} aria-pressed={sc.backdrop === b.hex} onClick={() => setScene({ backdrop: b.hex })} />
                  ))}
                  <input type="color" className="lg" value={sc.backdrop} aria-label={t("at.bgColor")} onChange={(e) => setScene({ backdrop: e.target.value })} />
                </div>
                <Toggle id="at-leaves" label={t("at.leaves")} checked={sc.leaves} onChange={(v) => setScene({ leaves: v })} />
              </Section>
              <Section title={t("at.light")}>
                <Segmented label={t("at.light")} value={sc.light} onChange={(v) => setScene({ light: v })} options={(["studio", "soft", "contrast"] as const).map((l) => ({ id: l, label: t("at.li." + l) }))} />
              </Section>
              <Section title={t("at.staging")}>
                <Toggle id="at-hanger" label={t("at.hanger")} checked={sc.hanger} onChange={(v) => setScene({ hanger: v })} />
                {garment.hood && <p className="small muted">{t("at.hangerHood")}</p>}
              </Section>
              <p className="small muted at-note">{t("at.snapshotNote")}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
