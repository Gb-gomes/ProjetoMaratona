/**
 * Modelo de camadas do mapa (equivalente às tabelas layers, layer_groups,
 * layer_shares e user_layer_state da especificação).
 *
 * Tipos (kind):
 *   basemap         mapa base — só um ativo por vez
 *   ibge            limites oficiais, somente leitura (uma camada por nível)
 *   operational     camadas do fluxo de desligamento (pontos do CSV, prioritários, setores)
 *   custom_regions  sub-regiões da organização
 *   data            camadas enviadas pela organização (armazenadas no IndexedDB)
 *   external        WMS ou XYZ por URL
 *
 * Funções puras: estilo por atributo, legenda, visibilidade entre
 * organizações e ordem de empilhamento.
 */

export const LAYER_KINDS = {
  basemap: 'Mapa base', ibge: 'Limites IBGE', operational: 'Operação', custom_regions: 'Sub-regiões', data: 'Dados', external: 'Externa',
};

export const VISIBILITY = {
  private: 'Privada (só quem enviou)',
  organization: 'Organização',
  public: 'Pública',
  shared: 'Compartilhada com organizações específicas',
};

export const SYMBOLS = { circle: 'Círculo', square: 'Quadrado', triangle: 'Triângulo', diamond: 'Losango' };

/** Paleta categórica (12 cores distinguíveis nos dois temas). */
export const CATEGORY_PALETTE = [
  '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED', '#DB2777',
  '#0891B2', '#65A30D', '#EA580C', '#4F46E5', '#BE123C', '#0D9488',
];
/** Rampa sequencial (claro → escuro) para classes graduadas. */
export const SEQUENTIAL_RAMP = ['#FDE68A', '#FBBF24', '#F97316', '#DC2626', '#7F1D1D'];

export const DEFAULT_STYLE = {
  color: '#2563EB',
  weight: 2,
  radius: 4,
  symbol: 'circle',
  fillOpacity: 0.25,
  rule: null,
};

export function defaultStyleFor(geometryType, index = 0) {
  const color = CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
  return {
    ...DEFAULT_STYLE,
    color,
    weight: geometryType === 'line' ? 2 : 1.5,
    radius: geometryType === 'point' ? 4 : 0,
  };
}

const num = (v) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')));

/**
 * Estilo efetivo de uma feição.
 * rule:
 *   { type: 'categorized', field, classes: [{ value, color, label, weight? }], otherColor, otherLabel }
 *   { type: 'graduated',   field, classes: [{ min, max, color, label, weight? }], otherColor }
 */
export function compileStyle(style) {
  const s = { ...DEFAULT_STYLE, ...style };
  const base = {
    color: s.color, weight: s.weight, radius: s.radius, symbol: s.symbol, fillOpacity: s.fillOpacity,
  };
  const rule = s.rule;
  if (!rule?.field || !rule.classes?.length) return () => base;
  if (rule.type === 'categorized') {
    const byValue = new Map(rule.classes.map((c) => [String(c.value), { ...base, color: c.color, weight: c.weight ?? base.weight }]));
    const other = { ...base, color: rule.otherColor ?? '#94A3B8' };
    return (props) => byValue.get(String(props?.[rule.field] ?? '')) ?? other;
  }
  if (rule.type === 'graduated') {
    const classes = rule.classes.map((c) => ({ ...c, style: { ...base, color: c.color, weight: c.weight ?? base.weight } }));
    const other = { ...base, color: rule.otherColor ?? '#94A3B8' };
    return (props) => {
      const v = num(props?.[rule.field]);
      if (!Number.isFinite(v)) return other;
      const hit = classes.find((c, i) => v >= c.min && (v < c.max || (i === classes.length - 1 && v <= c.max)));
      return hit ? hit.style : other;
    };
  }
  return () => base;
}

/** Campos de atributo de que o desenho precisa (o restante só vai para o popup). */
export const styleFields = (style) => (style?.rule?.field ? [style.rule.field] : []);

