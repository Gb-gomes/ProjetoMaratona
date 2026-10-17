import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  getAllLayers, getAllGroups, putLayer, putGroup, deleteGroup, deleteLayerData, deleteVersion,
} from './layerStore.js';
import { request } from './workerClient.js';

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `l-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const nowIso = () => new Date().toISOString();

/**
 * Camadas de dados e externas da organização + grupos (layers / layer_groups),
 * persistidos no IndexedDB deste navegador.
 */
export function useLayerRegistry({ orgId, enabled = true, onError }) {
  const [state, setState] = useState({ status: 'idle', layers: [], groups: [] });
  const groupsRef = useRef([]);
  groupsRef.current = state.groups;

  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ ...s, status: 'loading' }));
    Promise.all([getAllLayers(), getAllGroups()])
      .then(([layers, groups]) => {
        if (alive) {
          setState({
            status: 'ready', layers: layers.filter((l) => l.orgId === orgId), groups: groups.filter((g) => g.orgId === orgId),
          });
        }
      })
      .catch((err) => {
        if (alive) setState({ status: 'error', layers: [], groups: [], error: err.message });
        onError?.(`Não foi possível ler as camadas salvas: ${err.message}`);
      });
    return () => { alive = false; };
    // onError muda a cada render do App; a carga depende só da organização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, enabled]);

  const saveLayer = useCallback(async (layer) => {
    await putLayer(layer);
    setState((s) => ({ ...s, layers: [...s.layers.filter((l) => l.id !== layer.id), layer] }));
    return layer;
  }, []);

  const updateLayer = useCallback(async (id, patch, { by } = {}) => {
    let updated = null;
    setState((s) => {
      const cur = s.layers.find((l) => l.id === id);
      if (!cur) return s;
      updated = { ...cur, ...patch, updatedAt: nowIso(), updatedBy: by ?? cur.updatedBy };
      return { ...s, layers: s.layers.map((l) => (l.id === id ? updated : l)) };
    });
    if (updated) await putLayer(updated);
    return updated;
  }, []);

  /**
   * Exclusão lógica: os metadados ficam (rastreio); as feições são apagadas
   * para liberar espaço no navegador.
   */
  const removeLayer = useCallback(async (layer, { by }) => {
    const tomb = {
      ...layer, deletedAt: nowIso(), deletedBy: by, versions: layer.versions ?? [],
    };
    if (layer.kind === 'data') {
      await request('layer:close', { layerId: layer.id }).catch(() => {});
      await deleteLayerData(layer.id);
    }
    await putLayer(tomb);
    setState((s) => ({ ...s, layers: s.layers.map((l) => (l.id === layer.id ? tomb : l)) }));
  }, []);

  /** Remove uma versão antiga (nunca a atual). */
  const removeVersion = useCallback(async (layer, version, { by }) => {
    if (version === layer.currentVersion) throw new Error('A versão atual não pode ser removida.');
    await deleteVersion(layer.id, version);
    const versions = (layer.versions ?? []).map((v) => (v.version === version ? { ...v, removedAt: nowIso(), removedBy: by } : v));
    return updateLayer(layer.id, { versions }, { by });
  }, [updateLayer]);

  /** Garante a existência do caminho "Energisa > Rede Elétrica" e devolve o id do último grupo. */
  const ensureGroupPath = useCallback(async (path, { by }) => {
    const names = String(path ?? '').split('>').map((s) => s.trim()).filter(Boolean);
    if (!names.length) return null;
    let parentId = null;
    const groups = groupsRef.current;
    const created = [];
    for (const name of names) {
      const existing = [...groups, ...created].find((g) => (g.parentGroupId ?? null) === parentId && g.name.toLowerCase() === name.toLowerCase() && !g.deletedAt);
      if (existing) { parentId = existing.id; continue; }
      const group = {
        id: newId(), orgId, name, parentGroupId: parentId, sortOrder: Date.now() / 1e9, createdBy: by, createdAt: nowIso(),
      };
      // eslint-disable-next-line no-await-in-loop
      await putGroup(group);
      created.push(group);
      parentId = group.id;
    }
    if (created.length) setState((s) => ({ ...s, groups: [...s.groups, ...created] }));
    return parentId;
  }, [orgId]);

  const renameGroup = useCallback(async (id, name) => {
    let updated = null;
    setState((s) => {
      const g = s.groups.find((x) => x.id === id);
      if (!g) return s;
      updated = { ...g, name: name.trim() };
      return { ...s, groups: s.groups.map((x) => (x.id === id ? updated : x)) };
    });
    if (updated) await putGroup(updated);
  }, []);

  /** Remove um grupo vazio. */
  const removeGroup = useCallback(async (id) => {
    await deleteGroup(id);
    setState((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== id) }));
  }, []);

  return {
    ...state,
    activeLayers: state.layers.filter((l) => !l.deletedAt),
    saveLayer,
    updateLayer,
    removeLayer,
    removeVersion,
    ensureGroupPath,
    renameGroup,
    removeGroup,
    newId,
  };
}
