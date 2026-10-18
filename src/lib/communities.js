/**
 * Comunidades: camada de nomes abaixo do distrito do IBGE.
 *
 *   UF (IBGE) > Município (IBGE) > Distrito (IBGE) > Comunidade (arquivo de sub-regiões)
 *
 * Cada comunidade é uma sub-região (custom_regions) do conjunto
 * `regionSet: 'communities'`, ligada ao município IBGE. Os limites do IBGE
 * nunca são alterados; as comunidades são editáveis.
 *
 * Arquivo de origem: `microrregioes_<COD_IBGE_MUN>.geojson` (FeatureCollection,
 * WGS 84), com as propriedades ID, COMUNIDADE, COD_IBGE_MUN, CONFIANCA,
 * CENTRO_LAT/LON etc. A chave de uma comunidade é (COD_IBGE_MUN, ID): o mesmo
 * ID pode existir em outro município.
 *
 * Correspondência com a especificação (nomes em camelCase):
 *   codigo_externo → externalCode     nome_original → originalName
 *   nome_exibicao  → name             ibge_parent_code → ibgeParentCode
 *   label_point    → labelPoint       confianca → confidence ('boa' | 'baixa')
 *   metadata       → metadata (todas as propriedades do arquivo)
 *
 * Módulo puro (sem React nem armazenamento).
 */
import {
  unionGeometries, intersectGeometries, differenceGeometries, areaM2, geometryBboxAny, bboxIntersects, pointInGeometry, labelPoint as computeLabelPoint,
  distanceToBoundaryMeters, toMultiPolygon, haversineMeters,
} from './geoOps.js';
import {
  clipToParent, nameKey, metricsOf, isActive, DEFAULT_RULES, findOverlaps, fmtArea,
} from './customRegions.js';
import { repairGeometry } from './layers/geometryRepair.js';
import { parseCsv } from './csv.js';

export const COMMUNITY_SET = 'communities';
export const isCommunity = (r) => r?.regionSet === COMMUNITY_SET;
export const communityKey = (codMun, id) => `${codMun}|${id}`;
export const COMMUNITY_COLOR = '#0F766E';

const nowIso = () => new Date().toISOString();
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** "boa" ou "baixa" (o arquivo traz "baixa: poucos endereços no Censo"). */
export function parseConfidence(raw) {
  const t = clean(raw).toLowerCase();
  return t.startsWith('baixa') ? 'baixa' : 'boa';
}

/** Motivo da confiança baixa, para a dica de "localização aproximada". */
export function confidenceReason(community) {
  const raw = clean(community?.metadata?.CONFIANCA);
  const reason = raw.includes(':') ? raw.split(':').slice(1).join(':').trim() : '';
  return reason || 'contorno estimado com poucos endereços do Censo';
}

/** Código IBGE do município pelo nome do arquivo (microrregioes_3115300.geojson). */
export const codeFromFileName = (name) => /microrregioes_(\d{7})/i.exec(name ?? '')?.[1] ?? null;