/** Itens da legenda gerados do estilo. */
export function legendFor(style, geometryType) {
  const s = { ...DEFAULT_STYLE, ...style };
  const swatch = { geometryType, symbol: s.symbol, weight: s.weight, fillOpacity: s.fillOpacity };
  if (s.rule?.field && s.rule.classes?.length) {
    const items = s.rule.classes.map((c) => ({ ...swatch, color: c.color, weight: c.weight ?? s.weight, label: c.label ?? String(c.value) }));
    if (s.rule.otherColor !== null) items.push({ ...swatch, color: s.rule.otherColor ?? '#94A3B8', label: s.rule.otherLabel ?? 'Outros / sem valor' });
    return { title: s.rule.field, items };
  }
  return { title: null, items: [{ ...swatch, color: s.color, label: null }] };
}

const fmtNum = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Regra categorizada a partir dos valores mais frequentes de um campo. */
export function categorizedRule(field, valueCounts, { max = 12 } = {}) {
  const top = [...valueCounts].sort((a, b) => b.count - a.count).slice(0, max);
  return {
    type: 'categorized',
    field,
    classes: top.map((v, i) => ({ value: v.value, label: `${v.value === '' ? '(vazio)' : v.value} (${v.count.toLocaleString('pt-BR')})`, color: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] })),
    otherColor: valueCounts.length > max ? '#94A3B8' : null,
    otherLabel: 'Outros valores',
  };
}

/** Regra graduada por quantis (até 5 classes). */
export function graduatedRule(field, sortedValues, { classes = 5 } = {}) {
  const vals = sortedValues.filter(Number.isFinite);
  if (!vals.length) return null;
  const breaks = [vals[0]];
  for (let i = 1; i < classes; i += 1) breaks.push(vals[Math.floor((i / classes) * (vals.length - 1))]);
  breaks.push(vals[vals.length - 1]);
  const uniq = [...new Set(breaks)];
  if (uniq.length === 1) uniq.push(uniq[0]);
  const ramp = uniq.length - 1 <= SEQUENTIAL_RAMP.length ? SEQUENTIAL_RAMP.slice(SEQUENTIAL_RAMP.length - (uniq.length - 1)) : SEQUENTIAL_RAMP;
  return {
    type: 'graduated',
    field,
    classes: uniq.slice(0, -1).map((min, i) => ({
      min, max: uniq[i + 1], color: ramp[i] ?? ramp[ramp.length - 1], label: `${fmtNum(min)} – ${fmtNum(uniq[i + 1])}`,
    })),
    otherColor: '#94A3B8',
    otherLabel: 'Sem valor numérico',
  };
}

/* ------------------------------------------------------------------ */
/* Visibilidade e permissões                                           */
/* ------------------------------------------------------------------ */

export const ROLE_LABEL = { admin: 'Administrador', editor: 'Editor', viewer: 'Visualizador' };

const ROLE_ACTIONS = {
  admin: new Set(['view', 'edit-region', 'upload-layer', 'edit-layer', 'manage-org', 'share']),
  editor: new Set(['view', 'edit-region', 'upload-layer', 'edit-layer']),
  viewer: new Set(['view']),
};
export const can = (role, action) => !!ROLE_ACTIONS[role]?.has(action);

/**
 * O usuário pode ver a camada?
 * Camadas de sistema (orgId null) e públicas: todos. Organização: membros.
 * Privada: quem enviou. Compartilhada: membros e organizações listadas.
 */
export function canViewLayer(layer, { orgId, userId }) {
  if (!layer.orgId || layer.visibility === 'public') return true;
  if (layer.orgId === orgId) {
    if (layer.visibility === 'private') return !layer.createdBy || layer.createdBy === userId;
    return true;
  }
  return layer.visibility === 'shared' && (layer.shares ?? []).some((s) => s.orgId === orgId);
}

