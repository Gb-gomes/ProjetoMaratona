/**
 * Estado das camadas por usuário (user_layer_state): visível, opacidade,
 * ordem, filtro por sub-região, mapa base e grupos recolhidos.
 *
 * Salvo no localStorage deste navegador, por usuário (e-mail do Cloudflare
 * Access ou "local"). Só preferências de exibição: nenhuma coordenada.
 */

const PREFIX = 'conecta-rural:camadas:estado:v1:';

export const EMPTY_LAYER_STATE = {
  basemap: 'basemap:streets',
  layers: {}, // id → { visible?, opacity?, filterRegionId? }
  order: {}, // id (camada ou grupo) → ordem entre irmãos (maior = mais acima)
  collapsed: {}, // id do grupo → true
};

const storage = () => {
  try { return window.localStorage; } catch { return null; }
};

export const userKey = (identity) => (identity?.email ? identity.email.toLowerCase() : 'local');

export function loadLayerState(user, store = storage()) {
  try {
    const raw = store?.getItem(PREFIX + user);
    if (!raw) return EMPTY_LAYER_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_LAYER_STATE,
      ...parsed,
      layers: parsed.layers ?? {},
      order: parsed.order ?? {},
      collapsed: parsed.collapsed ?? {},
    };
  } catch {
    return EMPTY_LAYER_STATE;
  }
}

export function saveLayerState(user, state, store = storage()) {
  try {
    store?.setItem(PREFIX + user, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Valor efetivo de uma camada: estado do usuário sobre o padrão da camada. */
export function effectiveLayer(state, layer) {
  const s = state.layers[layer.id] ?? {};
  return {
    visible: s.visible ?? layer.defaultVisible ?? false,
    opacity: s.opacity ?? layer.defaultOpacity ?? 1,
    filterRegionId: s.filterRegionId ?? null,
  };
}

export function patchLayer(state, id, patch) {
  return { ...state, layers: { ...state.layers, [id]: { ...state.layers[id], ...patch } } };
}