/** Identificador no padrão do arquivo: "Nova Esperança" → "NOVA_ESPERANCA". */
export function slugId(name) {
  return clean(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'COMUNIDADE';
}

/* ------------------------------------------------------------------ */
/* Leitura e validação do arquivo                                      */
/* ------------------------------------------------------------------ */

/**
 * Valida o arquivo e devolve as feições normalizadas.
 * @param gj FeatureCollection
 * @param {{ fileName, municipalityExists: (cod) => boolean }} ctx
 * @returns {{ codMun, items: object[], invalid: {ref, reason}[], errors: string[], warnings: string[] }}
 */
export function parseCommunityFile(gj, { fileName = '', municipalityExists = () => true } = {}) {
  const errors = [];
  const warnings = [];
  const invalid = [];
  if (gj?.type !== 'FeatureCollection' || !Array.isArray(gj.features)) {
    return { codMun: null, items: [], invalid, errors: ['O arquivo não é uma FeatureCollection GeoJSON.'], warnings };
  }
  const crsName = gj.crs?.properties?.name;
  if (crsName && !/(CRS84|4326|4674)/.test(crsName)) errors.push(`Referencial não suportado (${crsName}). O arquivo deve estar em WGS 84 (EPSG:4326).`);

  const codes = new Set(gj.features.map((f) => clean(f?.properties?.COD_IBGE_MUN)).filter(Boolean));
  const fromName = codeFromFileName(fileName);
  if (codes.size > 1) errors.push(`O arquivo mistura municípios (${[...codes].join(', ')}). Use um arquivo por município.`);
  const codMun = [...codes][0] ?? fromName;
  if (!codMun) errors.push('O arquivo não informa o município (COD_IBGE_MUN).');
  else if (!/^\d{7}$/.test(codMun)) errors.push(`Código IBGE inválido: ${codMun}.`);
  else if (!municipalityExists(codMun)) errors.push(`O município ${codMun} não está na base do IBGE carregada no sistema.`);
  if (fromName && codMun && fromName !== codMun) warnings.push(`O nome do arquivo indica o município ${fromName}, mas as feições são de ${codMun}.`);
  if (errors.length) return { codMun, items: [], invalid, errors, warnings };

  const seen = new Set();
  const items = [];
  gj.features.forEach((f, i) => {
    const p = f?.properties ?? {};
    const id = clean(p.ID);
    const ref = id || `feição ${i + 1}`;
    if (!id) { invalid.push({ ref, reason: 'Sem ID' }); return; }
    if (seen.has(id)) { invalid.push({ ref, reason: 'ID repetido no arquivo' }); return; }
    seen.add(id);
    const name = clean(p.COMUNIDADE);
    if (name.length < 2) { invalid.push({ ref, reason: 'Sem nome (COMUNIDADE)' }); return; }
    const t = f?.geometry?.type;
    if (t !== 'Polygon' && t !== 'MultiPolygon') { invalid.push({ ref, reason: `Geometria "${t ?? 'ausente'}" (esperado Polygon/MultiPolygon)` }); return; }
    const repaired = repairGeometry(f.geometry);
    if (!repaired.geometry) { invalid.push({ ref, reason: repaired.reason }); return; }
    // União consigo mesma: resolve autointerseções restantes (equivalente ao ST_MakeValid).
    const geometry = unionGeometries([repaired.geometry]);
    if (!geometry) { invalid.push({ ref, reason: 'Geometria inválida que não pôde ser corrigida' }); return; }
    const lat = Number(p.CENTRO_LAT);
    const lng = Number(p.CENTRO_LON);
    items.push({
      id,
      name,
      confidence: parseConfidence(p.CONFIANCA),
      labelPoint: Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null,
      metadata: { ...p },
      geometry,
      fixed: repaired.fixed,
    });
  });
  return {
    codMun, items, invalid, errors, warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Sobreposições                                                       */
/* ------------------------------------------------------------------ */

/**
 * Resolve sobreposições entre comunidades vizinhas: a área sobreposta fica
 * com a de confiança "boa"; em empate, com a de menor área. Altera `items`.
 * @returns {{ a, b, areaM2, winner }[]}
 */
export function resolveOverlaps(items, { minM2 = 0.01 } = {}) {
  const resolved = [];
  const boxes = items.map((it) => geometryBboxAny(it.geometry));
  const areas = items.map((it) => areaM2(it.geometry));
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      if (!bboxIntersects(boxes[i], boxes[j])) continue;
      const inter = intersectGeometries(items[i].geometry, items[j].geometry);
      const a = inter ? areaM2(inter) : 0;
      if (a < minM2) continue;
      const ci = items[i].confidence === 'boa';
      const cj = items[j].confidence === 'boa';
      const iWins = ci !== cj ? ci : areas[i] <= areas[j];
      const [w, l] = iWins ? [i, j] : [j, i];
      const reduced = differenceGeometries(items[l].geometry, items[w].geometry);
      if (reduced) {
        items[l].geometry = reduced;
        boxes[l] = geometryBboxAny(reduced);
      }
      resolved.push({
        a: items[i].id, b: items[j].id, areaM2: +a.toFixed(2), winner: items[w].id,
      });
    }
  }
  return resolved;
}

/* ------------------------------------------------------------------ */
/* Importação idempotente                                              */
/* ------------------------------------------------------------------ */

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Planeja e aplica a importação de um arquivo de comunidades.
 *
 * - Cria as novas; atualiza as existentes pela chave (COD_IBGE_MUN, ID).
 * - Nome e contorno editados no sistema NÃO são sobrescritos, salvo com
 *   `overwriteEdits` (somente administrador).
 * - Comunidades excluídas no sistema continuam excluídas (salvo `overwriteEdits`).
 * - Comunidades que sumiram do arquivo são mantidas e listadas no relatório.
 *
 * @returns {{ regions, report }}
 */
export function importCommunities(regions, parsed, {
  orgId, municipalityGeometry, municipalityName = '', fileName = '', overwriteEdits = false, by, at = nowIso(), rules = DEFAULT_RULES,
}) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela importação.');
  if (parsed.errors?.length) throw new Error(parsed.errors[0]);
  const codMun = parsed.codMun;
  const tolerance = rules.toleranceMeters ?? DEFAULT_RULES.toleranceMeters;
  const report = {
    codMun,
    municipio: municipalityName,
    fileName,
    at,
    by: who,
    total: parsed.items.length + parsed.invalid.length,
    created: [],
    updated: [],
    unchanged: [],
    skipped: [],
    invalid: [...parsed.invalid],
    containment: [],
    overlaps: [],
    overlapWarnings: [],
    lowConfidence: [],
    preserved: [],
    missing: [],
    warnings: [...(parsed.warnings ?? [])],
  };

  // 1) Contenção no município (tolerância de 50 m): recorta e lista quem passou da tolerância.
  const items = [];
  parsed.items.forEach((it) => {
    const clip = clipToParent(it.geometry, municipalityGeometry, { toleranceMeters: tolerance });
    if (clip.empty) { report.invalid.push({ ref: it.id, reason: 'Fora do município IBGE' }); return; }
    if (clip.clipped && clip.beyondTolerance) {
      report.containment.push({
        id: it.id, name: it.name, maxOutsideMeters: Math.round(clip.maxOutsideMeters), clippedM2: Math.round(clip.clippedAreaKm2 * 1e6),
      });
    }
    items.push({ ...it, geometry: clip.geometry });
  });

  // 2) Sobreposições entre vizinhas do arquivo.
  report.overlaps = resolveOverlaps(items);

  const existing = new Map(regions.filter((r) => isCommunity(r) && r.orgId === orgId && r.ibgeParentCode === codMun)
    .map((r) => [r.externalCode, r]));
  const fileIds = new Set(items.map((it) => it.id));
  // Nomes já usados por comunidades do sistema que NÃO vêm deste arquivo (ex.: criadas por divisão).
  const otherNames = new Set([...existing.values()].filter((r) => isActive(r) && !fileIds.has(r.externalCode)).map((r) => nameKey(r.name)));
  const usedNames = new Set(otherNames);

  const byId = new Map(regions.map((r) => [r.id, r]));
  const out = [];
  items.forEach((it) => {
    if (it.confidence === 'baixa') report.lowConfidence.push({ id: it.id, name: it.name });
    const lp = it.labelPoint && pointInGeometry(it.labelPoint, it.geometry) ? it.labelPoint : computeLabelPoint(it.geometry);
    const cur = existing.get(it.id);

    if (!cur) {
      if (usedNames.has(nameKey(it.name))) { report.skipped.push({ id: it.id, reason: `Nome "${it.name}" já usado por outra comunidade do município` }); return; }
      usedNames.add(nameKey(it.name));
      const region = {
        id: newId(),
        orgId,
        regionSet: COMMUNITY_SET,
        name: it.name,
        originalName: it.name,
        externalCode: it.id,
        confidence: it.confidence,
        labelPoint: lp,
        metadata: it.metadata,
        description: null,
        color: COMMUNITY_COLOR,
        internalCode: it.id,
        tags: [],
        ibgeParentCode: codMun,
        parentCustomRegionId: null,
        geometry: it.geometry,
        ...metricsOf(it.geometry),
        creationMethod: 'imported',
        municipalityCodes: [],
        sectorCodes: [],
        sourceFile: fileName,
        importVersion: 1,
        nameEdited: false,
        geometryEdited: false,
        createdBy: who,
        createdAt: at,
        updatedBy: who,
        updatedAt: at,
        deletedAt: null,
        deletedBy: null,
        history: [{ action: 'importada', by: who, at, changes: { arquivo: fileName, versao: 1 } }],
      };
      out.push(region);
      report.created.push(it.id);
      return;
    }

    if (cur.deletedAt && !overwriteEdits) {
      report.skipped.push({ id: it.id, reason: 'Excluída no sistema (marque "sobrescrever edições" para recriar)' });
      return;
    }
    const keepName = cur.nameEdited && !overwriteEdits;
    const keepGeometry = cur.geometryEdited && !overwriteEdits;
    const nextName = keepName ? cur.name : it.name;
    if (!keepName && nextName !== cur.name && usedNames.has(nameKey(nextName))) {
      report.skipped.push({ id: it.id, reason: `Nome "${nextName}" já usado por outra comunidade do município` });
      return;
    }
    usedNames.add(nameKey(nextName));
    const nextGeometry = keepGeometry ? cur.geometry : it.geometry;
    const changes = {};
    if (nextName !== cur.name) changes.name = { from: cur.name, to: nextName };
    if (!sameJson(nextGeometry, cur.geometry)) changes.geometry = { previousGeometry: cur.geometry, fromAreaKm2: cur.areaKm2, toAreaKm2: metricsOf(nextGeometry).areaKm2 };
    if (!sameJson(it.metadata, cur.metadata)) changes.metadata = true;
    if (it.confidence !== cur.confidence) changes.confidence = { from: cur.confidence, to: it.confidence };
    if (it.name !== cur.originalName) changes.originalName = { from: cur.originalName, to: it.name };
    if (cur.deletedAt) changes.restaurada = true;
    const preserved = [keepName && 'nome', keepGeometry && 'contorno'].filter(Boolean);
    if (preserved.length) report.preserved.push({ id: it.id, name: cur.name, fields: preserved });
    if (!Object.keys(changes).length) {
      report.unchanged.push(it.id);
      return;
    }
    const version = (cur.importVersion ?? 1) + 1;
    const region = {
      ...cur,
      name: nextName,
      originalName: it.name,
      confidence: it.confidence,
      labelPoint: keepGeometry ? cur.labelPoint : lp,
      metadata: it.metadata,
      geometry: nextGeometry,
      ...metricsOf(nextGeometry),
      sourceFile: fileName,
      importVersion: version,
      nameEdited: keepName,
      geometryEdited: keepGeometry,
      deletedAt: null,
      deletedBy: null,
      updatedBy: who,
      updatedAt: at,
      history: [...cur.history, {
        action: 'reimportada', by: who, at, changes: { ...changes, arquivo: fileName, versao: version, preservados: preserved },
      }],
    };
    byId.set(cur.id, region);
    report.updated.push(it.id);
  });

  existing.forEach((r, id) => { if (isActive(r) && !fileIds.has(id)) report.missing.push({ id, name: r.name }); });

  const next = [...regions.map((r) => byId.get(r.id) ?? r), ...out];

  // Sobreposição com comunidades do sistema que não vêm do arquivo (ex.: criadas por divisão).
  const manual = next.filter((r) => isCommunity(r) && isActive(r) && r.ibgeParentCode === codMun && !fileIds.has(r.externalCode));
  if (manual.length) {
    next.filter((r) => isCommunity(r) && isActive(r) && r.ibgeParentCode === codMun && fileIds.has(r.externalCode)).forEach((r) => {
      findOverlaps(r.geometry, manual, rules).forEach((o) => report.overlapWarnings.push({ id: r.externalCode, with: o.name, areaM2: Math.round(o.areaKm2 * 1e6) }));
    });
  }
  return { regions: next, report };
}

