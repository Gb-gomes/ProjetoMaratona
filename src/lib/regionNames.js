/**
 * Nomes de região definidos pelo operador.
 *
 * Quando a malha do IBGE não tem um nome adequado (setor sem nome, ou só
 * "Rural"), o operador pode registrar o nome pelo qual a comunidade conhece
 * a região. Cada alteração guarda: nome novo, nome anterior, responsável,
 * data/hora e observação, em um histórico que nunca é apagado.
 *
 * Armazenamento: localStorage deste navegador (somente nomes de região, por
 * código oficial; nenhuma coordenada ou dado de cliente). Para levar a outra
 * máquina ou versionar no projeto, use exportar/importar (JSON no formato de
 * public/data/ibge/correspondencia_nomes.json).
 */

const STORAGE_PREFIX = 'conecta-rural:nomes-regioes:v1:';
const OPERATOR_KEY = 'conecta-rural:responsavel';

/** Estrutura: { [codigo]: { current: {...} | null, history: [...] } } */
export const EMPTY_STORE = {};

const nowIso = () => new Date().toISOString();
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Registra (ou altera) o nome de uma região.
 * @returns {object} novo store (imutável)
 */
export function renameRegion(store, {
  code, name, by, note = '', previousName = null, at = nowIso(),
}) {
  const n = clean(name);
  const who = clean(by);
  if (!code) throw new Error('Código da região ausente.');
  if (n.length < 2) throw new Error('Informe um nome com pelo menos 2 caracteres.');
  if (n.length > 80) throw new Error('O nome deve ter no máximo 80 caracteres.');
  if (/[[\]]/.test(n)) throw new Error('O nome não pode conter colchetes.');
  if (!who) throw new Error('Informe o responsável pela alteração.');

  const entry = store[code] ?? { current: null, history: [] };
  const before = entry.current?.name ?? previousName ?? null;
  if (entry.current && entry.current.name === n) return store;
  const record = {
    action: entry.current ? 'alterado' : 'definido', name: n, previousName: before, by: who, at, note: clean(note),
  };
  return {
    ...store,
    [code]: {
      current: { name: n, by: who, at, note: record.note },
      history: [...entry.history, record],
    },
  };
}

/** Remove o nome do operador (volta ao nome oficial/pendente), mantendo o histórico. */
export function removeRegionName(store, { code, by, note = '', at = nowIso() }) {
  const entry = store[code];
  if (!entry?.current) return store;
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela alteração.');
  return {
    ...store,
    [code]: {
      current: null,
      history: [...entry.history, {
        action: 'removido', name: null, previousName: entry.current.name, by: who, at, note: clean(note),
      }],
    },
  };
}

/** Converte o store no formato de correspondência usado por resolveSpeakableName. */
export function storeToCorrespondence(store) {
  const out = {};
  Object.entries(store ?? {}).forEach(([code, entry]) => {
    if (entry?.current?.name) {
      out[code] = {
        name: entry.current.name,
        validatedBy: entry.current.by,
        validatedOn: entry.current.at,
        source: 'Nome definido pelo operador',
        origin: 'operator',
      };
    }
  });
  return out;
}

/** JSON exportável (mesmo formato da tabela de correspondência + histórico). */
export function exportStore(store, territory) {
  return {
    _leia_me: 'Nomes de região definidos no Conecta Rural. Pode ser salvo como public/data/ibge/correspondencia_nomes.json ou importado em outro navegador.',
    territorio: territory ?? null,
    exportadoEm: nowIso(),
    entries: Object.entries(store)
      .filter(([, e]) => e.current)
      .map(([code, e]) => ({
        code, name: e.current.name, validatedBy: e.current.by, validatedOn: e.current.at, source: 'Nome definido pelo operador', note: e.current.note,
      })),
    historico: Object.fromEntries(Object.entries(store).map(([code, e]) => [code, e.history])),
  };
}

/**
 * Importa um JSON exportado. Entradas importadas viram registros de
 * histórico ("importado"); nada do histórico local é apagado.
 */
export function importStore(store, json, { by, at = nowIso() } = {}) {
  if (!json || !Array.isArray(json.entries)) throw new Error('Arquivo de nomes inválido: campo "entries" ausente.');
  let next = { ...store };
  let count = 0;
  json.entries.forEach((e) => {
    const name = clean(e?.name);
    if (!e?.code || name.length < 2 || /[[\]]/.test(name)) return;
    const entry = next[e.code] ?? { current: null, history: [] };
    if (entry.current?.name === name) return;
    const importedHistory = Array.isArray(json.historico?.[e.code]) ? json.historico[e.code] : [];
    const known = new Set(entry.history.map((h) => `${h.at}|${h.name}`));
    const merged = [...entry.history, ...importedHistory.filter((h) => !known.has(`${h.at}|${h.name}`))];
    merged.push({
      action: 'importado', name, previousName: entry.current?.name ?? null, by: clean(by) || 'importação', at, note: `Origem: ${clean(e.validatedBy) || 'desconhecida'}`,
    });
    next = {
      ...next,
      [e.code]: { current: { name, by: clean(e.validatedBy) || clean(by) || 'importação', at: e.validatedOn ?? at, note: clean(e.note) }, history: merged },
    };
    count += 1;
  });
  return { store: next, count };
}

/* ---------------- Persistência (localStorage, com tolerância a falhas) ---------------- */

export function loadStore(territoryCode) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + (territoryCode ?? 'sem-territorio'));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** @returns {boolean} se conseguiu salvar */
export function saveStore(territoryCode, store) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + (territoryCode ?? 'sem-territorio'), JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function loadOperator() {
  try { return window.localStorage.getItem(OPERATOR_KEY) ?? ''; } catch { return ''; }
}

export function saveOperator(name) {
  try { window.localStorage.setItem(OPERATOR_KEY, clean(name)); } catch { /* conveniência apenas */ }
}