/** O usuário pode alterar a camada (estilo, dados, exclusão)? Camadas IBGE: nunca. */
export function canEditLayer(layer, { orgId, userId, role }) {
  if (!layer.orgId || layer.kind === 'ibge' || layer.kind === 'basemap') return false;
  if (layer.orgId === orgId) {
    if (!can(role, 'edit-layer')) return false;
    return layer.visibility !== 'private' || role === 'admin' || layer.createdBy === userId;
  }
  return (layer.shares ?? []).some((s) => s.orgId === orgId && s.permission === 'edit') && can(role, 'edit-layer');
}

export const visibleLayersFor = (layers, ctx) => layers.filter((l) => canViewLayer(l, ctx));

/* ------------------------------------------------------------------ */
/* Árvore e ordem de empilhamento                                      */
/* ------------------------------------------------------------------ */

/**
 * Monta a árvore de grupos/camadas. Dentro de cada grupo, irmãos (grupos e
 * camadas) seguem uma só ordem: maior `order` primeiro = mais acima no mapa.
 *
 * @param {object[]} groups  { id, name, parentGroupId, sortOrder }
 * @param {object[]} layers  { id, name, groupId, defaultOrder? }
 * @param {{ order?: Record<string, number> }} state  ordens escolhidas pelo usuário
 */
export function buildTree(groups, layers, state = {}) {
  const order = state.order ?? {};
  const nodeOrder = (id, fallback) => (order[id] ?? fallback ?? 0);
  const byParent = new Map();
  const push = (parent, node) => {
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  };
  const groupIds = new Set(groups.map((g) => g.id));
  groups.forEach((g) => push(groupIds.has(g.parentGroupId) ? g.parentGroupId : null, {
    type: 'group', id: g.id, group: g, order: nodeOrder(g.id, g.sortOrder),
  }));
  layers.forEach((l) => push(groupIds.has(l.groupId) ? l.groupId : null, {
    type: 'layer', id: l.id, layer: l, order: nodeOrder(l.id, l.defaultOrder),
  }));
  const build = (parent) => (byParent.get(parent) ?? [])
    .sort((a, b) => b.order - a.order || String(a.id).localeCompare(String(b.id)))
    .map((n) => (n.type === 'group' ? { ...n, children: build(n.id) } : n));
  return build(null);
}

/** Camadas na ordem de desenho, de cima para baixo. */
export function flattenLayers(tree) {
  const out = [];
  const walk = (nodes) => nodes.forEach((n) => {
    if (n.type === 'layer') out.push(n.layer);
    else walk(n.children);
  });
  walk(tree);
  return out;
}

/** z-index do pane de cada camada (de cima para baixo; acima dos tiles, abaixo dos marcadores). */
export function paneZIndexes(orderedLayers, { top = 590, bottom = 401 } = {}) {
  const out = {};
  orderedLayers.forEach((l, i) => { out[l.id] = Math.max(bottom, top - i); });
  return out;
}

/**
 * Move um nó entre os irmãos e devolve o novo mapa de ordens.
 * @param siblings nós irmãos na ordem atual (de cima para baixo)
 * @param fromId nó movido
 * @param toIndex posição de destino (0 = topo)
 */
export function reorderSiblings(orderMap, siblings, fromId, toIndex) {
  const ids = siblings.map((n) => n.id);
  const from = ids.indexOf(fromId);
  if (from < 0) return orderMap;
  ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(ids.length, toIndex)), 0, fromId);
  const next = { ...orderMap };
  ids.forEach((id, i) => { next[id] = ids.length - i; });
  return next;
}

/** Encontra os irmãos (e o pai) de um nó na árvore. */
export function siblingsOfNode(tree, id) {
  const search = (nodes) => {
    if (nodes.some((n) => n.id === id)) return nodes;
    for (const n of nodes) {
      if (n.type === 'group') {
        const found = search(n.children);
        if (found) return found;
      }
    }
    return null;
  };
  return search(tree) ?? [];
}