/* ------------------------------------------------------------------ */
/* Correção de nomes em lote (planilha COD_IBGE_MUN;ID;nome_exibicao)  */
/* ------------------------------------------------------------------ */

export function parseNameCorrections(text) {
  const parsed = parseCsv(text);
  const h = parsed.headers.map((x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim());
  const iMun = h.findIndex((x) => x === 'cod_ibge_mun');
  const iId = h.findIndex((x) => x === 'id');
  const iName = h.findIndex((x) => x === 'nome_exibicao');
  if (iMun < 0 || iId < 0 || iName < 0) throw new Error('A planilha precisa das colunas COD_IBGE_MUN;ID;nome_exibicao.');
  return parsed.rows.map((r, k) => ({
    line: parsed.rowLines[k], codMun: clean(r[iMun]), id: clean(r[iId]), name: clean(r[iName]),
  }));
}

/** Aplica a planilha. Cada nome alterado fica marcado como edição manual. */
export function applyNameCorrections(regions, rows, { by, at = nowIso() } = {}) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela alteração.');
  const report = {
    changed: [], unchanged: [], notFound: [], rejected: [],
  };
  let next = regions;
  rows.forEach((row) => {
    const target = next.find((r) => isCommunity(r) && isActive(r) && r.ibgeParentCode === row.codMun && r.externalCode === row.id);
    if (!target) { report.notFound.push(row); return; }
    if (row.name.length < 2 || row.name.length > 80 || /[[\]]/.test(row.name)) { report.rejected.push({ ...row, reason: 'Nome inválido (2 a 80 caracteres, sem colchetes)' }); return; }
    if (row.name === target.name) { report.unchanged.push(row); return; }
    const clash = next.some((r) => r.id !== target.id && isCommunity(r) && isActive(r) && r.ibgeParentCode === row.codMun && nameKey(r.name) === nameKey(row.name));
    if (clash) { report.rejected.push({ ...row, reason: 'Nome já usado por outra comunidade do município' }); return; }
    const updated = {
      ...target,
      name: row.name,
      nameEdited: true,
      updatedBy: who,
      updatedAt: at,
      history: [...target.history, { action: 'editada', by: who, at, changes: { name: { from: target.name, to: row.name }, origem: 'planilha de nomes' } }],
    };
    next = next.map((r) => (r.id === target.id ? updated : r));
    report.changed.push({ ...row, from: target.name });
  });
  return { regions: next, report };
}

