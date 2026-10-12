/**
 * Persistência do cadastro de pontos prioritários e do histórico de alertas.
 *
 * PROVISÓRIO: o projeto não tem backend nem banco de dados. Esta
 * implementação usa o localStorage DO NAVEGADOR ATUAL. Ela NÃO é um
 * cadastro corporativo: os dados não aparecem em outro computador,
 * navegador ou perfil, podem ser apagados pela limpeza do navegador e não
 * têm controle de acesso nem criptografia. Use apenas dados fictícios ou de
 * teste enquanto não houver um ambiente corporativo seguro.
 *
 * Contrato (assíncrono, para ser trocado por uma API sem mudar a interface):
 *   repository.kind            'local' | 'memory' | (futuro) 'api'
 *   repository.loadRecords()   → Promise<Record[]>
 *   repository.saveRecords(r)  → Promise<void>
 *   repository.loadAlerts()    → Promise<AlertStore>
 *   repository.saveAlerts(s)   → Promise<void>
 *
 * Demonstração e teste real usam escopos separados: nada é compartilhado.
 */

const PREFIX = 'conecta-rural:pontos-prioritarios:v1:';

/** Armazenamento em memória com a mesma interface do localStorage (testes). */
export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    keys: () => [...data.keys()],
  };
}

const defaultStorage = () => {
  try { return window.localStorage; } catch { return null; }
};

/** Chave de escopo: 'demo' ou 'real:<código IBGE do território>'. */
export const priorityScope = (mode, territoryCode) => (mode === 'real' ? `real:${territoryCode ?? 'sem-territorio'}` : 'demo');

/**
 * @param {{ scope:string, storage?:Storage, seed?:() => object[] }} options
 *   seed: registros fictícios gravados quando o escopo ainda está vazio
 *   (usado só na demonstração).
 */
export function createLocalPriorityRepository({ scope, storage = defaultStorage(), seed = null }) {
  const recordsKey = `${PREFIX}${scope}:registros`;
  const alertsKey = `${PREFIX}${scope}:alertas`;

  const read = (key, fallback) => {
    if (!storage) throw new Error('Armazenamento local indisponível neste navegador.');
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  };
  const write = (key, value) => {
    if (!storage) throw new Error('Armazenamento local indisponível neste navegador.');
    storage.setItem(key, JSON.stringify(value));
  };

  return {
    kind: storage ? 'local' : 'unavailable',
    scope,
    async loadRecords() {
      const records = read(recordsKey, null);
      if (records == null && seed) {
        const seeded = seed();
        write(recordsKey, seeded);
        return seeded;
      }
      return Array.isArray(records) ? records : [];
    },
    async saveRecords(records) { write(recordsKey, records); },
    async loadAlerts() {
      const alerts = read(alertsKey, {});
      return alerts && typeof alerts === 'object' && !Array.isArray(alerts) ? alerts : {};
    },
    async saveAlerts(alerts) { write(alertsKey, alerts); },
    /** Apaga o escopo (usado para restaurar a demonstração). */
    async clear() {
      storage?.removeItem(recordsKey);
      storage?.removeItem(alertsKey);
    },
  };
}
