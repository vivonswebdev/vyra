// Atelier vêtement : modèle 3D importé, gardé dans ce navigateur (IndexedDB), un par projet. Jamais envoyé
// au serveur. Si le stockage est indisponible (navigation privée), le modèle vaut pour la session seulement.
export interface StoredModel { name: string; data: ArrayBuffer }

const DB = "vyra-atelier", STORE = "models";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((res, rej) => {
      const rq = f(db.transaction(STORE, mode).objectStore(STORE));
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}
export const loadModel = (projectId: string) => run<StoredModel | undefined>("readonly", (s) => s.get(projectId));
export const saveModel = (projectId: string, m: StoredModel) => run("readwrite", (s) => s.put(m, projectId));
export const deleteModel = (projectId: string) => run("readwrite", (s) => s.delete(projectId));
