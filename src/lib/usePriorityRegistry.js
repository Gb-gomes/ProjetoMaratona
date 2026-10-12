import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createLocalPriorityRepository } from './priorityRepository.js';

/**
 * Estado do cadastro prioritário e do histórico de alertas de um escopo
 * ('demo' ou 'real:<território>'). A interface só conhece este hook; para
 * usar uma API corporativa, troque o repositório criado abaixo.
 */
export function usePriorityRegistry(scope, { seed = null, onError } = {}) {
  const repo = useMemo(() => createLocalPriorityRepository({ scope, seed }), [scope, seed]);
  const [state, setState] = useState({ status: 'loading', records: [], alerts: {}, error: '' });
  const [reloadTick, setReloadTick] = useState(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', records: [], alerts: {}, error: '' });
    Promise.all([repo.loadRecords(), repo.loadAlerts()])
      .then(([records, alerts]) => { if (alive) setState({ status: 'ready', records, alerts, error: '' }); })
      .catch((err) => {
        if (alive) setState({ status: 'error', records: [], alerts: {}, error: `Não foi possível ler o cadastro salvo: ${err.message}` });
      });
    return () => { alive = false; };
  }, [repo, reloadTick]);

  const commitRecords = useCallback(async (records) => {
    setState((s) => ({ ...s, records }));
    try {
      await repo.saveRecords(records);
      return true;
    } catch (err) {
      errorRef.current?.(`Não foi possível salvar o cadastro neste navegador: ${err.message}`);
      return false;
    }
  }, [repo]);

  const commitAlerts = useCallback(async (alerts) => {
    setState((s) => ({ ...s, alerts }));
    try {
      await repo.saveAlerts(alerts);
      return true;
    } catch (err) {
      errorRef.current?.(`Não foi possível salvar o histórico de alertas: ${err.message}`);
      return false;
    }
  }, [repo]);

  const reset = useCallback(async () => {
    await repo.clear();
    setReloadTick((n) => n + 1);
  }, [repo]);

  return {
    ...state, kind: repo.kind, commitRecords, commitAlerts, reset,
  };
}
