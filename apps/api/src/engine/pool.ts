// Pool de calcul du moteur : nombre de workers fixe, file d'attente bornée, délai maximal par tâche
// et mémoire limitée. Un calcul trop long est interrompu (worker détruit puis remplacé) : l'API
// reste disponible pour les autres utilisateurs.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { HttpError } from "../lib/errors.js";

const WORKER_URL = new URL("./worker.mjs", import.meta.url);

export interface PoolOptions {
  size: number;
  timeoutMs: number;
  maxQueue: number;
  maxMemoryMb: number;
}

interface Job {
  id: number;
  task: string;
  input: unknown;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
}

interface Slot {
  worker: Worker;
  job: Job | null;
  timer: NodeJS.Timeout | null;
}

export class EnginePool {
  private slots: Slot[] = [];
  private queue: Job[] = [];
  private seq = 0;
  private closed = false;
  stats = { completed: 0, timeouts: 0, rejected: 0, crashes: 0 };

  constructor(private opts: PoolOptions) {
    for (let i = 0; i < opts.size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const worker = new Worker(fileURLToPath(WORKER_URL), {
      resourceLimits: { maxOldGenerationSizeMb: this.opts.maxMemoryMb },
      execArgv: [],
    });
    const slot: Slot = { worker, job: null, timer: null };
    worker.on("message", (m: { id: number; ok: boolean; result?: any; error?: string }) => {
      const job = slot.job;
      if (!job || job.id !== m.id) return;
      this.finish(slot);
      this.stats.completed++;
      m.ok ? job.resolve(m.result) : job.reject(new HttpError(422, "engine_error", "Le moteur a refusé ce document : " + m.error));
      this.next();
    });
    worker.on("error", (err) => this.crash(slot, err));
    worker.on("exit", (code) => code !== 0 && slot.job && this.crash(slot, new Error("exit " + code)));
    return slot;
  }

  private finish(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job = null;
  }

  private replace(slot: Slot) {
    const i = this.slots.indexOf(slot);
    slot.worker.removeAllListeners();
    slot.worker.terminate().catch(() => {});
    if (!this.closed && i >= 0) this.slots[i] = this.spawn();
  }

  private crash(slot: Slot, err: Error) {
    const job = slot.job;
    this.finish(slot);
    this.stats.crashes++;
    this.replace(slot);
    job?.reject(new HttpError(503, "engine_crash", "Le calcul a échoué (mémoire ou erreur interne). Réessayez ; si le problème persiste, simplifiez le motif."));
    void err;
    this.next();
  }

  private next() {
    for (const slot of this.slots) {
      if (slot.job || !this.queue.length) continue;
      const job = this.queue.shift()!;
      slot.job = job;
      slot.timer = setTimeout(() => {
        this.finish(slot);
        this.stats.timeouts++;
        this.replace(slot);
        job.reject(new HttpError(503, "engine_timeout", "Calcul interrompu : il dépassait la durée maximale autorisée. Simplifiez le motif ou réduisez la densité."));
        this.next();
      }, this.opts.timeoutMs);
      slot.worker.postMessage({ id: job.id, task: job.task, input: job.input });
    }
  }

  run<T = any>(task: string, input: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new HttpError(503, "engine_closed", "Service en cours d'arrêt."));
    const busy = this.slots.filter((s) => s.job).length;
    if (busy >= this.slots.length && this.queue.length >= this.opts.maxQueue) {
      this.stats.rejected++;
      return Promise.reject(new HttpError(503, "engine_busy", "Le service de calcul est saturé. Réessayez dans quelques instants."));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id: ++this.seq, task, input, resolve, reject });
      this.next();
    });
  }

  async close() {
    this.closed = true;
    for (const j of this.queue.splice(0)) j.reject(new HttpError(503, "engine_closed", "Service en cours d'arrêt."));
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
  }
}
