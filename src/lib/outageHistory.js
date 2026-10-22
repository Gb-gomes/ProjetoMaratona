/**
 * Histórico de desligamentos no IndexedDB DESTE navegador.
 *
 * Guarda só dados do sistema (ordem, alimentador, motivo, datas, horários e
 * comunidades afetadas com a quantidade de pontos). Nenhum dado de cliente:
 * nem coordenada, nem nome de propriedade. PROVISÓRIO como os demais
 * cadastros locais: em produção, o histórico vai para um banco central.
 */
import {
  useCallback, useEffect, useRef, useState,
} from 'react';

export const HISTORY_DB = 'conecta-rural-desligamentos';
const STORE = 'outages';

let dbPromise = null;

function openDb(idb = globalThis.indexedDB) {
  if (!idb) return Promise.reject(new Error('IndexedDB indisponível neste navegador.'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(HISTORY_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error ?? new Error('Falha ao abrir o histórico.')); };
  });
  return dbPromise;
}

/** Só para testes. */
export function resetHistoryConnection() { dbPromise = null; }

const run = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Gravação cancelada.'));
  });
};

export const listOutages = () => run('readonly', (s) => s.getAll());
export const saveOutage = (record) => run('readwrite', (s) => s.put(record));
export const deleteOutage = (id) => run('readwrite', (s) => s.delete(id));

/** Histórico de um modo (demonstração e dados reais nunca se misturam). */
export function useOutageHistory(mode, { onError } = {}) {
  const [records, setRecords] = useState([]);
  const [status, setStatus] = useState('loading');
  // onError costuma ser uma função nova a cada renderização: guardada em ref para não recarregar sem parar.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const reload = useCallback(async () => {
    try {
      const all = await listOutages();
      setRecords(all.filter((r) => r.mode === mode).sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '') || b.savedAt.localeCompare(a.savedAt)));
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      onErrorRef.current?.(err.message);
    }
  }, [mode]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (record) => { await saveOutage(record); await reload(); }, [reload]);
  const remove = useCallback(async (id) => { await deleteOutage(id); await reload(); }, [reload]);

  return { records, status, save, remove };
}

const CSV_COLS = ['ordem', 'alimentador', 'motivo', 'data', 'inicio', 'termino', 'duracaoH', 'dataAviso', 'antecedenciaDias', 'totalPontos', 'comunidades', 'savedBy', 'savedAt'];

/** CSV do histórico (separador ";", comunidades como "Nome (pontos)"). */
export function historyToCsv(records) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = records.map((r) => CSV_COLS.map((c) => cell(c === 'comunidades'
    ? r.comunidades.map((x) => `${x.nome} (${x.pontos})`).join(', ')
    : r[c])).join(';'));
  return [CSV_COLS.join(';'), ...rows].join('\n');
}
