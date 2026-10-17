/**
 * Sub-regiões personalizadas (`custom_regions`).
 *
 * Toda sub-região pertence a uma região-mãe do IBGE (UF, Intermediária,
 * Imediata ou município, pelo código oficial) e, opcionalmente, a outra
 * sub-região (aninhamento). Regras:
 *  - a geometria fica contida na região-mãe: o que ultrapassa a borda é
 *    recortado (interseção); se a parte recortada passa da tolerância
 *    (padrão 50 m), o usuário é avisado;
 *  - sobreposição entre irmãs é bloqueada, salvo se a organização permitir;
 *  - nome obrigatório e único na mesma região-mãe e organização;
 *  - área e perímetro recalculados a cada criação/edição;
 *  - exclusão lógica (deletedAt); o histórico nunca é apagado.
 *
 * Módulo puro (sem React nem armazenamento). Ver customRegionRepository.js.
 * O formato dos registros segue o modelo de dados da especificação, em camelCase.
 */
import {
  toMultiPolygon, intersectGeometries, differenceGeometries, unionGeometries, areaM2, areaKm2, perimeterKm,
  maxDistanceFromMeters, geometryBboxAny, bboxIntersects, isPolygonal,
} from './geoOps.js';

export const CREATION_METHODS = {
  drawn: 'Desenho no mapa',
  municipalities: 'Seleção de municípios',
  sectors: 'Seleção de setores censitários',
  imported: 'Arquivo importado',
};

export const DEFAULT_REGION_COLOR = '#0E7490';
export const REGION_COLORS = ['#0E7490', '#7C3AED', '#DB2777', '#059669', '#CA8A04', '#2563EB', '#DC2626', '#475569'];

export const DEFAULT_RULES = {
  toleranceMeters: 50,
  allowSiblingOverlap: false,
  // Sobreposições menores que isto são ruído numérico de bordas coincidentes.
  overlapMinM2: 50,
  // Recortes menores que isto não geram aviso (só imprecisão de desenho).
  clipNoticeMinM2: 1,
};

