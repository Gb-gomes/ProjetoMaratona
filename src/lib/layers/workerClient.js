/**
 * Cliente do Web Worker das camadas de dados (um único worker por aba).
 * request(type, payload, { onProgress, transfer }) → Promise<result>
 */
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./dataLayer.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { id, kind } = event.data ?? {};
    const entry = pending.get(id);
    if (!entry) return;
    if (kind === 'progress') {
      entry.onProgress?.(event.data.value, event.data.stage);
      return;
    }
    pending.delete(id);
    if (kind === 'result') entry.resolve(event.data.result);
    else entry.reject(new Error(event.data.message ?? 'Falha no processamento da camada.'));
  };
  worker.onerror = (event) => {
    const err = new Error(event.message || 'O processamento da camada falhou (memória insuficiente?).');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function request(type, payload, { onProgress, transfer } = {}) {
  seq += 1;
  const id = seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, payload }, transfer ?? []);
  });
}