/** Planilha com os nomes atuais (modelo para correção em lote). */
export function namesSpreadsheet(regions, codMun = null) {
  const rows = regions.filter((r) => isCommunity(r) && isActive(r) && (!codMun || r.ibgeParentCode === codMun))
    .sort((a, b) => a.ibgeParentCode.localeCompare(b.ibgeParentCode) || a.externalCode.localeCompare(b.externalCode));
  const esc = (v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return `﻿COD_IBGE_MUN;ID;nome_exibicao\r\n${rows.map((r) => [r.ibgeParentCode, r.externalCode, r.name].map(esc).join(';')).join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ */
/* Divisão                                                             */
/* ------------------------------------------------------------------ */

/** ID livre no município para uma comunidade nova (a partir do nome). */
export function freeExternalCode(regions, codMun, name) {
  const taken = new Set(regions.filter((r) => isCommunity(r) && r.ibgeParentCode === codMun).map((r) => r.externalCode));
  const base = slugId(name);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_${Date.now()}`;
}

/**
 * Divide uma comunidade: `part` vira uma comunidade nova; a original fica com o restante.
 * A parte já deve estar validada (dentro da original e com nome livre).
 */
export function splitCommunity(regions, sourceId, { part, name, by, at = nowIso() }) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela alteração.');
  const src = regions.find((r) => r.id === sourceId && isActive(r) && isCommunity(r));
  if (!src) throw new Error('Comunidade não encontrada.');
  const piece = intersectGeometries(part, src.geometry);
  if (!piece || areaM2(piece) < 1) throw new Error('A parte desenhada não fica dentro da comunidade.');
  const rest = differenceGeometries(src.geometry, piece);
  if (!rest || areaM2(rest) < 1) throw new Error('A parte desenhada cobre a comunidade inteira; use Renomear.');
  const code = freeExternalCode(regions, src.ibgeParentCode, name);
  const created = {
    ...src,
    id: newId(),
    name: clean(name),
    originalName: null,
    externalCode: code,
    internalCode: code,
    labelPoint: computeLabelPoint(piece),
    metadata: { ...src.metadata, ID: code, COMUNIDADE: clean(name), DIVIDIDA_DE: src.externalCode },
    geometry: piece,
    ...metricsOf(piece),
    creationMethod: 'drawn',
    importVersion: null,
    nameEdited: true,
    geometryEdited: true,
    createdBy: who,
    createdAt: at,
    updatedBy: who,
    updatedAt: at,
    history: [{ action: 'criada', by: who, at, changes: { motivo: `dividida de "${src.name}" (${src.externalCode})` } }],
  };
  const reduced = {
    ...src,
    geometry: rest,
    ...metricsOf(rest),
    labelPoint: src.labelPoint && pointInGeometry(src.labelPoint, rest) ? src.labelPoint : computeLabelPoint(rest),
    geometryEdited: true,
    updatedBy: who,
    updatedAt: at,
    history: [...src.history, {
      action: 'dividida', by: who, at, changes: { geometry: { previousGeometry: src.geometry, fromAreaKm2: src.areaKm2, toAreaKm2: metricsOf(rest).areaKm2 }, motivo: `parte separada como "${created.name}" (${code})` },
    }],
  };
  return { regions: [...regions.map((r) => (r.id === sourceId ? reduced : r)), created], created, reduced };
}