const nowIso = () => new Date().toISOString();
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
/** Chave de comparação de nomes: sem acento, sem caixa, espaços normalizados. */
export const nameKey = (v) => clean(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `cr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

export const isActive = (r) => !r.deletedAt;

/** Sub-regiões "irmãs": mesma organização, mesma região-mãe IBGE e mesma sub-região-mãe. */
export function siblingsOf(regions, { orgId, ibgeParentCode, parentCustomRegionId = null }, exceptId = null) {
  return regions.filter((r) => isActive(r)
    && r.id !== exceptId
    && r.orgId === orgId
    && r.ibgeParentCode === ibgeParentCode
    && (r.parentCustomRegionId ?? null) === (parentCustomRegionId ?? null));
}

export const childrenOf = (regions, id) => regions.filter((r) => isActive(r) && r.parentCustomRegionId === id);

/** Todos os descendentes ativos (aninhamento em qualquer profundidade). */
export function descendantsOf(regions, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    childrenOf(regions, cur).forEach((c) => { out.push(c); stack.push(c.id); });
  }
  return out;
}

/**
 * Prepara a geometria desenhada/selecionada/importada em relação à região-mãe.
 * @returns {{ geometry: object|null, inputAreaKm2, clippedAreaKm2, clipped: boolean,
 *   maxOutsideMeters: number, beyondTolerance: boolean, empty: boolean }}
 */
export function clipToParent(geometry, parentGeometry, { toleranceMeters = DEFAULT_RULES.toleranceMeters, clipNoticeMinM2 = DEFAULT_RULES.clipNoticeMinM2 } = {}) {
  const input = unionGeometries([geometry]) ?? toMultiPolygon(geometry);
  const base = {
    geometry: null, inputAreaKm2: 0, clippedAreaKm2: 0, clipped: false, maxOutsideMeters: 0, beyondTolerance: false, empty: true,
  };
  if (!input) return base;
  const inputArea = areaM2(input);
  const inside = intersectGeometries(input, parentGeometry);
  const outside = differenceGeometries(input, parentGeometry);
  const outsideArea = outside ? areaM2(outside) : 0;
  const maxOutsideMeters = outside && outsideArea >= clipNoticeMinM2 ? maxDistanceFromMeters(outside, parentGeometry) : 0;
  return {
    geometry: inside,
    inputAreaKm2: inputArea / 1e6,
    clippedAreaKm2: outsideArea / 1e6,
    clipped: outsideArea >= clipNoticeMinM2,
    maxOutsideMeters,
    beyondTolerance: maxOutsideMeters > toleranceMeters,
    empty: !inside || areaM2(inside) < 1,
  };
}

/** Sobreposições com as irmãs (somente acima do limiar de ruído). */
export function findOverlaps(geometry, siblings, { overlapMinM2 = DEFAULT_RULES.overlapMinM2 } = {}) {
  if (!isPolygonal(geometry)) return [];
  const bbox = geometryBboxAny(geometry);
  const out = [];
  siblings.forEach((s) => {
    if (!s.geometry || !bboxIntersects(bbox, geometryBboxAny(s.geometry))) return;
    const inter = intersectGeometries(geometry, s.geometry);
    const a = inter ? areaM2(inter) : 0;
    if (a >= overlapMinM2) out.push({ id: s.id, name: s.name, areaKm2: a / 1e6 });
  });
  return out;
}

/** Normaliza e valida os campos de texto. Retorna { value, errors }. */
export function normalizeFields(draft) {
  const errors = {};
  const name = clean(draft.name);
  if (name.length < 2) errors.name = 'Informe um nome com pelo menos 2 caracteres.';
  else if (name.length > 80) errors.name = 'O nome deve ter no máximo 80 caracteres.';
  const color = clean(draft.color) || DEFAULT_REGION_COLOR;
  if (!/^#[0-9a-f]{6}$/i.test(color)) errors.color = 'Cor inválida (use o formato #RRGGBB).';
  const internalCode = clean(draft.internalCode);
  if (internalCode.length > 40) errors.internalCode = 'O código interno deve ter no máximo 40 caracteres.';
  const description = String(draft.description ?? '').trim();
  if (description.length > 1000) errors.description = 'A descrição deve ter no máximo 1000 caracteres.';
  const rawTags = Array.isArray(draft.tags) ? draft.tags : String(draft.tags ?? '').split(',');
  const tags = [...new Set(rawTags.map(clean).filter(Boolean))].slice(0, 20);
  return {
    value: {
      name, color: color.toUpperCase(), internalCode: internalCode || null, description: description || null, tags,
    },
    errors,
  };
}

/**
 * Validação completa de um rascunho (usada em tempo real e ao salvar).
 *
 * @param draft { name, description, color, internalCode, tags, geometry, ibgeParentCode, parentCustomRegionId }
 * @param ctx { regions, orgId, parentGeometry, parentLabel, editingId, rules }
 * @returns {{ ok, errors: {name?, geometry?, ...}, warnings: string[], prepared, fields }}
 */
export function validateDraft(draft, {
  regions, orgId, parentGeometry, editingId = null, rules = DEFAULT_RULES,
}) {
  const { value: fields, errors } = normalizeFields(draft);
  const warnings = [];
  const r = { ...DEFAULT_RULES, ...rules };

  const scope = { orgId, ibgeParentCode: draft.ibgeParentCode, parentCustomRegionId: draft.parentCustomRegionId ?? null };
  const siblings = siblingsOf(regions, scope, editingId);
  if (!errors.name && siblings.some((s) => nameKey(s.name) === nameKey(fields.name))) {
    errors.name = `Já existe uma sub-região chamada "${fields.name}" nesta região-mãe.`;
  }

  let prepared = null;
  if (!draft.ibgeParentCode || !parentGeometry) {
    errors.geometry = 'Região-mãe não encontrada.';
  } else if (!isPolygonal(draft.geometry)) {
    errors.geometry = 'Desenhe, selecione ou importe a área da sub-região.';
  } else {
    prepared = clipToParent(draft.geometry, parentGeometry, r);
    if (prepared.empty) {
      errors.geometry = 'A área está fora da região-mãe.';
    } else {
      if (prepared.clipped && prepared.beyondTolerance) {
        warnings.push(`${fmtArea(prepared.clippedAreaKm2)} fora da região-mãe serão recortados (até ${Math.round(prepared.maxOutsideMeters).toLocaleString('pt-BR')} m além da borda).`);
      }
      if (!r.allowSiblingOverlap) {
        const overlaps = findOverlaps(prepared.geometry, siblings, r);
        if (overlaps.length) {
          errors.overlap = `Sobreposição com ${overlaps.map((o) => `"${o.name}" (${fmtArea(o.areaKm2)})`).join(', ')}. A organização não permite sobreposição entre sub-regiões irmãs.`;
        }
      }
      // Ao editar, as sub-regiões filhas precisam continuar contidas.
      if (editingId) {
        const outsideChildren = childrenOf(regions, editingId).filter((c) => clipToParent(c.geometry, prepared.geometry, r).beyondTolerance);
        if (outsideChildren.length) {
          errors.children = `A nova área deixaria fora parte de: ${outsideChildren.map((c) => `"${c.name}"`).join(', ')}. Ajuste essas sub-regiões antes.`;
        }
      }
    }
  }
  return {
    ok: Object.keys(errors).length === 0, errors, warnings, prepared, fields,
  };
}

/** "0,42 km²" ou "830 m²". */
export function fmtArea(km2) {
  if (km2 >= 0.1) return `${km2.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km²`;
  return `${Math.round(km2 * 1e6).toLocaleString('pt-BR')} m²`;
}

const metricsOf = (geometry) => ({
  areaKm2: +areaKm2(geometry).toFixed(4),
  perimeterKm: +perimeterKm(geometry).toFixed(3),
});

const historyEntry = (action, by, at, changes = {}) => ({
  action, by, at, changes,
});

function requireBy(by) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela alteração.');
  return who;
}

/**
 * Cria uma sub-região (já validada). Lança erro se a validação falhar.
 * @returns {{ regions, region, validation }}
 */
export function createRegion(regions, draft, ctx, { by, at = nowIso(), id = newId() } = {}) {
  const who = requireBy(by);
  const v = validateDraft(draft, ctx);
  if (!v.ok) throw new Error(Object.values(v.errors)[0]);
  const region = {
    id,
    orgId: ctx.orgId,
    ...v.fields,
    ibgeParentCode: draft.ibgeParentCode,
    parentCustomRegionId: draft.parentCustomRegionId ?? null,
    geometry: v.prepared.geometry,
    ...metricsOf(v.prepared.geometry),
    creationMethod: CREATION_METHODS[draft.creationMethod] ? draft.creationMethod : 'drawn',
    municipalityCodes: draft.creationMethod === 'municipalities' ? [...(draft.municipalityCodes ?? [])] : [],
    sectorCodes: draft.creationMethod === 'sectors' ? [...(draft.sectorCodes ?? [])] : [],
    sourceFile: draft.creationMethod === 'imported' ? (draft.sourceFile ?? null) : null,
    createdBy: who,
    createdAt: at,
    updatedBy: who,
    updatedAt: at,
    deletedAt: null,
    deletedBy: null,
    history: [historyEntry('criada', who, at, {
      name: v.fields.name,
      clippedAreaKm2: v.prepared.clipped ? +v.prepared.clippedAreaKm2.toFixed(6) : 0,
    })],
  };
  return { regions: [...regions, region], region, validation: v };
}

const TRACKED = ['name', 'description', 'color', 'internalCode', 'tags'];

/** Atualiza atributos e/ou geometria. Registra no histórico só o que mudou. */
export function updateRegion(regions, id, draft, ctx, { by, at = nowIso() } = {}) {
  const who = requireBy(by);
  const current = regions.find((r) => r.id === id && isActive(r));
  if (!current) throw new Error('Sub-região não encontrada.');
  const merged = {
    ...current,
    ...draft,
    geometry: draft.geometry ?? current.geometry,
    ibgeParentCode: current.ibgeParentCode,
    parentCustomRegionId: current.parentCustomRegionId,
  };
  const v = validateDraft(merged, { ...ctx, editingId: id });
  if (!v.ok) throw new Error(Object.values(v.errors)[0]);

  const changes = {};
  TRACKED.forEach((k) => {
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(v.fields[k] ?? null)) changes[k] = { from: current[k] ?? null, to: v.fields[k] ?? null };
  });
  const geometryChanged = !!draft.geometry && JSON.stringify(draft.geometry) !== JSON.stringify(current.geometry);
  const metrics = geometryChanged ? metricsOf(v.prepared.geometry) : null;
  if (geometryChanged) {
    changes.geometry = {
      fromAreaKm2: current.areaKm2,
      toAreaKm2: metrics.areaKm2,
      clippedAreaKm2: v.prepared.clipped ? +v.prepared.clippedAreaKm2.toFixed(6) : 0,
    };
  }
  if (!Object.keys(changes).length) return { regions, region: current, validation: v, changed: false };

  const region = {
    ...current,
    ...v.fields,
    ...(geometryChanged ? {
      geometry: v.prepared.geometry,
      ...metrics,
      // Uma geometria editada à mão deixa de ser a união exata das unidades selecionadas.
      ...(draft.creationMethod ? { creationMethod: draft.creationMethod } : {}),
    } : {}),
    updatedBy: who,
    updatedAt: at,
    history: [...current.history, historyEntry(geometryChanged ? 'geometria editada' : 'editada', who, at, changes)],
  };
  return {
    regions: regions.map((r) => (r.id === id ? region : r)), region, validation: v, changed: true,
  };
}

/** Exclusão lógica da sub-região e de todas as descendentes. */
export function softDeleteRegion(regions, id, { by, at = nowIso() } = {}) {
  const who = requireBy(by);
  const target = regions.find((r) => r.id === id && isActive(r));
  if (!target) throw new Error('Sub-região não encontrada.');
  const ids = new Set([id, ...descendantsOf(regions, id).map((r) => r.id)]);
  return {
    regions: regions.map((r) => (ids.has(r.id) ? {
      ...r,
      deletedAt: at,
      deletedBy: who,
      history: [...r.history, historyEntry('excluída', who, at, r.id === id ? {} : { motivo: `sub-região-mãe "${target.name}" excluída` })],
    } : r)),
    count: ids.size,
  };
}

/** Restaura uma sub-região excluída (se o nome continuar livre). */
export function restoreRegion(regions, id, ctx, { by, at = nowIso() } = {}) {
  const who = requireBy(by);
  const target = regions.find((r) => r.id === id && r.deletedAt);
  if (!target) throw new Error('Sub-região excluída não encontrada.');
  if (target.parentCustomRegionId && !regions.find((r) => r.id === target.parentCustomRegionId && isActive(r))) {
    throw new Error('Restaure primeiro a sub-região-mãe.');
  }
  const siblings = siblingsOf(regions, target, id);
  if (siblings.some((s) => nameKey(s.name) === nameKey(target.name))) {
    throw new Error(`Já existe outra sub-região ativa chamada "${target.name}".`);
  }
  if (!(ctx?.rules?.allowSiblingOverlap) && findOverlaps(target.geometry, siblings, ctx?.rules).length) {
    throw new Error('A sub-região se sobrepõe a uma irmã ativa.');
  }
  return regions.map((r) => (r.id === id ? {
    ...r, deletedAt: null, deletedBy: null, updatedAt: at, updatedBy: who, history: [...r.history, historyEntry('restaurada', who, at)],
  } : r));
}

/** Nome livre para uma cópia: "Nome (cópia)", "Nome (cópia 2)"… */
export function copyName(regions, region) {
  const siblings = siblingsOf(regions, region);
  const taken = new Set(siblings.map((s) => nameKey(s.name)));
  for (let n = 1; n < 100; n += 1) {
    const candidate = `${region.name} (cópia${n > 1 ? ` ${n}` : ''})`.slice(0, 80);
    if (!taken.has(nameKey(candidate))) return candidate;
  }
  return `${region.name} (cópia ${Date.now()})`.slice(0, 80);
}

/** Rascunho para duplicar (abre o editor; com sobreposição bloqueada, a área precisa ser ajustada). */
export function duplicateDraft(regions, region) {
  return {
    name: copyName(regions, region),
    description: region.description,
    color: region.color,
    internalCode: region.internalCode,
    tags: region.tags,
    geometry: region.geometry,
    ibgeParentCode: region.ibgeParentCode,
    parentCustomRegionId: region.parentCustomRegionId,
    creationMethod: 'drawn',
    duplicatedFrom: region.id,
  };
}

/** Exportação GeoJSON (sem histórico, com metadados para rastreio). */
export function regionsToGeoJSON(list, { ibgeName = (c) => c } = {}) {
  return {
    type: 'FeatureCollection',
    features: list.map((r) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: {
        id: r.id,
        nome: r.name,
        descricao: r.description,
        cor: r.color,
        codigo_interno: r.internalCode,
        tags: r.tags,
        regiao_mae_ibge: r.ibgeParentCode,
        regiao_mae_ibge_nome: ibgeName(r.ibgeParentCode),
        sub_regiao_mae: r.parentCustomRegionId,
        area_km2: r.areaKm2,
        perimetro_km: r.perimeterKm,
        metodo_criacao: r.creationMethod,
        municipios: r.municipalityCodes,
        setores: r.sectorCodes,
        criada_por: r.createdBy,
        criada_em: r.createdAt,
        atualizada_em: r.updatedAt,
      },
    })),
  };
}

/** Extrai e une todos os polígonos de um GeoJSON importado (Feature, FeatureCollection ou geometria). */
export function polygonFromGeoJSON(gj) {
  const geoms = [];
  const visit = (o) => {
    if (!o) return;
    if (o.type === 'FeatureCollection') o.features.forEach(visit);
    else if (o.type === 'Feature') visit(o.geometry);
    else if (o.type === 'GeometryCollection') o.geometries.forEach(visit);
    else if (isPolygonal(o)) geoms.push(o);
  };
  visit(gj);
  if (!geoms.length) throw new Error('O arquivo não contém polígonos.');
  const merged = unionGeometries(geoms);
  if (!merged) throw new Error('Não foi possível unir os polígonos do arquivo.');
  return { geometry: merged, polygons: geoms.length };
}
