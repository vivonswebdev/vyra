// Atelier vêtement : scène 3D (three.js). Le maillage suit la simulation à chaque image ; la texture est
// l'atlas dessiné à plat. Interactions : tourner la vue, tirer le tissu, déplacer une impression.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { type Atlas } from "./atlas.js";
import { type Backdrop, drawBackdrop } from "./backdrop.js";
import { bodyAt, buildCloth, hoodPoint, redrape, type Sim, step } from "./cloth.js";
import { buildMockup, type Mockup } from "./mockup.js";
import { atlasToPiece, type Garment, type Layout, type PieceId, PX_PER_CM as S } from "./garments.js";

export type CameraView = "front" | "side" | "back";
/** Maquette sculptée (rendu photo, défaut) ou simulation du tissu (drapé interactif). */
export type GarmentModel = "mockup" | "sim";
export type LightPreset = "studio" | "soft" | "contrast";
export type Fabric = "cotton" | "fleece" | "jersey";
/** Matières : rugosité, relief du tricot, reflet velouté (sheen) propre aux tissus. */
const FABRIC: Record<Fabric, { rough: number; bump: number; sheen: number; sheenRough: number }> = {
  cotton: { rough: 0.92, bump: 1.2, sheen: 0.55, sheenRough: 0.8 },
  fleece: { rough: 1, bump: 1.7, sheen: 0.85, sheenRough: 0.9 },
  jersey: { rough: 0.8, bump: 0.8, sheen: 0.4, sheenRough: 0.55 },
};
const LIGHTS: Record<LightPreset, { hemi: number; key: number; rim: number; env: number; warm: number }> = {
  // Réglé pour qu'un tissu blanc reste sous la saturation : sinon il « brûle » et ses plis disparaissent.
  studio: { hemi: 0.45, key: 1.05, rim: 0.45, env: 0.38, warm: 0xffffff },
  soft: { hemi: 0.65, key: 0.6, rim: 0.3, env: 0.5, warm: 0xfff6ec },
  contrast: { hemi: 0.22, key: 1.5, rim: 0.7, env: 0.22, warm: 0xffefd8 },
};
export interface SceneStats { nodes: number; constraints: number; solverMs: number; fps: number }
export type PrintPointer = (phase: "down" | "move" | "up", at: { piece: PieceId; x: number; y: number } | null) => boolean | void;

const VIEW_ANGLE: Record<CameraView, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

