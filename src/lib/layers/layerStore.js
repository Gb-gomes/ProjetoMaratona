/**
 * Armazenamento das camadas de dados no IndexedDB DESTE navegador.
 *
 * PROVISÓRIO, como o cadastro de pontos prioritários: sem backend, as
 * camadas enviadas ficam só neste navegador/perfil, sem controle de acesso,
 * e podem ser apagadas pela limpeza dos dados do site. O IndexedDB (e não o
 * localStorage) é usado porque redes elétricas têm centenas de milhares de
 * feições.
 *
 * Estrutura (espelha as tabelas da especificação):
 *   layers   metadados (layers + layer_shares + layer_uploads + versões)
 *   groups   layer_groups
 *   chunks   layer_features, em blocos de CHUNK_SIZE feições por versão
 *   customRegions  custom_regions (sub-regiões, com histórico)
 *   settings       regras por organização (ex.: sobreposição entre irmãs)
 *
 * Usado na thread principal (metadados) e no Web Worker (feições).
 */

export const DB_NAME = 'conecta-rural-camadas';
export const DB_VERSION = 1;
export const CHUNK_SIZE = 5000;

let dbPromise = null;

export function openDb(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('layers')) db.createObjectStore('layers', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('groups')) db.createObjectStore('groups', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      if (!db.objectStoreNames.contains('customRegions')) db.createObjectStore('customRegions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error ?? new Error('Falha ao abrir o IndexedDB.')); };
    req.onblocked = () => reject(new Error('O banco local está bloqueado por outra aba. Feche as outras abas do Conecta Rural.'));
  });
  return dbPromise;
}

/** Só para testes. */
export function resetDbConnection() { dbPromise = null; }

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('Transação cancelada (espaço insuficiente?).'));
});
const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const chunkKey = (layerId, version, n) => `${layerId}|${String(version).padStart(4, '0')}|${String(n).padStart(6, '0')}`;
const versionRange = (layerId, version) => IDBKeyRange.bound(chunkKey(layerId, version, 0), `${layerId}|${String(version).padStart(4, '0')}|￿`);
const layerRange = (layerId) => IDBKeyRange.bound(`${layerId}|`, `${layerId}|￿`);

export async function getAll(store) {
  const db = await openDb();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
  return value;
}

export async function remove(store, id) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await done(tx);
}

export const getAllLayers = () => getAll('layers');
export const putLayer = (layer) => put('layers', layer);
export const getAllGroups = () => getAll('groups');
export const putGroup = (group) => put('groups', group);
export const deleteGroup = (id) => remove('groups', id);

/** Grava as feições de uma versão em blocos. */
export async function writeFeatures(layerId, version, features, onProgress) {
  const db = await openDb();
  const total = Math.ceil(features.length / CHUNK_SIZE);
  for (let n = 0; n < total; n += 1) {
    const tx = db.transaction('chunks', 'readwrite');
    tx.objectStore('chunks').put(features.slice(n * CHUNK_SIZE, (n + 1) * CHUNK_SIZE), chunkKey(layerId, version, n));
    // eslint-disable-next-line no-await-in-loop
    await done(tx);
    onProgress?.((n + 1) / total);
  }
}

/** Lê todas as feições de uma versão. */
export async function readFeatures(layerId, version, onProgress) {
  const db = await openDb();
  const chunks = await request(db.transaction('chunks').objectStore('chunks').getAll(versionRange(layerId, version)));
  onProgress?.(1);
  return chunks.flat();
}

export async function deleteVersion(layerId, version) {
  const db = await openDb();
  const tx = db.transaction('chunks', 'readwrite');
  tx.objectStore('chunks').delete(versionRange(layerId, version));
  await done(tx);
}

/** Apaga a camada e todas as versões. */
export async function deleteLayerData(layerId) {
  const db = await openDb();
  const tx = db.transaction(['chunks', 'layers'], 'readwrite');
  tx.objectStore('chunks').delete(layerRange(layerId));
  tx.objectStore('layers').delete(layerId);
  await done(tx);
}

/** Espaço usado/disponível (estimativa do navegador). */
export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
