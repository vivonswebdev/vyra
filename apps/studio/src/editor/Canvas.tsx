// Zone de travail : rendu du plan de couture par le moteur (fidèle au fichier exporté),
// cadre de la machine, outils de sélection, déplacement, nœuds, formes et tracé libre.
// Souris, stylet et toucher (pincer pour zoomer, glisser à deux doigts pour déplacer).
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  createObject,
  hitTestObject,
  mapObjectPoints,
  objectBounds,
  pointSegmentDistance,
  simplifyPath,
  type Design,
  type DesignObject,
  type Hoop,
  type Plan,
  type Point,
} from "@vyra/engine";
import { fabricPattern, renderPlan } from "@vyra/engine/browser";

export type Tool = "select" | "nodes" | "pan" | "pen" | "rect" | "ellipse";
export interface View {
  scale: number;
  ox: number;
  oy: number;
}
export interface CanvasHandle {
  fit: () => void;
  zoom: (factor: number) => void;
  getView: () => View;
}
export interface Display {
  realistic: boolean;
  showJumps: boolean;
  mode: "thread" | "directions" | "density" | "types";
  dimColor: number | null;
}

interface Props {
  design: Design | null;
  plan: Plan | null;
  hoop: Hoop | null;
  tool: Tool;
  spaceDown: boolean;
  selection: string | null;
  onSelect: (id: string | null) => void;
  display: Display;
  upto: number | null;
  drawColor: number;
  onCommit: (fn: (d: Design) => Design) => void;
  marker: Point[] | null;
  newObjectName: (kind: "rect" | "ellipse" | "pen") => string;
  handle: Ref<CanvasHandle>;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "move"; id: string; start: Point; dx: number; dy: number }
  | { kind: "node"; id: string; ring: number; index: number; p: Point }
  | { kind: "shape"; shape: "rect" | "ellipse"; a: Point; b: Point }
  | { kind: "pen"; pts: Point[] };

const MIN_SCALE = 0.3;
const MAX_SCALE = 80;

function rings(o: DesignObject): Point[][] {
  return o.path ? [o.path] : [o.shape.outer, ...o.shape.holes];
}

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function nextObjectId(design: Design): string {
  let n = 0;
  for (const o of design.objects) {
    const m = /^obj(\d+)$/.exec(o.id);
    if (m) n = Math.max(n, +m[1]);
  }
  return "obj" + (n + 1);
}

