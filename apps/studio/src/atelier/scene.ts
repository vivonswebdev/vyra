// Atelier vêtement : scène 3D (three.js). Le maillage suit la simulation à chaque image ; la texture est
// l'atlas dessiné à plat. Interactions : tourner la vue, tirer le tissu, déplacer une impression.
import * as THREE from "three";
import { type Atlas } from "./atlas.js";
import { buildCloth, hoodPoint, redrape, type Sim, step } from "./cloth.js";
import { atlasToPiece, type Garment, type Layout, type PieceId, PX_PER_CM as S } from "./garments.js";

export type CameraView = "front" | "side" | "back";
export interface SceneStats { nodes: number; constraints: number; solverMs: number; fps: number }
export type PrintPointer = (phase: "down" | "move" | "up", at: { piece: PieceId; x: number; y: number } | null) => boolean | void;

const VIEW_ANGLE: Record<CameraView, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

export class GarmentScene {
  mode: "pull" | "move" = "pull";
  turntable = false;
  breeze = false;
  onStats?: (s: SceneStats) => void;
  onPrint?: PrintPointer;
  onViewChange?: (v: CameraView | null) => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 5, 2000);
  private mat: THREE.MeshStandardMaterial;
  private tex!: THREE.CanvasTexture;
  private bumpTex!: THREE.CanvasTexture;
  private cordMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 });
  private meshes: THREE.Mesh[] = [];
  private cordMeshes: THREE.Mesh[] = [];
  private extra: THREE.Mesh[] = [];
  private sim!: Sim;
  private g!: Garment;
  private layout!: Layout;
  private cam = { theta: 0, phi: 0.08, dist: 230, goal: null as number | null };
  private target = new THREE.Vector3(0, -36, 0);
  private fit = 1;
  private raf = 0;
  private last = performance.now();
  private texVersion = -1;
  private texSize: [number, number] = [-1, -1];
  private ray = new THREE.Raycaster();
  private drag: null | { type: "orbit"; x: number; y: number; theta: number; phi: number } | { type: "pull"; plane: THREE.Plane; offset: THREE.Vector3 } | { type: "move" } = null;
  private ro: ResizeObserver;
  private statsAcc = { solver: 0, frames: 0, t0: performance.now() };
  private reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    // Lève une exception si WebGL est indisponible : la page affiche alors le patron 2D seul.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8796ab, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(60, 120, 140);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -110, right: 110, top: 80, bottom: -130, near: 10, far: 500 });
    key.shadow.radius = 6;
    key.target.position.set(0, -40, 0);
    const rim = new THREE.DirectionalLight(0xdfe8ff, 1);
    rim.position.set(-120, 40, -120);
    this.scene.add(key, key.target, rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -96;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.makeTextures();
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, bumpMap: this.bumpTex, bumpScale: 1, roughness: 0.93, metalness: 0, side: THREE.DoubleSide });
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  get stats() {
    return { nodes: this.sim?.n ?? 0, constraints: this.sim?.ca.length ?? 0 };
  }

  setGarment(g: Garment, layout: Layout) {
    this.g = g;
    this.layout = layout;
    // Cadrage : la capuche relevée dépasse de 30 cm au-dessus des épaules ; la caméra remonte et recule un peu
    // pour la montrer entière sous l'en-tête de la vue.
    this.target.y = g.hood ? -24 : -36;
    this.fit = g.hood ? 1.18 : 1;
    this.resize();
    this.sim = buildCloth(g);
    for (const m of [...this.meshes, ...this.cordMeshes, ...this.extra]) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes = []; this.cordMeshes = []; this.extra = [];
    const W = layout.width * S, H = layout.height * S;
    const T = this.sim.torso;
    this.meshes.push(this.grid(T.cols, T.rows, (k, j) => T.idx[j * T.cols + k], (k, j) => [(k / T.cols) * (2 * g.W * S) / W, 1 - (T.vcm[j * T.cols + (k % T.cols)] * S) / H]));
    for (const sl of this.sim.sleeves) {
      const r = layout.regions[sl.key];
      this.meshes.push(this.grid(sl.cols, sl.rows, (k, j) => sl.idx[j * sl.cols + k], (k, j) => [((r.x0 + (k / sl.cols) * r.w) * S) / W, 1 - ((j / sl.rows) * r.h * S) / H]));
    }
    if (g.hood) {
      const cu = 40, cv = 16, p = layout.regions.plain, pos: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let j = 0; j <= cv; j++) for (let i = 0; i <= cu; i++) {
        pos.push(...hoodPoint(g, i / cu, j / cv));
        uv.push(((p.x0 + 2 + (i / cu) * (p.w - 4)) * S) / W, 1 - ((p.y0 + 2 + (j / cv) * (p.h - 4)) * S) / H);
      }
      for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) { const a = j * (cu + 1) + i, b = a + 1, c = a + cu + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const hood = new THREE.Mesh(geo, this.mat);
      hood.castShadow = true;
      this.scene.add(hood);
      this.extra.push(hood);
      for (let i = 0; i < this.sim.cords.length; i++) {
        const m = new THREE.Mesh(new THREE.BufferGeometry(), this.cordMat);
        m.castShadow = true;
        this.scene.add(m);
        this.cordMeshes.push(m);
      }
    }
    this.texVersion = -1;
    this.sync();
  }

  setCordColor(hex: string) { this.cordMat.color.set(hex); }
  /** Relief : plus marqué pour l'impression gonflante. */
  setRelief(puff: boolean) { this.mat.bumpScale = puff ? 2.6 : 1.2; }
  redrape() { redrape(this.sim); }
  view(v: CameraView) { this.turntable = false; this.cam.goal = VIEW_ANGLE[v]; }

  start() {
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.up);
    this.canvas.removeEventListener("wheel", this.wheel);
    for (const m of [...this.meshes, ...this.cordMeshes, ...this.extra]) m.geometry.dispose();
    this.mat.dispose(); this.cordMat.dispose(); this.tex.dispose(); this.bumpTex.dispose();
    this.renderer.dispose();
  }

  private makeTextures() {
    this.tex = new THREE.CanvasTexture(this.atlas.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.bumpTex = new THREE.CanvasTexture(this.atlas.bump);
  }
  private replaceTextures() {
    this.tex.dispose();
    this.bumpTex.dispose();
    this.makeTextures();
    this.mat.map = this.tex;
    this.mat.bumpMap = this.bumpTex;
    this.mat.needsUpdate = true;
  }

  private grid(cols: number, rows: number, idxOf: (k: number, j: number) => number, uvOf: (k: number, j: number) => [number, number]) {
    const geo = new THREE.BufferGeometry();
    const count = (cols + 1) * (rows + 1);
    const map = new Int32Array(count), uv = new Float32Array(count * 2), index: number[] = [];
    for (let j = 0; j <= rows; j++) for (let k = 0; k <= cols; k++) {
      const v = j * (cols + 1) + k;
      map[v] = idxOf(k % cols, j);
      const [a, b] = uvOf(k, j);
      uv[v * 2] = a; uv[v * 2 + 1] = b;
    }
    for (let j = 0; j < rows; j++) for (let k = 0; k < cols; k++) {
      const a = j * (cols + 1) + k, b = a + 1, c = a + cols + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.userData.map = map;
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private sync() {
    const P = this.sim.pos;
    for (const m of this.meshes) {
      const attr = m.geometry.attributes.position as THREE.BufferAttribute, arr = attr.array as Float32Array, map = m.geometry.userData.map as Int32Array;
      for (let v = 0; v < map.length; v++) { const i = map[v] * 3; arr[v * 3] = P[i]; arr[v * 3 + 1] = P[i + 1]; arr[v * 3 + 2] = P[i + 2]; }
      attr.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
    this.cordMeshes.forEach((m, k) => {
      const pts = this.sim.cords[k].map((i) => new THREE.Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
      m.geometry.dispose();
      m.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.32, 6, false);
    });
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.cam.dist = Math.max(210, (240 / Math.min(1, this.camera.aspect)) * 0.92) * this.fit;
  }

  private frame(now: number) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.texVersion !== this.atlas.version) {
      // Une texture WebGL garde la taille de sa première image : si l'atlas a changé de taille (autre
      // vêtement), elle est recréée ; sinon, simple recopie.
      const img = this.tex.image as HTMLCanvasElement;
      if (this.texSize[0] !== img.width || this.texSize[1] !== img.height) {
        if (this.texSize[0] >= 0) this.replaceTextures();
        this.texSize = [img.width, img.height];
      }
      this.tex.needsUpdate = true;
      this.bumpTex.needsUpdate = true;
      this.texVersion = this.atlas.version;
    }
    const t0 = performance.now();
    step(this.sim, 1 / 120, { breeze: this.breeze });
    step(this.sim, 1 / 120, { breeze: this.breeze });
    this.sync();
    this.statsAcc.solver = this.statsAcc.solver * 0.9 + (performance.now() - t0) * 0.1;
    if (this.turntable && !this.reduceMotion) this.cam.theta += dt * 0.45;
    if (this.cam.goal != null) {
      const d = Math.atan2(Math.sin(this.cam.goal - this.cam.theta), Math.cos(this.cam.goal - this.cam.theta));
      this.cam.theta += this.reduceMotion ? d : d * Math.min(1, dt * 6);
      if (Math.abs(d) < 0.002) { this.cam.theta = this.cam.goal; this.cam.goal = null; this.onViewChange?.(this.currentView()); }
    }
    const { theta, phi, dist } = this.cam;
    this.camera.position.set(this.target.x + dist * Math.sin(theta) * Math.cos(phi), this.target.y + dist * Math.sin(phi), this.target.z + dist * Math.cos(theta) * Math.cos(phi));
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
    this.statsAcc.frames++;
    if (now - this.statsAcc.t0 > 500) {
      const fps = Math.round((this.statsAcc.frames * 1000) / (now - this.statsAcc.t0));
      this.statsAcc.frames = 0; this.statsAcc.t0 = now;
      this.onStats?.({ nodes: this.sim.n, constraints: this.sim.ca.length, solverMs: this.statsAcc.solver, fps });
    }
  }

  private currentView(): CameraView | null {
    const t = ((this.cam.theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (const [v, a] of Object.entries(VIEW_ANGLE)) if (Math.abs(Math.atan2(Math.sin(t - a), Math.cos(t - a))) < 0.05) return v as CameraView;
    return null;
  }

  private hit(ev: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
    return this.ray.intersectObjects(this.meshes, false)[0] ?? null;
  }
  private toPiece(h: THREE.Intersection | null) {
    if (!h?.uv) return null;
    return atlasToPiece(this.layout, h.uv.x * this.layout.width, (1 - h.uv.y) * this.layout.height);
  }

  private down = (ev: PointerEvent) => {
    this.canvas.setPointerCapture(ev.pointerId);
    const h = this.hit(ev);
    if (h && this.mode === "pull" && h.face) {
      const map = (h.object as THREE.Mesh).geometry.userData.map as Int32Array, P = this.sim.pos;
      let best = -1, bd = Infinity;
      for (const vi of [h.face.a, h.face.b, h.face.c]) {
        const i = map[vi];
        const d = (P[i * 3] - h.point.x) ** 2 + (P[i * 3 + 1] - h.point.y) ** 2 + (P[i * 3 + 2] - h.point.z) ** 2;
        if (d < bd && this.sim.inv[i]) { bd = d; best = i; }
      }
      if (best >= 0) {
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), h.point);
        this.drag = { type: "pull", plane, offset: new THREE.Vector3(P[best * 3], P[best * 3 + 1], P[best * 3 + 2]).sub(h.point) };
        this.sim.grab = { i: best, target: [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]] };
        this.canvas.style.cursor = "grabbing";
        return;
      }
    }
    if (h && this.mode === "move" && this.onPrint?.("down", this.toPiece(h))) {
      this.drag = { type: "move" };
      this.canvas.style.cursor = "move";
      return;
    }
    this.drag = { type: "orbit", x: ev.clientX, y: ev.clientY, theta: this.cam.theta, phi: this.cam.phi };
    this.turntable = false;
    this.cam.goal = null;
    this.onViewChange?.(null);
  };
  private move = (ev: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (d.type === "orbit") {
      this.cam.theta = d.theta - (ev.clientX - d.x) * 0.008;
      this.cam.phi = Math.max(-0.5, Math.min(0.8, d.phi + (ev.clientY - d.y) * 0.005));
    } else if (d.type === "pull") {
      const r = this.canvas.getBoundingClientRect();
      this.ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const p = new THREE.Vector3();
      if (this.ray.ray.intersectPlane(d.plane, p)) { p.add(d.offset); this.sim.grab.target = [p.x, p.y, p.z]; }
    } else {
      this.onPrint?.("move", this.toPiece(this.hit(ev)));
    }
  };
  private up = () => {
    if (this.drag?.type === "pull") this.sim.grab = { i: -1, target: [0, 0, 0] };
    if (this.drag?.type === "move") this.onPrint?.("up", null);
    this.drag = null;
    this.canvas.style.cursor = "";
  };
  private wheel = (ev: WheelEvent) => {
    ev.preventDefault();
    this.cam.dist = Math.max(110, Math.min(420, this.cam.dist * (1 + ev.deltaY * 0.001)));
  };
}