export class GarmentScene {
  mode: "pull" | "move" = "pull";
  private model: GarmentModel = "mockup";
  private mockCache = new Map<string, Mockup>();
  private worker: Worker | null = null;
  private workerSeq = 0;
  private pending = new Map<number, (m: Mockup) => void>();
  /** Appelé quand une maquette est prête (la page peut retirer son indicateur de calcul). */
  onBusy?: (busy: boolean) => void;
  turntable = false;
  breeze = false;
  onStats?: (s: SceneStats) => void;
  onPrint?: PrintPointer;
  onViewChange?: (v: CameraView | null) => void;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 5, 2000);
  private mat: THREE.MeshPhysicalMaterial;
  private aoTex!: THREE.CanvasTexture;
  private aoVersion = -1;
  private wrinkles = 0.6;
  private foldK = { value: 0.6 };
  /** Intérieur du vêtement : forme sombre qui bouche les jours (aisselles, encolure) au lieu du fond. */
  private filler = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x2a2724 }));
  private env: THREE.Texture;
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
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private rim!: THREE.DirectionalLight;
  private bg = document.createElement("canvas");
  private bgTex: THREE.CanvasTexture | null = null;
  private backdrop: Backdrop = { color: "#d9d3c8", leaves: true };
  private hanger = new THREE.Group();
  private hangerY = 0;
  private hangerOn = true;
  private fabric: Fabric = "cotton";
  private relief = 1;
  private puff = false;
  private reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(private canvas: HTMLCanvasElement, private atlas: Atlas) {
    // Lève une exception si WebGL est indisponible : la page affiche alors le patron 2D seul.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Rendu « photo produit » : tonalité neutre (couleurs du tissu fidèles), éclairage d'ambiance de studio.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.55;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8796ab, 0.9);
    this.scene.add(this.hemi);
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 2.2));
    key.position.set(115, 115, 95);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.5;
    Object.assign(key.shadow.camera, { left: -110, right: 110, top: 80, bottom: -130, near: 10, far: 500 });
    key.shadow.radius = 6;
    key.target.position.set(0, -40, 0);
    const rim = (this.rim = new THREE.DirectionalLight(0xdfe8ff, 1));
    rim.position.set(-120, 40, -120);
    this.scene.add(key, key.target, rim);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.ShadowMaterial({ opacity: 0.16 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -96;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.buildHanger();
    this.makeTextures();
    this.mat = new THREE.MeshPhysicalMaterial({
      map: this.tex, bumpMap: this.bumpTex, bumpScale: 1, aoMap: this.aoTex, aoMapIntensity: 0.9, roughness: 0.92, metalness: 0,
      sheen: 0.55, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff), side: THREE.DoubleSide, vertexColors: true,
    });
    // Envers du tissu (vu par l'encolure, les manches, l'ourlet) : nettement plus sombre, comme à l'ombre.
    // Plis : appliqués aussi à la couleur (pas seulement à la lumière d'ambiance), sinon un tissu blanc
    // en pleine lumière les efface.
    this.mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFold = this.foldK;
      sh.fragmentShader = "uniform float uFold;\n" + sh.fragmentShader.replace("#include <map_fragment>", [
        "#include <map_fragment>",
        "#ifdef USE_AOMAP",
        "  diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, uFold);",
        "#endif",
        "  if (!gl_FrontFacing) diffuseColor.rgb *= 0.42;",
      ].join("\n"));
    };
    this.filler.renderOrder = -1;
    this.scene.add(this.filler);
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
    const raised = g.hood && this.model === "sim";
    this.target.y = raised ? -24 : -36;
    this.fit = raised ? 1.18 : 1;
    this.resize();
    this.setHanger(this.hangerOn);
    this.sim = buildCloth(g);
    this.buildFiller();
    for (const m of [...this.meshes, ...this.cordMeshes, ...this.extra]) { this.scene.remove(m); m.geometry.dispose(); }
    this.meshes = []; this.cordMeshes = []; this.extra = [];
    this.filler.visible = this.model === "sim";
    if (this.model === "mockup") { this.buildMockupMesh(g, layout); this.texVersion = -1; return; }
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
      geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(1), 3));
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

  /** Change de modèle 3D (maquette ou simulation) ; le vêtement est reconstruit. */
  setModel(m: GarmentModel) {
    if (m === this.model) return;
    this.model = m;
    this.applyMaterial();
    if (this.g) this.setGarment(this.g, this.layout);
  }

  /** Calcule une maquette dans un Web Worker (secours : sur place si les workers sont indisponibles). */
  private requestMockup(g: Garment, layout: Layout): Promise<Mockup> {
    if (!this.worker && typeof Worker === "function") {
      try {
        this.worker = new Worker(new URL("./mockup.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (ev: MessageEvent<{ id: number; m: Mockup }>) => { this.pending.get(ev.data.id)?.(ev.data.m); this.pending.delete(ev.data.id); };
      } catch { this.worker = null; }
    }
    if (!this.worker) return Promise.resolve(buildMockup(g, layout));
    const id = ++this.workerSeq;
    return new Promise((res) => { this.pending.set(id, res); this.worker!.postMessage({ id, g, layout }); });
  }

  /** Maquette sculptée : maillage calculé une fois par vêtement (gardé en mémoire), immobile. */
  private buildMockupMesh(g: Garment, layout: Layout) {
    const m = this.mockCache.get(g.id);
    if (!m) {
      this.onBusy?.(true);
      void this.requestMockup(g, layout).then((built) => {
        this.mockCache.set(g.id, built);
        this.onBusy?.(false);
        // Toujours d'actualité (même vêtement, toujours en maquette) : on l'affiche.
        if (this.g === g && this.model === "mockup" && !this.disposed) this.setGarment(g, layout);
      });
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(m.ao.length * 3), 3));
    geo.userData.ao = m.ao;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    // Pas d'ombre portée reçue : à cette échelle elle crée des pointillés ; les creux sont ombrés par sommet.
    this.shadeMockup(mesh);
    this.scene.add(mesh);
    this.meshes.push(mesh);
    for (const line of m.cords) {
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line.map((p) => new THREE.Vector3(...p))), 40, 0.34, 8, false), this.cordMat);
      tube.castShadow = true;
      this.scene.add(tube);
      this.extra.push(tube);
    }
    // Cintre posé sur le col, barre à la largeur des épaules.
    this.hangerY = m.top + 0.3;
    this.hanger.position.set(0, this.hangerY, 0);
    this.hanger.children[1].scale.x = Math.min(1, (m.shoulder - 1.5) / 21);
  }

  /** Ombres des creux de la maquette, dosées par « Plis et ombres ». */
  private shadeMockup(mesh: THREE.Mesh) {
    const ao = mesh.geometry.userData.ao as Float32Array | undefined;
    if (!ao) return;
    const attr = mesh.geometry.attributes.color as THREE.BufferAttribute, arr = attr.array as Float32Array, k = Math.min(1, this.wrinkles * 1.5);
    for (let i = 0; i < ao.length; i++) { const v = 1 - k * (1 - ao[i]); arr[i * 3] = v; arr[i * 3 + 1] = v; arr[i * 3 + 2] = v; }
    attr.needsUpdate = true;
  }

  setCordColor(hex: string) { this.cordMat.color.set(hex); }
  /** Relief : plus marqué pour l'impression gonflante. */
  setRelief(puff: boolean) { this.puff = puff; this.applyMaterial(); }
  /** Matière (rugosité, relief du tricot) et intensité du relief (0 à 2). */
  setFabric(f: Fabric, relief: number, wrinkles = this.wrinkles) { this.fabric = f; this.relief = relief; this.wrinkles = wrinkles; this.applyMaterial(); }
  /** Couleur du tissu : teinte le reflet velouté et l'intérieur sombre du vêtement. */
  setGarmentColor(hex: string) {
    const c = new THREE.Color(hex);
    this.mat.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.45);
    (this.filler.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(0.1);
  }
  private applyMaterial() {
    const f = FABRIC[this.fabric];
    this.mat.roughness = f.rough;
    this.mat.sheen = f.sheen;
    this.mat.sheenRoughness = f.sheenRough;
    this.mat.bumpScale = (this.puff ? 2.6 : f.bump) * this.relief;
    // Plis peints : seulement pour la simulation ; la maquette a de vrais plis et ses propres ombres.
    const painted = this.model === "sim" ? this.wrinkles : 0;
    this.mat.aoMapIntensity = 0.5 * painted;
    this.foldK.value = 0.75 * painted;
    for (const m of this.meshes) this.shadeMockup(m);
  }
  setLight(p: LightPreset) {
    const l = LIGHTS[p];
    this.hemi.intensity = l.hemi; this.key.intensity = l.key; this.rim.intensity = l.rim;
    this.scene.environmentIntensity = l.env;
    this.key.color.set(l.warm);
  }
  setBackdrop(b: Backdrop) { this.backdrop = b; this.paintBackdrop(); }
  /** Cintre affiché sur demande ; jamais sous une capuche relevée, qui le recouvrirait. */
  setHanger(on: boolean) { this.hangerOn = on; this.hanger.visible = on && !(this.g?.hood && this.model === "sim"); }
  resetView() { this.turntable = false; this.cam.goal = 0; this.cam.phi = 0.08; this.resize(); }
  /** Image PNG de la vue 3D telle qu'affichée (fond de studio compris). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }

  private paintBackdrop() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(1.5, window.devicePixelRatio || 1);
    drawBackdrop(this.bg, r.width * k, r.height * k, this.backdrop);
    this.bgTex?.dispose();
    this.bgTex = new THREE.CanvasTexture(this.bg);
    this.bgTex.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = this.bgTex;
  }

  /** Forme intérieure : le torse de la forme fantôme, rétréci, fermé en haut sous l'encolure (fond sombre
   *  vu par le col) et arrêté au-dessus de l'ourlet : elle ne doit jamais dépasser du vêtement. */
  private buildFiller() {
    const seg = 32, ys: number[] = [], top = -Math.max(3, this.g.neckDropBack + 1.5), bottom = -(this.g.H - 6);
    for (let y = top; y >= bottom; y -= 2) ys.push(y);
    const pos: number[] = [], idx: number[] = [];
    for (const y of ys) {
      const [rx, rz] = bodyAt(y);
      for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(rx * 0.9 * Math.sin(a), y, rz * 0.9 * Math.cos(a)); }
    }
    for (let j = 0; j < ys.length - 1; j++) for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
    const cap = pos.length / 3;
    pos.push(0, ys[0], 0);
    for (let i = 0; i < seg; i++) idx.push(cap, i, (i + 1) % seg);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.filler.geometry.dispose();
    this.filler.geometry = geo;
    // Bras : cylindres et rotules d'épaule sombres, dans les manches (bouchent les jours aux épaules).
    for (const c of [...this.filler.children]) { (c as THREE.Mesh).geometry.dispose(); this.filler.remove(c); }
    const mat = this.filler.material as THREE.Material;
    for (const A of this.sim.arms) {
      // Arrêtés bien avant le poignet : une manche côtelée s'y resserre plus que le bras.
      const len = Math.min(A.len * 0.55, 24), dir = new THREE.Vector3(...A.d).normalize();
      const rEnd = A.r0 + (A.r1 - A.r0) * (len / A.len);
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(rEnd * 0.8, A.r0 * 0.88, len, 20, 1, true), mat);
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      cyl.position.set(...A.a).addScaledVector(dir, len / 2);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(A.r0 * 0.95, 20, 12), mat);
      ball.position.set(...A.a);
      this.filler.add(cyl, ball);
    }
    (this.filler.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  }

  /** Cintre : crochet au-dessus de l'encolure et barre cachée dans les épaules. */
  private buildHanger() {
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.35, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.55 });
    const hook = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 9.5, 0.4), new THREE.Vector3(1.6, 12.4, 0.4),
      new THREE.Vector3(4.2, 12.6, 0.2), new THREE.Vector3(5, 10.4, 0), new THREE.Vector3(3.6, 8.8, 0),
    ]);
    const h = new THREE.Mesh(new THREE.TubeGeometry(hook, 48, 0.34, 10, false), metal);
    h.castShadow = true;
    const bar = new THREE.CatmullRomCurve3([new THREE.Vector3(-21, -6.5, 0), new THREE.Vector3(-10, -2.4, 0), new THREE.Vector3(0, -0.6, 0), new THREE.Vector3(10, -2.4, 0), new THREE.Vector3(21, -6.5, 0)]);
    const b = new THREE.Mesh(new THREE.TubeGeometry(bar, 40, 1.05, 12, false), wood);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.6, 16), wood);
    neck.position.y = -0.2;
    this.hanger.add(h, b, neck);
    this.scene.add(this.hanger);
  }
  /** Hauteur du cintre : juste au-dessus du point le plus haut du col (ou de la capuche). */
  private placeHanger(dt: number) {
    const P = this.sim.pos;
    let top = -Infinity;
    for (let i = 0; i < this.sim.n; i++) if (Math.abs(P[i * 3]) < 5 && Math.abs(P[i * 3 + 2]) < 14) top = Math.max(top, P[i * 3 + 1]);
    if (!Number.isFinite(top) || !this.hanger.visible) return;
    this.hangerY += (top + 0.4 - this.hangerY) * Math.min(1, dt * 3);
    this.hanger.position.set(0, this.hangerY, 0);
  }
  redrape() { redrape(this.sim); }
  view(v: CameraView) { this.turntable = false; this.cam.goal = VIEW_ANGLE[v]; }

  start() {
    const loop = (now: number) => {
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private disposed = false;
  dispose() {
    this.disposed = true;
    this.worker?.terminate();
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.down);
    this.canvas.removeEventListener("pointermove", this.move);
    this.canvas.removeEventListener("pointerup", this.up);
    this.canvas.removeEventListener("pointercancel", this.up);
    this.canvas.removeEventListener("wheel", this.wheel);
    for (const m of [...this.meshes, ...this.cordMeshes, ...this.extra]) m.geometry.dispose();
    this.mat.dispose(); this.cordMat.dispose(); this.tex.dispose(); this.bumpTex.dispose(); this.aoTex.dispose(); this.env.dispose();
    this.filler.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); (this.filler.material as THREE.Material).dispose();
    this.bgTex?.dispose();
    this.hanger.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
    this.renderer.dispose();
  }

  private makeTextures() {
    this.tex = new THREE.CanvasTexture(this.atlas.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.bumpTex = new THREE.CanvasTexture(this.atlas.bump);
    this.aoTex = new THREE.CanvasTexture(this.atlas.folds);
    this.aoVersion = -1;
  }
  private replaceTextures() {
    this.tex.dispose();
    this.bumpTex.dispose();
    this.aoTex.dispose();
    this.makeTextures();
    this.mat.map = this.tex;
    this.mat.bumpMap = this.bumpTex;
    this.mat.aoMap = this.aoTex;
    this.mat.needsUpdate = true;
  }

  /**
   * Maillage d'une grille de simulation (tube : colonnes refermées), affiné R fois : chaque sommet affiché
   * est interpolé (Catmull-Rom) entre les particules voisines. La simulation garde sa résolution ; seul
   * l'affichage est lissé (silhouettes et plis sans facettes).
   */
  private grid(cols: number, rows: number, idxOf: (k: number, j: number) => number, uvOf: (k: number, j: number) => [number, number]) {
    const R = 2, C = cols * R, Rw = rows * R;
    const geo = new THREE.BufferGeometry();
    const count = (C + 1) * (Rw + 1);
    const table = new Int32Array(cols * (rows + 1));
    for (let j = 0; j <= rows; j++) for (let k = 0; k < cols; k++) table[j * cols + k] = idxOf(k, j);
    const base = new Int32Array(count * 2), frac = new Float32Array(count * 2), uv = new Float32Array(count * 2), index: number[] = [];
    for (let J = 0; J <= Rw; J++) for (let K = 0; K <= C; K++) {
      const v = J * (C + 1) + K;
      const k0 = Math.min(cols - 1, Math.floor(K / R)), j0 = Math.min(rows - 1, Math.floor(J / R));
      const fu = K / R - k0, fv = J / R - j0;
      base[v * 2] = k0; base[v * 2 + 1] = j0; frac[v * 2] = fu; frac[v * 2 + 1] = fv;
      const [a0, b0] = uvOf(k0, j0), [a1, b1] = uvOf(k0 + 1, j0), [a2, b2] = uvOf(k0, j0 + 1), [a3, b3] = uvOf(k0 + 1, j0 + 1);
      uv[v * 2] = (a0 * (1 - fu) + a1 * fu) * (1 - fv) + (a2 * (1 - fu) + a3 * fu) * fv;
      uv[v * 2 + 1] = (b0 * (1 - fu) + b1 * fu) * (1 - fv) + (b2 * (1 - fu) + b3 * fu) * fv;
    }
    for (let j = 0; j < Rw; j++) for (let k = 0; k < C; k++) {
      const a = j * (C + 1) + k, b = a + 1, c = a + C + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    geo.setIndex(index);
    geo.userData = { table, cols, rows, base, frac };
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private sync() {
    const P = this.sim.pos;
    const cr = (t: number, w: number[]) => {
      const t2 = t * t, t3 = t2 * t;
      w[0] = (-t3 + 2 * t2 - t) / 2; w[1] = (3 * t3 - 5 * t2 + 2) / 2; w[2] = (-3 * t3 + 4 * t2 + t) / 2; w[3] = (t3 - t2) / 2;
    };
    const wu = [0, 0, 0, 0], wv = [0, 0, 0, 0];
    for (const m of this.meshes) {
      const attr = m.geometry.attributes.position as THREE.BufferAttribute, arr = attr.array as Float32Array;
      const { table, cols, rows, base, frac } = m.geometry.userData as { table: Int32Array; cols: number; rows: number; base: Int32Array; frac: Float32Array };
      const n = frac.length / 2;
      for (let v = 0; v < n; v++) {
        const k0 = base[v * 2], j0 = base[v * 2 + 1];
        cr(frac[v * 2], wu); cr(frac[v * 2 + 1], wv);
        let x = 0, y = 0, z = 0;
        for (let b = 0; b < 4; b++) {
          const j = Math.max(0, Math.min(rows, j0 - 1 + b)), row = j * cols;
          for (let a = 0; a < 4; a++) {
            const k = (((k0 - 1 + a) % cols) + cols) % cols, w = wu[a] * wv[b], i = table[row + k] * 3;
            x += P[i] * w; y += P[i + 1] * w; z += P[i + 2] * w;
          }
        }
        arr[v * 3] = x; arr[v * 3 + 1] = y; arr[v * 3 + 2] = z;
      }
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
    this.paintBackdrop();
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
      if (this.aoVersion !== this.atlas.foldsVersion) {
        // Carte repeinte (autre vêtement) : texture recréée, une texture WebGL gardant la taille de sa
        // première image (elle a pu être envoyée vide, avant le premier dessin).
        this.aoTex.dispose();
        this.aoTex = new THREE.CanvasTexture(this.atlas.folds);
        this.mat.aoMap = this.aoTex;
        this.mat.needsUpdate = true;
        this.aoVersion = this.atlas.foldsVersion;
      }
      this.texVersion = this.atlas.version;
    }
    const t0 = performance.now();
    if (this.model === "sim") {
      step(this.sim, 1 / 120, { breeze: this.breeze });
      step(this.sim, 1 / 120, { breeze: this.breeze });
      this.sync();
      this.placeHanger(dt);
    }
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
      if (this.model === "sim") this.onStats?.({ nodes: this.sim.n, constraints: this.sim.ca.length, solverMs: this.statsAcc.solver, fps });
      else this.onStats?.({ nodes: this.mockCache.get(this.g.id)?.triangles ?? 0, constraints: 0, solverMs: 0, fps });
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
    if (h && this.mode === "pull" && this.model === "sim" && h.face) {
      const { table, cols, rows, base, frac } = (h.object as THREE.Mesh).geometry.userData as { table: Int32Array; cols: number; rows: number; base: Int32Array; frac: Float32Array };
      const P = this.sim.pos;
      // Sommet affiché → particule la plus proche dans la grille de simulation.
      const particle = (vi: number) => {
        const k = Math.round(base[vi * 2] + frac[vi * 2]) % cols, j = Math.min(rows, Math.round(base[vi * 2 + 1] + frac[vi * 2 + 1]));
        return table[j * cols + k];
      };
      let best = -1, bd = Infinity;
      for (const vi of [h.face.a, h.face.b, h.face.c]) {
        const i = particle(vi);
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
