/**
 * Serviço único "coordenada → nome do lugar", usado em todo o sistema
 * (mapa, busca, cadastros, auditoria, carta para as rádios).
 *
 * Regra:
 *  1. Município: ponto no polígono do município IBGE.
 *  2. Distrito: ponto no polígono do distrito IBGE (se a malha estiver carregada).
 *  3. Comunidade (se o município tem arquivo de comunidades):
 *     - uma comunidade contém o ponto → ela;
 *     - mais de uma → confiança "boa" primeiro; em empate, a de menor área;
 *     - nenhuma, mas há comunidade a até NEAR_METERS (100 m) → a mais próxima
 *       (o arquivo tem pequenas lacunas entre polígonos);
 *     - nenhuma próxima → área não coberta (área urbana da sede ou vila sede de
 *       distrito): "Área urbana de <município>" no distrito-sede, ou
 *       "Sede do distrito de <nome>" nos demais. Nunca a comunidade mais
 *       distante, mesmo a poucos km.
 *  4. Município sem arquivo de comunidades: só nomes do IBGE.
 *
 * Retorno (campos da especificação):
 *   { municipio: {cod, nome, uf}, distrito: {cod, nome, sede} | null,
 *     comunidade: {id, regionId, nome, confianca, aproximada} | null,
 *     origem_nome: 'comunidade' | 'comunidade_proxima' | 'ibge',
 *     local: nome curto do lugar | null, rotulo }
 */
import {
  preparePointInPolygon, geometryBboxAny, distanceToBoundaryMeters, areaM2,
} from './geoOps.js';
import { isCommunity } from './communities.js';
import { isActive } from './customRegions.js';

export const NEAR_METERS = 100;
const DEG_LAT = 110540;

function prepared(list, fields) {
  return list.map((x) => ({
    ...fields(x), bbox: geometryBboxAny(x.geometry), test: preparePointInPolygon(x.geometry), geometry: x.geometry,
  }));
}

const inBox = (b, [x, y], pad = 0) => x >= b[0] - pad && x <= b[2] + pad && y >= b[1] - pad && y <= b[3] + pad;

/**
 * @param {{ hierarchy, communities: Region[] }} sources
 *   hierarchy: parseHierarchy() (inclui byLevel.distrito quando carregado)
 */
export function createPlaceLocator({ hierarchy, communities = [] }) {
  const uf = hierarchy?.ufSigla ?? '';
  const municipalities = prepared(hierarchy?.byLevel?.municipio ?? [], (m) => ({ cod: m.code, nome: m.name }));
  const districts = prepared(hierarchy?.byLevel?.distrito ?? [], (d) => ({
    cod: d.code, nome: d.name, sede: !!d.sede, mun: d.parentCode,
  }));
  const byMun = new Map();
  const byRegion = new Map();
  communities.filter((c) => isCommunity(c) && isActive(c)).forEach((c) => {
    if (!byMun.has(c.ibgeParentCode)) byMun.set(c.ibgeParentCode, []);
    const entry = {
      id: c.externalCode,
      mun: c.ibgeParentCode,
      regionId: c.id,
      nome: c.name,
      confianca: c.confidence ?? 'boa',
      area: c.areaKm2 ?? areaM2(c.geometry) / 1e6,
      bbox: geometryBboxAny(c.geometry),
      test: preparePointInPolygon(c.geometry),
      geometry: c.geometry,
    };
    byMun.get(c.ibgeParentCode).push(entry);
    byRegion.set(c.id, entry);
  });
  const districtsLoaded = new Set(districts.map((d) => d.mun));

  const better = (a, b) => {
    if (a.confianca !== b.confianca) return a.confianca === 'boa' ? a : b;
    return a.area <= b.area ? a : b;
  };

  function locate(lngLat) {
    const p = [Number(lngLat[0]), Number(lngLat[1])];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const mun = municipalities.find((m) => inBox(m.bbox, p) && m.test(p));
    if (!mun) {
      return {
        municipio: null, distrito: null, comunidade: null, origem_nome: 'ibge', local: null, rotulo: 'Fora dos municípios carregados',
      };
    }
    const dist = districts.find((d) => d.mun === mun.cod && inBox(d.bbox, p) && d.test(p)) ?? null;
    const municipio = { cod: mun.cod, nome: mun.nome, uf };
    const distrito = dist ? { cod: dist.cod, nome: dist.nome, sede: dist.sede } : null;
    const munLabel = `${mun.nome}${uf ? `/${uf}` : ''}`;
    const distLabel = distrito ? (distrito.sede ? `Distrito-sede (${distrito.nome})` : `Distrito de ${distrito.nome}`) : null;

    const list = byMun.get(mun.cod);
    let comunidade = null;
    let origem = 'ibge';
    if (list?.length) {
      const hits = list.filter((c) => inBox(c.bbox, p) && c.test(p));
      let hit = hits.length ? hits.reduce(better) : null;
      if (hit) origem = 'comunidade';
      else {
        // Lacunas pequenas entre polígonos: a comunidade mais próxima, até NEAR_METERS.
        const pad = NEAR_METERS / DEG_LAT / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
        let best = null;
        let bestD = Infinity;
        list.forEach((c) => {
          if (!inBox(c.bbox, p, pad)) return;
          const d = distanceToBoundaryMeters(p, c.geometry);
          if (d <= NEAR_METERS && (d < bestD || (d === bestD && better(c, best) === c))) { best = c; bestD = d; }
        });
        if (best) { hit = best; origem = 'comunidade_proxima'; }
      }
      if (hit) {
        comunidade = {
          id: hit.id, regionId: hit.regionId, nome: hit.nome, confianca: hit.confianca, aproximada: hit.confianca === 'baixa',
        };
      }
    }

    let local = null;
    let rotulo;
    if (comunidade) {
      local = comunidade.nome;
      rotulo = [`Comunidade ${comunidade.nome}`, distLabel, munLabel].filter(Boolean).join(' · ');
    } else if (list?.length && distrito) {
      // Área sem comunidade num município com arquivo: área urbana / vila sede de distrito.
      if (distrito.sede) {
        local = `Área urbana de ${mun.nome}`;
        rotulo = local;
      } else {
        local = `Sede do distrito de ${distrito.nome}`;
        rotulo = `${local} · ${munLabel}`;
      }
    } else {
      rotulo = [distLabel, munLabel].filter(Boolean).join(' · ');
    }
    return {
      municipio, distrito, comunidade, origem_nome: origem, local, rotulo,
    };
  }

  return {
    locate,
    hasCommunities: (codMun) => !!byMun.get(codMun)?.length,
    hasDistricts: (codMun) => districtsLoaded.has(codMun),
    communityMunicipalities: () => [...byMun.keys()],
    /** Comunidade ativa pelo id da sub-região (nome, município, contorno, caixa). */
    community: (regionId) => {
      const c = byRegion.get(regionId);
      return c ? {
        id: c.id, regionId: c.regionId, mun: c.mun, nome: c.nome, confianca: c.confianca, geometry: c.geometry, bbox: c.bbox,
      } : null;
    },
  };
}

