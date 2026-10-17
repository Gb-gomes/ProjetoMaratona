/**
 * Persistência das sub-regiões e das regras da organização.
 *
 * PROVISÓRIO: IndexedDB DESTE navegador (as geometrias passam do limite do
 * localStorage). Não aparece em outro computador, navegador ou perfil, não
 * tem controle de acesso e pode ser apagado pela limpeza do navegador. Use
 * "Exportar GeoJSON" para guardar uma cópia.
 *
 * Contrato assíncrono, para ser trocado por uma API sem mudar a interface:
 *   repository.kind                 'local' | (futuro) 'api'
 *   repository.loadRegions()        → Promise<Region[]>   (inclui excluídas: exclusão lógica)
 *   repository.saveRegions(list)    → Promise<void>       (grava as alteradas)
 *   repository.loadSettings()       → Promise<{ allowSiblingOverlap }>
 *   repository.saveSettings(s)      → Promise<void>
 */
import { openDb } from './layers/layerStore.js';

const tx = (db, store, mode) => db.transaction(store, mode).objectStore(store);
const wait = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const commit = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve();
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error ?? new Error('Gravação cancelada (espaço insuficiente?).'));
});

export function createLocalRegionRepository({ orgId }) {
  const settingsId = `org:${orgId}`;
  return {
    kind: 'local',
    async loadRegions() {
      const db = await openDb();
      const all = await wait(tx(db, 'customRegions').getAll());
      return all.filter((r) => r.orgId === orgId);
    },
    /** Grava só as sub-regiões que mudaram (comparação por referência). */
    async saveRegions(next, previous = []) {
      const db = await openDb();
      const before = new Map(previous.map((r) => [r.id, r]));
      const changed = next.filter((r) => before.get(r.id) !== r);
      if (!changed.length) return;
      const t = db.transaction('customRegions', 'readwrite');
      changed.forEach((r) => t.objectStore('customRegions').put(r));
      await commit(t);
    },
    async loadSettings() {
      const db = await openDb();
      const s = await wait(tx(db, 'settings').get(settingsId));
      return s?.value ?? null;
    },
    async saveSettings(value) {
      const db = await openDb();
      const t = db.transaction('settings', 'readwrite');
      t.objectStore('settings').put({ id: settingsId, value });
      await commit(t);
    },
  };
}