export function StitchCanvas(props: Props) {
  const { design, plan, hoop, tool, selection, display, upto, marker } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>({ scale: 4, ox: 40, oy: 40 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; mx: number; my: number; view: View } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const fitted = useRef(false);

  const hoopRect = useCallback(() => {
    const cx = design ? design.widthMm / 2 : 65;
    const cy = design ? design.heightMm / 2 : 90;
    const w = hoop?.widthMm ?? 130;
    const h = hoop?.heightMm ?? 180;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }, [design, hoop]);

  const fit = useCallback(() => {
    const r = hoopRect();
    const pad = 24;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((size.w - pad * 2) / r.w, (size.h - pad * 2) / r.h)));
    setView({ scale, ox: size.w / 2 - (r.x + r.w / 2) * scale, oy: size.h / 2 - (r.y + r.h / 2) * scale });
  }, [hoopRect, size]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, ox: px - (px - v.ox) * k, oy: py - (py - v.oy) * k };
    });
  }, []);

  useImperativeHandle(props.handle, () => ({ fit, zoom: (f) => zoomAt(f, size.w / 2, size.h / 2), getView: () => view }), [fit, zoomAt, size, view]);

  // Taille du conteneur
  useEffect(() => {
    const el = wrap.current!;
    // Au redimensionnement (panneau ouvert, rotation de l'écran), le centre de la vue est conservé.
    const ro = new ResizeObserver(() =>
      setSize((prev) => {
        const next = { w: el.clientWidth, h: el.clientHeight };
        if (prev.w && (prev.w !== next.w || prev.h !== next.h)) setView((v) => ({ ...v, ox: v.ox + (next.w - prev.w) / 2, oy: v.oy + (next.h - prev.h) / 2 }));
        return next;
      }),
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!fitted.current && size.w > 50) {
      fitted.current = true;
      fit();
    }
  }, [size, fit]);

  // ------------------------------------------------------------ Dessin

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { scale, ox, oy } = view;
    const X = (x: number) => x * scale + ox;
    const Y = (y: number) => y * scale + oy;

    ctx.fillStyle = cssVar("--canvas", "#e3d5c0");
    ctx.fillRect(0, 0, size.w, size.h);

    // Cadre et tissu
    const r = hoopRect();
    const fabric = cssVar("--fabric", "#fbf8f2");
    ctx.fillStyle = (display.realistic ? fabricPattern(ctx, fabric, scale) : null) ?? fabric;
    ctx.fillRect(X(r.x), Y(r.y), r.w * scale, r.h * scale);
    ctx.strokeStyle = "rgba(90,58,40,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = Math.ceil(r.x / 10) * 10; gx < r.x + r.w; gx += 10) {
      ctx.moveTo(X(gx), Y(r.y));
      ctx.lineTo(X(gx), Y(r.y + r.h));
    }
    for (let gy = Math.ceil(r.y / 10) * 10; gy < r.y + r.h; gy += 10) {
      ctx.moveTo(X(r.x), Y(gy));
      ctx.lineTo(X(r.x + r.w), Y(gy));
    }
    ctx.stroke();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = "rgba(90,58,40,0.35)";
    ctx.beginPath();
    ctx.moveTo(X(r.x + r.w / 2), Y(r.y));
    ctx.lineTo(X(r.x + r.w / 2), Y(r.y + r.h));
    ctx.moveTo(X(r.x), Y(r.y + r.h / 2));
    ctx.lineTo(X(r.x + r.w), Y(r.y + r.h / 2));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = cssVar("--hoop", "#8b5e3c");
    ctx.lineWidth = Math.max(3, 2.2 * scale);
    ctx.strokeRect(X(r.x) - ctx.lineWidth / 2, Y(r.y) - ctx.lineWidth / 2, r.w * scale + ctx.lineWidth, r.h * scale + ctx.lineWidth);

    // Plan de couture (avec aperçu de déplacement sans recalcul)
    if (plan) {
      let p = plan;
      if (drag?.kind === "move" && (drag.dx || drag.dy)) {
        const range = plan.objectRanges.find((x) => x.objectId === drag.id);
        if (range) {
          const st = plan.stitches.slice();
          for (let i = range.start; i < range.end; i++) st[i] = { ...st[i], x: st[i].x + drag.dx, y: st[i].y + drag.dy };
          p = { ...plan, stitches: st };
        }
      }
      renderPlan(ctx, p, view, {
        upto: upto ?? undefined,
        realistic: display.realistic,
        showJumps: display.showJumps,
        dimColor: display.dimColor,
        mode: display.mode,
      });
    }

    const copper = cssVar("--copper", "#a9682f");
    // Sélection
    const sel = design?.objects.find((o) => o.id === selection);
    if (sel) {
      const b = objectBounds(sel);
      const dx = drag?.kind === "move" ? drag.dx : 0;
      const dy = drag?.kind === "move" ? drag.dy : 0;
      ctx.strokeStyle = copper;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(X(b.minX + dx) - 4, Y(b.minY + dy) - 4, (b.maxX - b.minX) * scale + 8, (b.maxY - b.minY) * scale + 8);
      ctx.setLineDash([]);
      if (tool === "nodes") {
        const rs = rings(sel);
        rs.forEach((ring, ri) => {
          const pts = drag?.kind === "node" && drag.ring === ri ? ring.map((q, i) => (i === drag.index ? drag.p : q)) : ring;
          ctx.strokeStyle = copper;
          ctx.lineWidth = 1;
          ctx.beginPath();
          pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
          if (!sel.path) ctx.closePath();
          ctx.stroke();
          const step = Math.max(1, Math.ceil(pts.length / 400));
          ctx.fillStyle = cssVar("--raised", "#fff");
          for (let i = 0; i < pts.length; i += step) {
            ctx.fillRect(X(pts[i].x) - 3, Y(pts[i].y) - 3, 6, 6);
            ctx.strokeRect(X(pts[i].x) - 3, Y(pts[i].y) - 3, 6, 6);
          }
        });
      }
    }
    // Aperçu de création
    if (drag?.kind === "shape" || drag?.kind === "pen") {
      ctx.strokeStyle = copper;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const pts = drag.kind === "pen" ? drag.pts : shapePoints(drag.shape, drag.a, drag.b);
      pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y))));
      if (drag.kind === "shape") ctx.closePath();
      ctx.stroke();
    }
    // Repère du contrôle qualité
    if (marker?.length) {
      ctx.strokeStyle = cssVar("--err", "#9e2f28");
      ctx.lineWidth = 2;
      for (const m of marker) {
        ctx.beginPath();
        ctx.arc(X(m.x), Y(m.y), Math.max(10, 2.5 * scale), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [design, plan, view, size, drag, selection, tool, display, upto, marker, hoopRect]);

  // ------------------------------------------------------------ Interactions

  const toMm = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale };
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const nearestNode = (o: DesignObject, p: Point, tol: number) => {
    let best = { ring: -1, index: -1, d: tol };
    rings(o).forEach((ring, ri) =>
      ring.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < best.d) best = { ring: ri, index: i, d };
      }),
    );
    return best.ring >= 0 ? best : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvas.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view };
      setDrag(null);
      return;
    }
    const p = toMm(e);
    const l = local(e);
    const panning = tool === "pan" || props.spaceDown || e.button === 1;
    if (panning || !design) {
      setDrag({ kind: "pan", sx: l.x, sy: l.y, ox: view.ox, oy: view.oy });
      return;
    }
    if (tool === "rect" || tool === "ellipse") return setDrag({ kind: "shape", shape: tool, a: p, b: p });
    if (tool === "pen") return setDrag({ kind: "pen", pts: [p] });
    if (tool === "nodes" && selection) {
      const o = design.objects.find((x) => x.id === selection);
      const n = o && nearestNode(o, p, 8 / view.scale);
      if (o && n) {
        if (e.altKey) {
          const ring = rings(o)[n.ring];
          if (ring.length > (o.path ? 2 : 3)) props.onCommit((d) => editRing(d, o.id, n.ring, (r) => r.filter((_, i) => i !== n.index)));
          return;
        }
        return setDrag({ kind: "node", id: o.id, ring: n.ring, index: n.index, p: rings(o)[n.ring][n.index] });
      }
    }
    const hit = hitTestObject(design, p, 6 / view.scale);
    props.onSelect(hit?.id ?? null);
    if (hit && tool === "select") setDrag({ kind: "move", id: hit.id, start: p, dx: 0, dy: 0 });
    else if (!hit) setDrag({ kind: "pan", sx: l.x, sy: l.y, ox: view.ox, oy: view.oy });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, local(e));
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const v0 = pinch.current.view;
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, (v0.scale * d) / pinch.current.d));
      const k = scale / v0.scale;
      setView({ scale, ox: mx - (pinch.current.mx - v0.ox) * k, oy: my - (pinch.current.my - v0.oy) * k });
      return;
    }
    if (!drag) return;
    const p = toMm(e);
    if (drag.kind === "pan") {
      const l = local(e);
      setView((v) => ({ ...v, ox: drag.ox + l.x - drag.sx, oy: drag.oy + l.y - drag.sy }));
    } else if (drag.kind === "move") setDrag({ ...drag, dx: p.x - drag.start.x, dy: p.y - drag.start.y });
    else if (drag.kind === "node") setDrag({ ...drag, p });
    else if (drag.kind === "shape") setDrag({ ...drag, b: p });
    else if (drag.kind === "pen") {
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > 0.3) setDrag({ ...drag, pts: [...drag.pts, p] });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag;
    setDrag(null);
    if (!d || !design) return;
    if (d.kind === "move" && Math.hypot(d.dx, d.dy) > 0.05) {
      props.onCommit((des) => ({ ...des, objects: des.objects.map((o) => (o.id === d.id ? mapObjectPoints(o, (q) => ({ x: q.x + d.dx, y: q.y + d.dy })) : o)) }));
    } else if (d.kind === "node") {
      props.onCommit((des) => editRing(des, d.id, d.ring, (r) => r.map((q, i) => (i === d.index ? d.p : q))));
    } else if (d.kind === "shape") {
      if (Math.abs(d.b.x - d.a.x) < 1 || Math.abs(d.b.y - d.a.y) < 1) return;
      const id = nextObjectId(design);
      const obj = { ...createObject(id, "fill", props.drawColor, { outer: shapePoints(d.shape, d.a, d.b), holes: [] }), name: props.newObjectName(d.shape) };
      props.onCommit((des) => ({ ...des, objects: [...des.objects, obj] }));
      props.onSelect(id);
    } else if (d.kind === "pen") {
      const pts = simplifyPath(d.pts, 0.25);
      const len = pts.reduce((s, q, i) => (i ? s + Math.hypot(q.x - pts[i - 1].x, q.y - pts[i - 1].y) : 0), 0);
      if (pts.length < 2 || len < 2) return;
      const id = nextObjectId(design);
      const obj = { ...createObject(id, "triple", props.drawColor, { outer: [], holes: [] }, pts), name: props.newObjectName("pen") };
      props.onCommit((des) => ({ ...des, objects: [...des.objects, obj] }));
      props.onSelect(id);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== "nodes" || !design || !selection) return;
    const o = design.objects.find((x) => x.id === selection);
    if (!o) return;
    const p = toMm(e);
    let best = { ring: -1, index: -1, d: 10 / view.scale };
    rings(o).forEach((ring, ri) => {
      const n = o.path ? ring.length - 1 : ring.length;
      for (let i = 0; i < n; i++) {
        const dd = pointSegmentDistance(p, ring[i], ring[(i + 1) % ring.length]);
        if (dd < best.d) best = { ring: ri, index: i, d: dd };
      }
    });
    if (best.ring >= 0) props.onCommit((d) => editRing(d, o.id, best.ring, (r) => [...r.slice(0, best.index + 1), p, ...r.slice(best.index + 1)]));
  };

  useEffect(() => {
    const c = canvas.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const cursor = tool === "pan" || props.spaceDown ? (drag?.kind === "pan" ? "grabbing" : "grab") : tool === "select" ? "default" : "crosshair";
  return (
    <div className="workspace" ref={wrap}>
      <canvas
        ref={canvas}
        data-testid="stitch-canvas"
        style={{ width: size.w, height: size.h, cursor, touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
      <div className="zoom-readout num" aria-live="off">
        {Math.round((view.scale / (96 / 25.4)) * 100)} %
      </div>
    </div>
  );
}

function shapePoints(shape: "rect" | "ellipse", a: Point, b: Point): Point[] {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  if (shape === "rect")
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  return Array.from({ length: 64 }, (_, i) => {
    const t = (i / 64) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

function editRing(d: Design, id: string, ring: number, fn: (r: Point[]) => Point[]): Design {
  return {
    ...d,
    objects: d.objects.map((o) => {
      if (o.id !== id) return o;
      if (o.path) return { ...o, path: fn(o.path) };
      if (ring === 0) return { ...o, shape: { ...o.shape, outer: fn(o.shape.outer) } };
      return { ...o, shape: { ...o.shape, holes: o.shape.holes.map((h, i) => (i === ring - 1 ? fn(h) : h)) } };
    }),
  };
}