/* ------------------------------------------------------------------ */
/* Ajuste de contorno com as vizinhas (o que uma ganha, a outra perde)  */
/* ------------------------------------------------------------------ */

const MIN_M2 = 1;
const km2 = (g) => (g ? areaM2(g) / 1e6 : 0);
const piecesOf = (g) => (toMultiPolygon(g)?.coordinates ?? []).map((c) => ({ type: 'Polygon', coordinates: c }));

/**
 * Comunidade vizinha que mais encosta num pedaço solto: a de maior trecho de
 * divisa em comum (soma dos lados do pedaço com as duas pontas a até
 * `touchMeters` do contorno dela; as divisas importadas são coincidentes).
 */
function bestNeighborFor(piece, candidates, touchMeters) {
  const pbox = geometryBboxAny(piece);
  const rings = piece.coordinates;
  let best = null;
  candidates.forEach((c) => {
    if (!bboxIntersects(pbox, c.bbox)) return;
    let len = 0;
    rings.forEach((ring) => {
      const near = ring.map((p) => distanceToBoundaryMeters(p, c.geometry) <= touchMeters);
      for (let i = 1; i < ring.length; i += 1) {
        if (near[i] && near[i - 1]) len += haversineMeters(ring[i - 1], ring[i]);
      }
    });
    if (len > 0 && (!best || len > best.len)) best = { id: c.id, len };
  });
  return best?.id ?? null;
}

