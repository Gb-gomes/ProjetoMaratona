import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createLocalRegionRepository } from './customRegionRepository.js';
import { isActive } from './customRegions.js';

/**
 * Estado das sub-regiões de uma organização. A interface só conhece este
 * hook; para usar uma API, troque o repositório.
 */
export function useCustomRegions({ orgId, defaults, enabled = true, onError }) {
  const repo = useMemo(() => createLocalRegionRepository({ orgId }), [orgId]);
  const [state, setState] = useState({ status: 'idle', regions: [], settings: defaults, error: '' });
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const regionsRef = useRef([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.all([repo.loadRegions(), repo.loadSettings()])
      .then(([regions, settings]) => {
        if (!alive) return;
        regionsRef.current = regions;
        setState({ status: 'ready', regions, settings: { ...defaults, ...(settings ?? {}) }, error: '' });
      })
      .catch((err) => {
        if (alive) setState((s) => ({ ...s, status: 'error', error: `Não foi possível ler as sub-regiões salvas: ${err.message}` }));
      });
    return () => { alive = false; };
    // defaults é constante (config.js).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, enabled]);

  /** Aplica uma nova lista (imutável) e grava as sub-regiões alteradas. */
  const commit = useCallback(async (next) => {
    const previous = regionsRef.current;
    regionsRef.current = next;
    setState((s) => ({ ...s, regions: next }));
    try {
      await repo.saveRegions(next, previous);
      return true;
    } catch (err) {
      errorRef.current?.(`Não foi possível salvar as sub-regiões neste navegador: ${err.message}`);
      return false;
    }
  }, [repo]);

  const saveSettings = useCallback(async (settings) => {
    setState((s) => ({ ...s, settings }));
    try {
      await repo.saveSettings(settings);
    } catch (err) {
      errorRef.current?.(`Não foi possível salvar a configuração: ${err.message}`);
    }
  }, [repo]);

  const active = useMemo(() => state.regions.filter(isActive), [state.regions]);
  return {
    ...state, active, commit, saveSettings, kind: repo.kind, current: () => regionsRef.current,
  };
}