export const ORIGIN_TEXT = {
  comunidade: 'dentro da comunidade',
  comunidade_proxima: 'comunidade mais próxima (até 100 m)',
  ibge: 'nome do IBGE',
};

/** Retrato da localização para gravar num cadastro (comunidade no momento do cadastro). */
export function placeSnapshot(place, at = new Date().toISOString()) {
  if (!place?.municipio) return null;
  return {
    municipioCod: place.municipio.cod,
    municipio: place.municipio.nome,
    distritoCod: place.distrito?.cod ?? null,
    distrito: place.distrito?.nome ?? null,
    comunidadeId: place.comunidade?.id ?? null,
    comunidadeRegionId: place.comunidade?.regionId ?? null,
    comunidade: place.comunidade?.nome ?? null,
    confianca: place.comunidade?.confianca ?? null,
    origem: place.origem_nome,
    rotulo: place.rotulo,
    at,
  };
}

/** A localização gravada mudou de comunidade/distrito/município? */
export const placeChanged = (a, b) => (a?.comunidadeId ?? null) !== (b?.comunidadeId ?? null)
  || (a?.distritoCod ?? null) !== (b?.distritoCod ?? null)
  || (a?.municipioCod ?? null) !== (b?.municipioCod ?? null)
  || (a?.comunidade ?? null) !== (b?.comunidade ?? null);

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Busca de lugares por nome, sem diferenciar acentos e maiúsculas (como o unaccent):
 * comunidades (nome de exibição, nome original e ID), distritos e municípios.
 * @returns {{ kind: 'comunidade'|'distrito'|'municipio', id, nome, detalhe, bbox, confianca? }[]}
 */
export function searchPlaces(query, { hierarchy, communities = [], limit = 12 }) {
  const q = fold(query);
  if (q.length < 2) return [];
  const munName = (cod) => hierarchy?.byCode.get(cod)?.name ?? cod;
  const score = (names) => {
    let best = Infinity;
    names.forEach((n) => {
      const f = fold(n);
      if (!f) return;
      if (f === q) best = Math.min(best, 0);
      else if (f.startsWith(q)) best = Math.min(best, 1);
      else if (f.split(' ').some((w) => w.startsWith(q))) best = Math.min(best, 2);
      else if (f.includes(q)) best = Math.min(best, 3);
    });
    return best;
  };
  const out = [];
  communities.filter((c) => isCommunity(c) && isActive(c)).forEach((c) => {
    const s = score([c.name, c.originalName, (c.externalCode ?? '').replace(/_/g, ' ')]);
    if (s < Infinity) {
      out.push({
        kind: 'comunidade', id: c.id, nome: c.name, detalhe: `Comunidade · ${munName(c.ibgeParentCode)}`, bbox: geometryBboxAny(c.geometry), confianca: c.confidence, s,
      });
    }
  });
  ['distrito', 'municipio'].forEach((level) => (hierarchy?.byLevel?.[level] ?? []).forEach((r) => {
    const s = score([r.name]);
    if (s < Infinity) {
      out.push({
        kind: level, id: r.code, nome: r.name, detalhe: level === 'distrito' ? `Distrito · ${munName(r.parentCode)}` : 'Município', bbox: r.bbox, s: s + 0.5,
      });
    }
  }));
  return out.sort((a, b) => a.s - b.s || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, limit).map(({ s, ...r }) => r);
}