/**
 * Plano do ajuste de contorno de uma comunidade, sem gravar nada:
 * - a área que ela GANHA sai das vizinhas que estavam ali;
 * - a área que ela PERDE vai para a vizinha que mais encosta em cada pedaço
 *   (sem vizinha encostada, o pedaço fica sem comunidade, como área urbana).
 * Só comunidades do mesmo município entram (a nova área já vem recortada no município).
 *
 * @returns {{ geometry, neighbors: Map<id, {region, geometry, takenKm2, givenKm2}>, taken, given, orphan, orphanKm2, emptied }}
 */
export function planCommunityAdjust(regions, id, newGeometry, { touchMeters = 3 } = {}) {
  const target = regions.find((r) => r.id === id && isActive(r) && isCommunity(r));
  if (!target) throw new Error('Comunidade não encontrada.');
  const siblings = regions
    .filter((r) => r.id !== id && isActive(r) && isCommunity(r) && r.ibgeParentCode === target.ibgeParentCode)
    .map((r) => ({ ...r, bbox: geometryBboxAny(r.geometry) }));
  const neighbors = new Map();
  const touch = (r) => {
    if (!neighbors.has(r.id)) neighbors.set(r.id, { region: r, geometry: r.geometry, takenKm2: 0, givenKm2: 0 });
    return neighbors.get(r.id);
  };

  // 1) O que ela ganha sai das vizinhas.
  const nbox = geometryBboxAny(newGeometry);
  siblings.forEach((r) => {
    if (!bboxIntersects(nbox, r.bbox)) return;
    const inter = intersectGeometries(r.geometry, newGeometry);
    const a = inter ? areaM2(inter) : 0;
    if (a < MIN_M2) return;
    const n = touch(r);
    n.geometry = differenceGeometries(r.geometry, newGeometry);
    n.takenKm2 = a / 1e6;
  });
  const emptied = [...neighbors.values()].filter((n) => !n.geometry || areaM2(n.geometry) < MIN_M2).map((n) => n.region);

  // 2) O que ela perde vai para a vizinha que encosta (já com o contorno do passo 1).
  const lost = differenceGeometries(target.geometry, newGeometry);
  const orphanPieces = [];
  piecesOf(lost).forEach((piece) => {
    if (areaM2(piece) < MIN_M2) return;
    const cands = siblings
      .filter((r) => !emptied.some((e) => e.id === r.id))
      .map((r) => (neighbors.has(r.id) ? { ...r, geometry: neighbors.get(r.id).geometry } : r));
    const to = bestNeighborFor(piece, cands, touchMeters);
    if (!to) { orphanPieces.push(piece); return; }
    const n = touch(siblings.find((r) => r.id === to));
    n.geometry = unionGeometries([n.geometry, piece]);
    n.givenKm2 += km2(piece);
  });
  const orphan = orphanPieces.length ? unionGeometries(orphanPieces) : null;
  const list = [...neighbors.values()];
  return {
    geometry: newGeometry,
    neighbors,
    taken: list.filter((n) => n.takenKm2 > 0).map((n) => ({ id: n.region.id, name: n.region.name, km2: n.takenKm2 })),
    given: list.filter((n) => n.givenKm2 > 0).map((n) => ({ id: n.region.id, name: n.region.name, km2: n.givenKm2 })),
    orphan,
    orphanKm2: km2(orphan),
    emptied,
  };
}

/** Frases do plano para mostrar ao operador antes de salvar (lascas < 100 m² são aplicadas, mas não listadas). */
export function describeAdjustPlan(plan, { minKm2 = 0.0001 } = {}) {
  const big = (list) => list.filter((t) => t.km2 >= minKm2);
  const out = [];
  if (big(plan.taken).length) out.push(`Vai tirar área de: ${big(plan.taken).map((t) => `${t.name} (−${fmtArea(t.km2)})`).join(', ')}.`);
  if (big(plan.given).length) out.push(`Vai passar área para: ${big(plan.given).map((t) => `${t.name} (+${fmtArea(t.km2)})`).join(', ')}.`);
  if (plan.orphanKm2 >= minKm2) out.push(`${fmtArea(plan.orphanKm2)} não encostam em nenhuma comunidade e ficam sem comunidade (como área urbana).`);
  return out;
}

/**
 * Grava o ajuste de contorno: a comunidade editada e as vizinhas afetadas,
 * cada uma com histórico (autor, data, geometria anterior e motivo).
 * @returns {{ regions, region, plan }}
 */
export function adjustCommunityBorder(regions, id, newGeometry, { by, at = nowIso() } = {}) {
  const who = clean(by);
  if (!who) throw new Error('Informe o responsável pela alteração.');
  const plan = planCommunityAdjust(regions, id, newGeometry);
  if (plan.emptied.length) {
    throw new Error(`A nova área cobriria toda a comunidade ${plan.emptied.map((r) => `"${r.name}"`).join(', ')}. Para juntar as duas, use Unir.`);
  }
  const target = regions.find((r) => r.id === id);
  const reshape = (r, geometry, motivo) => {
    const metrics = metricsOf(geometry);
    return {
      ...r,
      geometry,
      ...metrics,
      labelPoint: r.labelPoint && pointInGeometry(r.labelPoint, geometry) ? r.labelPoint : computeLabelPoint(geometry),
      geometryEdited: true,
      updatedBy: who,
      updatedAt: at,
      history: [...(r.history ?? []), {
        action: 'geometria editada', by: who, at, changes: { geometry: { previousGeometry: r.geometry, fromAreaKm2: r.areaKm2, toAreaKm2: metrics.areaKm2 }, motivo },
      }],
    };
  };
  const region = reshape(target, newGeometry, plan.neighbors.size ? `contorno ajustado; vizinhas: ${[...plan.neighbors.values()].map((n) => n.region.name).join(', ')}` : 'contorno ajustado');
  const updated = new Map([[id, region]]);
  plan.neighbors.forEach((n, nid) => {
    const parts = [n.takenKm2 > 0 && `cedeu ${n.takenKm2.toFixed(3)} km²`, n.givenKm2 > 0 && `recebeu ${n.givenKm2.toFixed(3)} km²`].filter(Boolean).join(' e ');
    updated.set(nid, reshape(regions.find((r) => r.id === nid), n.geometry, `${parts} no ajuste de "${target.name}"`));
  });
  return { regions: regions.map((r) => updated.get(r.id) ?? r), region, plan };
}
