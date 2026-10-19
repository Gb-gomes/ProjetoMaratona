/**
 * Orquestra o sistema de camadas e as sub-regiões no modo "Teste com dados reais":
 * catálogo de camadas (sistema, IBGE, sub-regiões, dados, externas), estado por
 * usuário, editor de sub-região, filtros, resumos e diálogos.
 *
 * Devolve o que o MapView precisa (filhos do mapa, painel, sobreposições) e os
 * diálogos, para manter o App.jsx enxuto.
 */
import {
  Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Users, Shapes, Search } from 'lucide-react';
import {
  BASEMAPS, IBGE_HIERARCHY, ORGANIZATION, ROLES, CUSTOM_REGION_RULES, PILOT_CONFIG, COMMUNITIES, FEATURES,
} from '../config.js';
import { loadHierarchy, LEVEL_LABEL } from './ibgeHierarchy.js';
import { useCustomRegions } from './useCustomRegions.js';
import { useLayerRegistry } from './layers/useLayerRegistry.js';
import {
  loadLayerState, saveLayerState, userKey, effectiveLayer, patchLayer,
} from './layers/userLayerState.js';
import {
  buildTree, flattenLayers, paneZIndexes, reorderSiblings, legendFor, canViewLayer, canEditLayer, can, defaultStyleFor,
} from './layers/layerModel.js';
import { request } from './layers/workerClient.js';
import {
  validateDraft, createRegion, updateRegion, softDeleteRegion, restoreRegion, duplicateDraft, regionsToGeoJSON,
  polygonFromGeoJSON, descendantsOf, REGION_COLORS, isActive, mergeRegions,
} from './customRegions.js';
import {
  isCommunity, COMMUNITY_SET, COMMUNITY_COLOR, parseCommunityFile, importCommunities, parseNameCorrections, applyNameCorrections,
  namesSpreadsheet, splitCommunity, archiveLegacyMicroregions, planCommunityAdjust, adjustCommunityBorder, describeAdjustPlan,
} from './communities.js';
import { createPlaceLocator } from './placeNames.js';
import {
  unionGeometries, areaKm2, perimeterKm, labelPoint, pointInGeometry, preparePointInPolygon, geometryBboxAny,
} from './geoOps.js';
import { bboxToBounds, padBounds } from './geo.js';
import PaneManager, { paneName } from '../components/map/PaneManager.jsx';
import {
  IbgeLevelLayer, CustomRegionsLayer, DataLayer, ExternalLayer, MapClickRouter, CameraRequest, NavigationBounds,
} from '../components/map/OrgLayers.jsx';
import LayerPanel from '../components/layers/LayerPanel.jsx';
import SubRegionEditorPanel from '../components/subregions/SubRegionEditorPanel.jsx';
import SubRegionsPanel from '../components/subregions/SubRegionsPanel.jsx';
import MapPickCard from '../components/subregions/MapPickCard.jsx';
import PlaceSearch from '../components/subregions/PlaceSearch.jsx';
import CoordinatePin from '../components/map/CoordinatePin.jsx';
import { CommunitiesLayer, CommunityHover, CommunityLabels } from '../components/map/CommunityLayers.jsx';
import { assignCommunityColors, COMMUNITY_PALETTE, URBAN_FILL } from './communityColors.js';
import CommunityLayerTools, { CommunityMatches, matchCommunities } from '../components/layers/CommunityLayerTools.jsx';
import { TerritoryLegend, PriorityLegend } from '../components/MapLegend.jsx';

// Carregados sob demanda: editor (Leaflet-Geoman) e diálogos de importação/configuração
// (leitores de Shapefile/KML, proj4) não pesam para quem só usa a demonstração.
const SubRegionEditorMap = lazy(() => import('../components/map/SubRegionEditorMap.jsx'));
const LayerUploadDialog = lazy(() => import('../components/layers/LayerUploadDialog.jsx'));
const LayerSettingsDialog = lazy(() => import('../components/layers/LayerSettingsDialog.jsx'));
const CommunitiesDialog = lazy(() => import('../components/subregions/CommunitiesDialog.jsx'));

const SYSTEM_GROUPS = [
  { id: 'grp:operacao', name: 'Operação do desligamento', sortOrder: 300 },
  { id: 'grp:comunidades', name: 'Comunidades', sortOrder: 275 },
  ...(FEATURES.orgSubregions ? [{ id: 'grp:subregioes', name: 'Sub-regiões', sortOrder: 250 }] : []),
  { id: 'grp:ibge', name: 'Limites IBGE (somente leitura)', sortOrder: 100 },
];
const OP_LAYER_KEYS = { 'op:points': 'points', 'op:priority': 'priority', 'op:territories': 'territories' };
const EMPTY_FORM = {
  name: '', description: '', color: REGION_COLORS[0], internalCode: '', tags: '',
};
const RULES = { ...CUSTOM_REGION_RULES };

function download(name, data, type = 'application/geo+json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function useMapWorkspace({
  enabled, identity, operator, operatorLocked, authorFor, rememberOperator, notify,
  opLayers, setOpLayers, pointFilterExtra, result, priorityRecords, sectorLayer, isMobile, onShowMap,
  onAddPoint = null, onRegisterPriority = null,
}) {
  const user = userKey(identity);
  const role = (identity?.email && ROLES.byEmail[identity.email]) || ROLES.default;
  const ctxUser = useMemo(() => ({ orgId: ORGANIZATION.id, userId: identity?.email ?? 'local', role }), [identity, role]);
  const canEditRegions = can(role, 'edit-region');
  const canUpload = can(role, 'upload-layer');
  const canManage = can(role, 'manage-org');

  /* ---------------- Dados ---------------- */
  const [hier, setHier] = useState({ status: 'idle', data: null, error: '' });
  useEffect(() => {
    if (!enabled || hier.status !== 'idle') return;
    setHier((h) => ({ ...h, status: 'loading' }));
    loadHierarchy(IBGE_HIERARCHY.url, { districtsUrl: IBGE_HIERARCHY.districtsUrl })
      .then((data) => setHier({ status: 'ready', data, error: '' }))
      .catch((err) => { setHier({ status: 'error', data: null, error: err.message }); notify('warning', err.message); });
  }, [enabled, hier.status, notify]);
  const hierarchy = hier.data;

  const regionsHook = useCustomRegions({
    orgId: ORGANIZATION.id, defaults: { allowSiblingOverlap: RULES.allowSiblingOverlap }, enabled, onError: (m) => notify('error', m),
  });
  const rules = useMemo(() => ({ ...RULES, allowSiblingOverlap: !!regionsHook.settings?.allowSiblingOverlap }), [regionsHook.settings]);
  const regions = regionsHook.regions;
  // Sub-regiões da organização e comunidades são conjuntos separados (lib/communities.js).
  // Com FEATURES.orgSubregions desligada, as sub-regiões da organização somem de toda a interface (os dados ficam).
  const activeRegions = useMemo(() => (FEATURES.orgSubregions ? regionsHook.active.filter((r) => !isCommunity(r)) : []), [regionsHook.active]);
  const activeCommunities = useMemo(() => regionsHook.active.filter(isCommunity), [regionsHook.active]);
  const communitiesByMun = useMemo(() => {
    const m = new Map();
    activeCommunities.forEach((c) => { if (!m.has(c.ibgeParentCode)) m.set(c.ibgeParentCode, []); m.get(c.ibgeParentCode).push(c); });
    return m;
  }, [activeCommunities]);
  // Cores pastel do mapa: comunidades vizinhas (inclusive de municípios vizinhos) com cores diferentes.
  const communityColors = useMemo(() => assignCommunityColors(activeCommunities), [activeCommunities]);
  // Serviço único coordenada → nome (lib/placeNames.js), usado em todo o sistema.
  const locator = useMemo(() => (hierarchy ? createPlaceLocator({ hierarchy, communities: activeCommunities }) : null), [hierarchy, activeCommunities]);
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    if (!enabled || manifest) return;
    fetch(COMMUNITIES.manifestUrl, { cache: 'no-cache' })
      .then((r) => (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') ? r.json() : null))
      .then((j) => setManifest(j ? { ...j, baseUrl: COMMUNITIES.baseUrl } : { arquivos: [], baseUrl: COMMUNITIES.baseUrl }))
      .catch(() => setManifest({ arquivos: [], baseUrl: COMMUNITIES.baseUrl }));
  }, [enabled, manifest]);
  const [communitiesOpen, setCommunitiesOpen] = useState(false);
  const [lastCommunityReport, setLastCommunityReport] = useState(null);
  const [hoveredCommunity, setHoveredCommunity] = useState(null);

  // Uma vez por navegador: as microrregiões da versão de teste (gravadas como sub-regiões)
  // vão para a lixeira, porque hoje são comunidades e apareciam duplicadas. Dá para restaurar.
  const legacyCleanupRan = useRef(false);
  useEffect(() => {
    if (!enabled || legacyCleanupRan.current || regionsHook.status !== 'ready') return;
    legacyCleanupRan.current = true;
    if (regionsHook.settings?.legacyMicroregionsArchived) return;
    const { regions: next, count } = archiveLegacyMicroregions(regionsHook.current());
    if (count) {
      regionsHook.commit(next);
      notify('info', `${count} sub-região(ões) antigas da versão de teste (microrregiões de Cataguases e Leopoldina) foram para a lixeira: hoje elas são comunidades. Dá para restaurar em Sub-regiões.`);
    }
    regionsHook.saveSettings({ ...regionsHook.settings, legacyMicroregionsArchived: true });
  }, [enabled, regionsHook, notify]);

  // Primeiro uso do modo real: sem microrregiões no navegador, as do projeto (index.json)
  // são importadas automaticamente, com relatório e histórico (responsável: o sistema).
  // Cada município só uma vez (settings.communitiesAutoImported): o que o operador excluir
  // depois não volta sozinho. A importação manual continua disponível.
  const autoImportRan = useRef(false);
  useEffect(() => {
    if (!enabled || autoImportRan.current || regionsHook.status !== 'ready' || !hierarchy || !manifest) return;
    autoImportRan.current = true;
    const stamped = regionsHook.settings?.communitiesAutoImported ?? {};
    const present = new Set(regionsHook.current().filter(isCommunity).map((c) => c.ibgeParentCode));
    const pending = (manifest.arquivos ?? []).filter((f) => !present.has(f.codIbgeMun) && !stamped[f.codIbgeMun]
      && hierarchy.byCode.get(f.codIbgeMun)?.level === 'municipio');
    if (!pending.length) return;
    (async () => {
      // A área da Energisa tem dezenas de municípios (~30 s de processamento): avisa e cede a vez à tela entre eles.
      if (pending.length > 3) notify('info', `Carregando as microrregiões de ${pending.length} municípios. O mapa continua utilizável.`);
      const files = await Promise.all(pending.map(async (f) => {
        try {
          const res = await fetch(`${manifest.baseUrl}${f.arquivo}`, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`arquivo ${f.arquivo} não encontrado`);
          return { f, gj: await res.json() };
        } catch (err) {
          notify('warning', `Microrregiões de ${f.municipio ?? f.codIbgeMun} não carregadas: ${err.message}.`);
          return null;
        }
      }));
      const by = 'sistema (arquivos do projeto)';
      const at = new Date().toISOString();
      let next = regionsHook.current();
      const done = [];
      let lastReport = null;
      for (const { f, gj } of files.filter(Boolean)) {
        await new Promise((r) => { setTimeout(r, 0); });
        const parsed = parseCommunityFile(gj, { fileName: f.arquivo, municipalityExists: (cod) => hierarchy.byCode.get(cod)?.level === 'municipio' });
        if (parsed.errors.length) { notify('warning', `${f.arquivo}: ${parsed.errors.join(' ')}`); continue; }
        // Outra aba ou importação manual já trouxe este município: não reimporta.
        if (next.some((r) => isCommunity(r) && r.ibgeParentCode === parsed.codMun)) continue;
        const mun = hierarchy.byCode.get(parsed.codMun);
        const out = importCommunities(next, parsed, {
          orgId: ORGANIZATION.id, municipalityGeometry: mun.geometry, municipalityName: mun.name, fileName: f.arquivo, overwriteEdits: false, by, rules,
        });
        next = out.regions;
        lastReport = out.report;
        done.push({ cod: parsed.codMun, label: `${mun.name} (${out.report.created.length})`, created: out.report.created.length });
      }
      if (!done.length) return;
      if (!(await regionsHook.commit(next))) return;
      await regionsHook.saveSettings({
        ...regionsHook.settings,
        // A limpeza acima pode ter gravado a marca depois que estas configurações foram lidas.
        ...(legacyCleanupRan.current ? { legacyMicroregionsArchived: true } : {}),
        communitiesAutoImported: { ...stamped, ...Object.fromEntries(done.map((d) => [d.cod, at])) },
      });
      setLastCommunityReport(lastReport);
      const which = done.length > 4
        ? `${done.reduce((s, d) => s + d.created, 0)} comunidades em ${done.length} municípios`
        : done.map((d) => d.label).join(', ');
      notify('info', `Microrregiões do projeto carregadas: ${which}. Relatório em Sub-regiões › Comunidades.`);
    })();
  }, [enabled, regionsHook, hierarchy, manifest, rules, notify]);

  const registry = useLayerRegistry({ orgId: ORGANIZATION.id, enabled, onError: (m) => notify('error', m) });

  const [ls, setLs] = useState(() => loadLayerState(user));
  useEffect(() => { setLs(loadLayerState(user)); }, [user]);
  const updateLs = useCallback((fn) => {
    setLs((cur) => {
      const next = fn(cur);
      if (!saveLayerState(user, next)) notify('warning', 'Não foi possível salvar as preferências de camadas neste navegador.');
      return next;
    });
  }, [user, notify]);

  // Comunidades desmarcadas uma a uma no painel (só exibição: o serviço de nomes continua usando todas).
  const hiddenCommunities = ls.hiddenCommunities ?? {};
  const shownCommunitiesByMun = useMemo(() => {
    const m = new Map();
    communitiesByMun.forEach((list, cod) => m.set(cod, list.filter((c) => !hiddenCommunities[c.id])));
    return m;
  }, [communitiesByMun, hiddenCommunities]);

  // Ao entrar no modo real, aplica a visibilidade salva das camadas operacionais.
  const appliedOp = useRef(false);
  useEffect(() => {
    if (!enabled) { appliedOp.current = false; return; }
    if (appliedOp.current) return;
    appliedOp.current = true;
    const saved = Object.fromEntries(Object.entries(OP_LAYER_KEYS)
      .filter(([id]) => ls.layers[id]?.visible != null).map(([id, key]) => [key, ls.layers[id].visible]));
    if (Object.keys(saved).length) setOpLayers((l) => ({ ...l, ...saved }));
  }, [enabled, ls.layers, setOpLayers]);

  /* ---------------- Catálogo ---------------- */
  const regionById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const dataLayers = useMemo(
    () => registry.activeLayers.filter((l) => canViewLayer(l, ctxUser)),
    [registry.activeLayers, ctxUser],
  );

  const groups = useMemo(() => [
    ...SYSTEM_GROUPS,
    ...registry.groups.map((g) => ({
      ...g, sortOrder: g.parentGroupId ? (g.sortOrder ?? 0) : 200 + (Date.parse(g.createdAt) || 0) / 1e13,
    })),
  ], [registry.groups]);

  const groupPathOf = useCallback((groupId) => {
    const names = [];
    let g = registry.groups.find((x) => x.id === groupId);
    while (g) {
      names.unshift(g.name);
      const parent = g.parentGroupId;
      g = registry.groups.find((x) => x.id === parent);
    }
    return names.join(' > ');
  }, [registry.groups]);
  const groupPaths = useMemo(() => [...new Set(registry.groups.map((g) => groupPathOf(g.id)))].sort(), [registry.groups, groupPathOf]);

  const done = !!result;
  const catalog = useMemo(() => {
    const out = [
      {
        id: 'op:points', groupId: 'grp:operacao', defaultOrder: 3, kind: 'operational', name: 'Pontos importados (CSV)', geometryType: 'point',
        subtitle: done ? `${result.points.length} ponto(s) do processamento` : 'Disponível após processar o CSV',
        legend: { items: [{ geometryType: 'point', color: '#112F44' }] },
        bounds: done && result.points.length ? padBounds(bboxToBounds(geometryBboxAny({ type: 'MultiPoint', coordinates: result.points.map((p) => [p.lng, p.lat]) })), 0.1) : null,
      },
      {
        id: 'op:priority', groupId: 'grp:operacao', defaultOrder: 2, kind: 'operational', name: `Pontos prioritários (${priorityRecords.length})`, geometryType: 'point',
        legend: { items: [{ geometryType: 'point', color: '#DC2626', symbol: 'square' }] },
      },
      {
        id: 'op:territories', groupId: 'grp:operacao', defaultOrder: 1, kind: 'operational', name: 'Setores censitários (camada piloto)', geometryType: 'polygon',
        subtitle: `${PILOT_CONFIG.layer.unitType} — IBGE ${PILOT_CONFIG.layer.referenceYear}`, readOnly: true,
        legend: { items: [{ geometryType: 'polygon', color: '#94A3B8', dash: '3 3' }] },
        bounds: sectorLayer?.bounds ?? null,
      },
      ...(FEATURES.orgSubregions ? [{
        id: 'custom_regions', groupId: 'grp:subregioes', defaultOrder: 1, kind: 'custom_regions', name: `Sub-regiões da organização (${activeRegions.length})`, geometryType: 'polygon',
        legend: { items: [{ geometryType: 'polygon', color: '#0E7490' }] }, defaultVisible: true, canConfigure: true, configureLabel: 'Gerenciar sub-regiões',
        bounds: activeRegions.length ? bboxToBounds(activeRegions.map((r) => geometryBboxAny(r.geometry)).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])])) : null,
      }] : []),
      ...(communitiesByMun.size ? [...communitiesByMun.entries()].map(([cod, list], i) => ({
        id: `communities:${cod}`, groupId: 'grp:comunidades', defaultOrder: 100 - i, kind: 'communities', codMun: cod,
        name: `${hierarchy?.byCode.get(cod)?.name ?? cod} (${list.length})`, geometryType: 'polygon',
        subtitle: [
          `${list.filter((c) => c.confidence === 'baixa').length} aproximada(s)`,
          list.some((c) => hiddenCommunities[c.id]) && `${list.filter((c) => hiddenCommunities[c.id]).length} desmarcada(s)`,
        ].filter(Boolean).join(' · '),
        legend: {
          items: [
            { geometryType: 'polygon', color: '#4B5563', fill: COMMUNITY_PALETTE[0], fillOpacity: 0.8, weight: 1, label: 'Comunidade rural (cores só separam vizinhas)' },
            { geometryType: 'polygon', color: '#4B5563', fill: COMMUNITY_PALETTE[4], fillOpacity: 0.8, weight: 1, dash: '4 3', label: 'Localização aproximada (confiança baixa)' },
            { geometryType: 'polygon', color: URBAN_FILL, fill: URBAN_FILL, fillOpacity: 0.7, weight: 1, label: 'Área urbana (fora das comunidades)' },
          ],
        },
        defaultVisible: true, canConfigure: true, configureLabel: 'Gerenciar comunidades',
        bounds: hierarchy?.byCode.get(cod)?.bounds ?? null,
      })) : [{
        id: 'communities:none', groupId: 'grp:comunidades', defaultOrder: 1, kind: 'communities', name: 'Nenhuma comunidade importada', geometryType: 'polygon',
        disabled: true, disabledReason: 'Importe um arquivo de comunidades (Configurar)', canConfigure: true, configureLabel: 'Importar comunidades',
      }]),
      ...IBGE_HIERARCHY.levels.map((lv, i) => ({
        id: lv.layerId, groupId: 'grp:ibge', defaultOrder: 10 + i, kind: 'ibge', name: lv.name, geometryType: 'polygon', readOnly: true,
        subtitle: (hierarchy?.byLevel[lv.level] ?? []).map((r) => r.name).slice(0, 3).join(', ') + ((hierarchy?.byLevel[lv.level]?.length ?? 0) > 3 ? '…' : ''),
        legend: { items: [{ geometryType: 'polygon', color: lv.color, dash: lv.dash, fillOpacity: 0 }] },
        defaultVisible: lv.level === 'municipio',
        levelStyle: lv,
        disabled: !hierarchy,
        disabledReason: hier.status === 'error' ? hier.error : 'Carregando…',
        bounds: hierarchy?.byLevel[lv.level]?.length ? hierarchy.byLevel[lv.level].map((r) => r.bounds).reduce((a, b) => [[Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])], [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])]]) : null,
      })),
      ...dataLayers.map((l) => ({
        ...l,
        kind: l.kind,
        subtitle: l.kind === 'external' ? `${l.external?.type?.toUpperCase()} externa` : `${(l.metadata?.featureCount ?? 0).toLocaleString('pt-BR')} feições · v${l.currentVersion}`,
        legend: l.kind === 'data' ? legendFor(l.style, l.geometryType === 'mixed' ? 'point' : l.geometryType) : null,
        defaultVisible: false,
        canConfigure: true,
        canFilter: l.kind === 'data',
        bounds: l.metadata?.bbox ? bboxToBounds(l.metadata.bbox) : null,
        info: l.description ?? null,
      })),
    ];
    return out;
  }, [done, result, priorityRecords.length, sectorLayer, activeRegions, communitiesByMun, hiddenCommunities, hierarchy, hier, dataLayers]);

  const tree = useMemo(() => buildTree(groups, catalog, ls), [groups, catalog, ls]);
  const ordered = useMemo(() => flattenLayers(tree), [tree]);
  const effective = useMemo(() => {
    const out = {};
    catalog.forEach((l) => {
      const e = effectiveLayer(ls, l);
      if (OP_LAYER_KEYS[l.id]) e.visible = !!opLayers[OP_LAYER_KEYS[l.id]];
      out[l.id] = e;
    });
    return out;
  }, [catalog, ls, opLayers]);
  const zIndexes = useMemo(() => paneZIndexes(ordered), [ordered]);
  // Pontos do CSV e setores dividem um único pane de canvas (pane "op"): com canvas, dois
  // panes interativos se bloqueiam (o de cima engole os cliques e as dicas do de baixo).
  // A opacidade dessas duas camadas vai pelo estilo (opOpacity), não pelo pane.
  const panes = useMemo(() => {
    const out = Object.fromEntries(ordered.filter((l) => l.id !== 'op:points' && l.id !== 'op:territories')
      .map((l) => [l.id, { zIndex: zIndexes[l.id], opacity: effective[l.id]?.opacity ?? 1, passThrough: l.kind !== 'operational' }]));
    out.op = { zIndex: Math.max(zIndexes['op:points'] ?? 0, zIndexes['op:territories'] ?? 0), opacity: 1 };
    return out;
  }, [ordered, zIndexes, effective]);

  /* ---------------- Câmera, seleção, painéis ---------------- */
  const [camera, setCamera] = useState(null);
  const flyTo = useCallback((bounds, maxZoom) => { if (bounds) setCamera({ bounds, maxZoom, nonce: Date.now() }); }, []);
  const [pick, setPick] = useState(null); // { latlng, items, index }
  const [panel, setPanel] = useState({ open: false, detailId: null, focusCode: null });
  const [uploadTarget, setUploadTarget] = useState(null); // { target }
  const [settingsId, setSettingsId] = useState(null);

  const selectedRegionId = pick?.items[pick.index]?.kind === 'custom' ? pick.items[pick.index].id : (panel.open ? panel.detailId : null);

  /* ---------------- Filtros por sub-região ---------------- */
  const [filterStatus, setFilterStatus] = useState({});
  const filterKeyFor = (region) => `${region.id}:${region.updatedAt}`;
  useEffect(() => {
    if (!enabled) return;
    dataLayers.filter((l) => l.kind === 'data').forEach((l) => {
      const rid = ls.layers[l.id]?.filterRegionId;
      const region = rid ? regionById.get(rid) : null;
      const st = filterStatus[l.id];
      if (!rid) {
        if (st) setFilterStatus((s) => { const n = { ...s }; delete n[l.id]; return n; });
        return;
      }
      if (!region || !isActive(region)) {
        updateLs((cur) => patchLayer(cur, l.id, { filterRegionId: null }));
        return;
      }
      const key = filterKeyFor(region);
      if (st?.wantKey === key && st.version === l.currentVersion) return;
      setFilterStatus((s) => ({ ...s, [l.id]: { loading: true, wantKey: key, version: l.currentVersion, readyKey: s[l.id]?.readyKey } }));
      request('layer:filter', {
        layerId: l.id, version: l.currentVersion, regionKey: key, polygon: region.geometry,
      })
        .then(({ count, total }) => setFilterStatus((s) => (s[l.id]?.wantKey === key ? {
          ...s, [l.id]: { ...s[l.id], loading: false, readyKey: key, count, total },
        } : s)))
        .catch((err) => { notify('error', `Filtro não aplicado em ${l.name}: ${err.message}`); setFilterStatus((s) => ({ ...s, [l.id]: { ...s[l.id], loading: false } })); });
    });
  }, [enabled, dataLayers, ls.layers, regionById, filterStatus, updateLs, notify]);

  const setLayerFilter = useCallback((layerId, regionId) => {
    updateLs((cur) => patchLayer(cur, layerId, { filterRegionId: regionId }));
  }, [updateLs]);

  /* ---------------- Resumo da sub-região selecionada ---------------- */
  const [summary, setSummary] = useState(null);
  const summarySeq = useRef(0);
  const visibleData = useMemo(() => dataLayers.filter((l) => l.kind === 'data' && effective[l.id]?.visible), [dataLayers, effective]);
  const visibleDataRef = useRef(visibleData);
  visibleDataRef.current = visibleData;
  const visibleDataKey = visibleData.map((l) => `${l.id}@${l.currentVersion}`).join(',');
  useEffect(() => {
    const region = selectedRegionId ? regionById.get(selectedRegionId) : null;
    if (!region || !enabled) { setSummary(null); return; }
    summarySeq.current += 1;
    const seq = summarySeq.current;
    const local = [];
    const inside = preparePointInPolygon(region.geometry);
    if (opLayers.points && result?.points?.length) {
      local.push({
        layerId: 'op:points', name: 'Pontos importados (CSV)', legend: { geometryType: 'point', color: '#112F44' }, points: result.points.filter((p) => inside([p.lng, p.lat])).length,
      });
    }
    if (opLayers.priority && priorityRecords.length) {
      local.push({
        layerId: 'op:priority', name: 'Pontos prioritários', legend: { geometryType: 'point', color: '#DC2626', symbol: 'square' }, points: priorityRecords.filter((p) => inside([p.lng, p.lat])).length,
      });
    }
    const layersNow = visibleDataRef.current;
    if (!layersNow.length) { setSummary({ status: 'ready', items: local }); return; }
    setSummary({ status: 'loading', items: local });
    request('summary', { layers: layersNow.map((l) => ({ layerId: l.id, version: l.currentVersion })), polygon: region.geometry })
      .then((rows) => {
        if (seq !== summarySeq.current) return;
        const byId = new Map(layersNow.map((l) => [l.id, l]));
        setSummary({
          status: 'ready',
          items: [...rows.map((r) => {
            const l = byId.get(r.layerId);
            return { ...r, name: l.name, legend: legendFor(l.style, l.geometryType === 'mixed' ? 'point' : l.geometryType).items[0] };
          }), ...local],
        });
      })
      .catch((err) => { if (seq === summarySeq.current) setSummary({ status: 'error', items: [], error: err.message }); });
  }, [selectedRegionId, regionById, visibleDataKey, enabled, opLayers.points, opLayers.priority, result, priorityRecords]);

  /* ---------------- Editor de sub-região ---------------- */
  const [editor, setEditor] = useState(null);
  const [validation, setValidation] = useState(null);
  const [validating, setValidating] = useState(false);
  const [editorBy, setEditorBy] = useState(operator ?? '');
  useEffect(() => { setEditorBy((b) => b || operator || ''); }, [operator]);

  const resolveParent = useCallback((ref) => {
    if (ref.kind === 'ibge') {
      const r = hierarchy?.byCode.get(ref.code);
      if (!r) return null;
      return {
        kind: 'ibge', code: r.code, ibgeParentCode: r.code, parentCustomRegionId: null, geometry: r.geometry, bounds: r.bounds, label: `${r.name} (${LEVEL_LABEL[r.level]})`, level: r.level,
      };
    }
    const r = regionById.get(ref.id);
    if (!r || !isActive(r)) return null;
    const root = hierarchy?.byCode.get(r.ibgeParentCode);
    return {
      kind: 'custom', id: r.id, ibgeParentCode: r.ibgeParentCode, parentCustomRegionId: r.id, geometry: r.geometry, bounds: bboxToBounds(geometryBboxAny(r.geometry)), label: `${r.name} (sub-região)`, level: root?.level ?? null,
    };
  }, [hierarchy, regionById]);

  /** Unidades selecionáveis: municípios (níveis acima de município) ou setores (dentro do município piloto). */
  const unitsFor = useCallback((parent) => {
    if (!parent) return { method: null, units: [], label: 'municípios' };
    const insideParent = (g) => {
      const p = labelPoint(g);
      return p && pointInGeometry(p, parent.geometry);
    };
    if (parent.level === 'municipio' || parent.level === 'distrito') {
      const munCode = parent.level === 'distrito' ? hierarchy?.byCode.get(parent.ibgeParentCode)?.parentCode : parent.ibgeParentCode;
      const sectors = munCode === PILOT_CONFIG.territory.ibgeCode ? (sectorLayer?.features ?? []) : [];
      return {
        method: 'sectors',
        label: 'setores censitários',
        units: sectors.filter((f) => insideParent(f.geometry)).map((f) => ({
          code: f.properties.code, geometry: f.geometry, label: `Setor ${f.properties.code}${f.properties.fallbackName ? ` — ${f.properties.fallbackName}` : ''}`,
        })),
      };
    }
    return {
      method: 'municipalities',
      label: 'municípios',
      units: (hierarchy?.byLevel.municipio ?? []).filter((m) => insideParent(m.geometry)).map((m) => ({ code: m.code, geometry: m.geometry, label: `${m.name} (${m.code})` })),
    };
  }, [hierarchy, sectorLayer]);

  const editorUnits = useMemo(() => (editor ? unitsFor(editor.parent) : null), [editor?.parent, unitsFor]); // eslint-disable-line react-hooks/exhaustive-deps

  const startCreate = useCallback((ref, preset = null) => {
    if (!canEditRegions) { notify('warning', 'Seu papel não permite criar sub-regiões.'); return; }
    const parent = resolveParent(ref);
    if (!parent) { notify('error', 'Região-mãe não encontrada.'); return; }
    const used = new Set(activeRegions.map((r) => r.color));
    setEditor({
      mode: 'create',
      regionSet: null,
      parent,
      method: preset?.geometry ? 'drawn' : null,
      tool: null,
      geometry: preset?.geometry ?? null,
      selection: [],
      draftNonce: 1,
      sourceFile: null,
      form: preset ? {
        ...EMPTY_FORM, ...preset, tags: (preset.tags ?? []).join(', '), description: preset.description ?? '', internalCode: preset.internalCode ?? '',
      } : { ...EMPTY_FORM, color: REGION_COLORS.find((c) => !used.has(c)) ?? REGION_COLORS[activeRegions.length % REGION_COLORS.length] },
    });
    setValidation(null);
    setPick(null);
    setPanel((p) => ({ ...p, open: false }));
    flyTo(parent.bounds, 15);
    onShowMap?.();
  }, [canEditRegions, resolveParent, activeRegions, flyTo, notify, onShowMap]);

  const startEditGeometry = useCallback((id) => {
    const r = regionById.get(id);
    if (!r) return;
    const parent = resolveParent(r.parentCustomRegionId ? { kind: 'custom', id: r.parentCustomRegionId } : { kind: 'ibge', code: r.ibgeParentCode });
    if (!parent) { notify('error', 'A região-mãe desta sub-região não está disponível.'); return; }
    if (isCommunity(r) && !canManage) { notify('warning', 'Só administradores ajustam o contorno das comunidades.'); return; }
    setEditor({
      mode: 'edit-geometry', editingId: id, regionSet: r.regionSet ?? null, parent, method: 'drawn', tool: null, geometry: r.geometry, selection: [], draftNonce: Date.now(), sourceFile: null,
      form: {
        name: r.name, description: r.description ?? '', color: r.color, internalCode: r.internalCode ?? '', tags: (r.tags ?? []).join(', '),
      },
    });
    setPick(null);
    setPanel((p) => ({ ...p, open: false }));
    flyTo(bboxToBounds(geometryBboxAny(r.geometry)), 16);
    onShowMap?.();
  }, [regionById, resolveParent, flyTo, notify, onShowMap]);

  const startDuplicate = useCallback((id) => {
    const r = regionById.get(id);
    if (!r) return;
    const d = duplicateDraft(regions, r);
    startCreate(r.parentCustomRegionId ? { kind: 'custom', id: r.parentCustomRegionId } : { kind: 'ibge', code: r.ibgeParentCode }, { ...d, duplicatedFrom: r.id });
    if (!rules.allowSiblingOverlap) notify('info', 'Cópia aberta no editor: ajuste a área (a sobreposição com a original está bloqueada) ou permita sobreposição.');
  }, [regionById, regions, startCreate, rules.allowSiblingOverlap, notify]);

  // Geometria efetiva do rascunho (seleção → união).
  const unitGeometry = useMemo(() => {
    if (!editor || (editor.method !== 'municipalities' && editor.method !== 'sectors') || !editorUnits) return null;
    const sel = new Set(editor.selection);
    const geoms = editorUnits.units.filter((u) => sel.has(u.code)).map((u) => u.geometry);
    return geoms.length ? unionGeometries(geoms) : null;
  }, [editor, editorUnits]);
  const draftGeometry = editor && (editor.method === 'municipalities' || editor.method === 'sectors') ? unitGeometry : editor?.geometry ?? null;

  // Ajuste do contorno de uma comunidade: as vizinhas cedem ou recebem a diferença.
  const adjustingCommunity = editor?.mode === 'edit-geometry' && isCommunity(regionById.get(editor.editingId));

  // Validação em tempo real (com pequena espera para não pesar durante o desenho).
  useEffect(() => {
    if (!editor || !editor.method) { setValidation(null); return undefined; }
    setValidating(true);
    const t = setTimeout(() => {
      try {
        const v = validateDraft({
          ...editor.form, geometry: draftGeometry, ibgeParentCode: editor.parent.ibgeParentCode, parentCustomRegionId: editor.parent.parentCustomRegionId, regionSet: editor.regionSet ?? null,
        }, {
          regions,
          orgId: ORGANIZATION.id,
          parentGeometry: editor.parent.geometry,
          editingId: editor.editingId ?? null,
          rules,
          // Divisão: a parte nova fica dentro da comunidade original (que será reduzida).
          // Contorno de comunidade: invadir a vizinha é permitido (ela cede a área; ver planCommunityAdjust).
          ignoreOverlapIds: editor.mode === 'split' ? [editor.splitSourceId] : adjustingCommunity ? regions.filter(isCommunity).map((r) => r.id) : [],
        });
        if (adjustingCommunity && v.prepared?.geometry && !v.prepared.empty) {
          const plan = planCommunityAdjust(regions, editor.editingId, v.prepared.geometry);
          v.neighborPlan = plan;
          v.warnings = [...v.warnings, ...describeAdjustPlan(plan)];
          if (plan.emptied.length) {
            v.errors = { ...v.errors, overlap: `A nova área cobriria toda a comunidade ${plan.emptied.map((r) => `"${r.name}"`).join(', ')}. Para juntar as duas, use Unir.` };
            v.ok = false;
          }
        }
        const g = v.prepared?.geometry;
        setValidation({ ...v, metrics: g ? { areaKm2: areaKm2(g), perimeterKm: perimeterKm(g) } : { areaKm2: 0, perimeterKm: 0 } });
      } catch (err) {
        setValidation({
          ok: false, errors: { geometry: `Geometria inválida: ${err.message}` }, warnings: [], prepared: null, metrics: { areaKm2: 0, perimeterKm: 0 },
        });
      }
      setValidating(false);
    }, 250);
    return () => clearTimeout(t);
  }, [editor, draftGeometry, regions, rules, adjustingCommunity]);

  const editorApi = {
    onMethod: (m) => {
      if (m === 'units') {
        if (!editorUnits?.units.length) {
          notify('warning', editor.parent.level === 'municipio' || editor.parent.level === 'distrito'
            ? 'Não há setores censitários carregados para esta região-mãe (só o município piloto tem setores).'
            : 'Não há municípios carregados dentro desta região-mãe.');
          return;
        }
        setEditor((e) => ({ ...e, method: editorUnits.method, tool: null }));
        return;
      }
      setEditor((e) => ({ ...e, method: m, tool: m === 'drawn' && !e.geometry ? 'polygon' : null }));
    },
    onTool: (t) => setEditor((e) => ({ ...e, tool: e.tool === t ? null : t })),
    onClear: () => setEditor((e) => ({
      ...e, geometry: null, selection: [], draftNonce: Date.now(), tool: e.method === 'drawn' || e.method === 'imported' ? 'polygon' : null, method: e.method === 'imported' ? 'drawn' : e.method,
    })),
    onField: (k, v) => setEditor((e) => ({ ...e, form: { ...e.form, [k]: v } })),
    onGeometry: (g, { from }) => setEditor((e) => ({
      ...e, geometry: g, tool: null, draftNonce: from === 'draw' ? Date.now() : e.draftNonce,
    })),
    onToggleUnit: (code) => setEditor((e) => ({
      ...e, selection: e.selection.includes(code) ? e.selection.filter((c) => c !== code) : [...e.selection, code],
    })),
    onToolDone: () => setEditor((e) => (e ? { ...e, tool: null } : e)),
    onImportFile: async (file) => {
      try {
        const [{ kmlTextToGeoJSON, kmzToGeoJSON }, { detectKind, readShapefileZip, normalizeFeatures }, { looksProjected }] = await Promise.all([
          import('./layers/kml.js'), import('./layers/importEngine.js'), import('./layers/crs.js'),
        ]);
        const kind = detectKind(file.name);
        let gj;
        if (kind === 'kml') gj = kmlTextToGeoJSON(await file.text());
        else if (kind === 'kmz') gj = kmzToGeoJSON(await file.arrayBuffer());
        else if (kind === 'geojson') gj = JSON.parse(await file.text());
        else if (kind === 'shapefile') {
          const shp = readShapefileZip(new Uint8Array(await file.arrayBuffer()));
          const sample = shp.features.slice(0, 50).map((f) => f.geometry?.coordinates?.flat(3)?.slice(0, 2)).filter(Boolean);
          if (!shp.crs?.def && looksProjected(sample)) throw new Error('O shapefile não tem .prj e as coordenadas estão em metros. Inclua o .prj no .zip.');
          gj = { type: 'FeatureCollection', features: normalizeFeatures(shp.features, { crs: shp.crs }).features };
        } else throw new Error('Use GeoJSON, KML/KMZ ou Shapefile (.zip).');
        const { geometry, polygons } = polygonFromGeoJSON(gj);
        setEditor((e) => ({
          ...e, method: 'imported', tool: null, geometry, sourceFile: file.name, draftNonce: Date.now(),
        }));
        notify('success', `${polygons} polígono(s) importado(s) de ${file.name}. Ajuste os vértices se precisar.`);
        flyTo(bboxToBounds(geometryBboxAny(geometry)), 16);
      } catch (err) {
        notify('error', `Não foi possível importar: ${err.message}`);
      }
    },
    onCancel: () => {
      // Reenquadra sem a folga do editor (o painel de camadas volta à esquerda).
      flyTo(editor.parent.bounds, 15);
      setEditor(null);
      setValidation(null);
    },
    onSave: () => {
      const by = authorFor(editorBy);
      if (!String(by ?? '').trim()) { notify('error', 'Informe o responsável pela alteração.'); return; }
      const ctx = {
        regions: regionsHook.current(), orgId: ORGANIZATION.id, parentGeometry: editor.parent.geometry, rules,
      };
      try {
        let saved;
        let next;
        let plan = null;
        if (adjustingCommunity) {
          ({ regions: next, region: saved, plan } = adjustCommunityBorder(ctx.regions, editor.editingId, validation.prepared.geometry, { by }));
        } else if (editor.mode === 'edit-geometry') {
          ({ regions: next, region: saved } = updateRegion(ctx.regions, editor.editingId, { geometry: draftGeometry, creationMethod: 'drawn' }, ctx, { by }));
        } else if (editor.mode === 'split') {
          ({ regions: next, created: saved } = splitCommunity(ctx.regions, editor.splitSourceId, { part: validation.prepared.geometry, name: editor.form.name, by }));
        } else {
          ({ regions: next, region: saved } = createRegion(ctx.regions, {
            ...editor.form,
            geometry: draftGeometry,
            ibgeParentCode: editor.parent.ibgeParentCode,
            parentCustomRegionId: editor.parent.parentCustomRegionId,
            creationMethod: editor.method,
            municipalityCodes: editor.method === 'municipalities' ? editor.selection : [],
            sectorCodes: editor.method === 'sectors' ? editor.selection : [],
            sourceFile: editor.sourceFile,
          }, ctx, { by }));
        }
        regionsHook.commit(next);
        rememberOperator(by);
        const clip = validation?.prepared?.clipped && validation.prepared.beyondTolerance;
        if (editor.mode === 'split') notify('success', `Comunidade dividida: "${saved.name}" (${saved.externalCode}) criada.`);
        else if (plan) {
          const touched = [...plan.neighbors.values()].map((n) => n.region.name);
          notify('success', `Contorno de "${saved.name}" ajustado.${touched.length ? ` Vizinhas ajustadas junto: ${touched.join(', ')}.` : ''} Tudo ficou no histórico.`);
        }
        else notify(clip ? 'warning' : 'success', `Sub-região "${saved.name}" ${editor.mode === 'edit-geometry' ? 'atualizada' : 'criada'}.${clip ? ' A parte fora da região-mãe foi recortada.' : ''}`);
        setEditor(null);
        setValidation(null);
        updateLs((cur) => (isCommunity(saved) ? patchLayer(cur, `communities:${saved.ibgeParentCode}`, { visible: true }) : patchLayer(cur, 'custom_regions', { visible: true })));
        setPick({ latlng: null, items: [{ kind: 'custom', id: saved.id, key: `c:${saved.id}`, short: saved.name }], index: 0 });
        flyTo(bboxToBounds(geometryBboxAny(saved.geometry)), 16);
      } catch (err) {
        notify('error', err.message);
      }
    },
  };

  /* ---------------- Comunidades: importação, nomes, divisão, união ---------------- */
  const startSplit = useCallback((id) => {
    const r = regionById.get(id);
    if (!r || !isCommunity(r)) return;
    if (!canManage) { notify('warning', 'Só administradores dividem comunidades.'); return; }
    setEditor({
      mode: 'split',
      splitSourceId: id,
      regionSet: COMMUNITY_SET,
      parent: {
        kind: 'split', id, ibgeParentCode: r.ibgeParentCode, parentCustomRegionId: null, geometry: r.geometry, bounds: bboxToBounds(geometryBboxAny(r.geometry)), label: `${r.name} (comunidade a dividir)`, level: 'municipio',
      },
      method: 'drawn',
      tool: 'polygon',
      geometry: null,
      selection: [],
      draftNonce: Date.now(),
      sourceFile: null,
      form: {
        ...EMPTY_FORM, color: COMMUNITY_COLOR, name: '', splitOf: r.name,
      },
    });
    setPick(null);
    setPanel((pp) => ({ ...pp, open: false }));
    flyTo(bboxToBounds(geometryBboxAny(r.geometry)), 16);
    onShowMap?.();
  }, [regionById, canManage, notify, flyTo, onShowMap]);

  const communityActions = {
    onImport: async ({
      gj, fileName, overwriteEdits, by: typedBy,
    }) => {
      const by = authorFor(typedBy);
      if (!String(by ?? '').trim()) throw new Error('Informe o responsável pela importação.');
      if (!hierarchy) throw new Error('A base do IBGE ainda está carregando.');
      const parsed = parseCommunityFile(gj, { fileName, municipalityExists: (cod) => hierarchy.byCode.get(cod)?.level === 'municipio' });
      if (parsed.errors.length) throw new Error(parsed.errors.join(' '));
      const mun = hierarchy.byCode.get(parsed.codMun);
      const { regions: next, report } = importCommunities(regionsHook.current(), parsed, {
        orgId: ORGANIZATION.id, municipalityGeometry: mun.geometry, municipalityName: mun.name, fileName, overwriteEdits, by, rules,
      });
      await regionsHook.commit(next);
      rememberOperator(by);
      setLastCommunityReport(report);
      updateLs((cur) => patchLayer(cur, `communities:${parsed.codMun}`, { visible: true }));
      notify('success', `${mun.name}: ${report.created.length} comunidade(s) importada(s), ${report.updated.length} atualizada(s), ${report.unchanged.length} sem alteração.`);
      flyTo(mun.bounds, 13);
      return report;
    },
    onApplyNames: async (text, typedBy) => {
      const by = authorFor(typedBy);
      const rows = parseNameCorrections(text);
      const { regions: next, report } = applyNameCorrections(regionsHook.current(), rows, { by });
      if (report.changed.length) await regionsHook.commit(next);
      rememberOperator(by);
      notify('success', `${report.changed.length} nome(s) de comunidade corrigido(s).`);
      return report;
    },
    onExportNames: (codMun) => {
      const url = URL.createObjectURL(new Blob([namesSpreadsheet(regionsHook.current(), codMun)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `nomes_comunidades${codMun ? `_${codMun}` : ''}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    onMerge: (keepId, otherId, typedBy) => {
      const by = authorFor(typedBy);
      const keep = regionById.get(keepId);
      const other = regionById.get(otherId);
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Unir "${other.name}" a "${keep.name}"? "${keep.name}" fica com a área das duas; "${other.name}" é excluída (o histórico fica).`)) return;
      try {
        regionsHook.commit(mergeRegions(regionsHook.current(), keepId, otherId, { by }));
        rememberOperator(by);
        notify('success', `"${other.name}" unida a "${keep.name}".`);
      } catch (err) {
        notify('error', err.message);
      }
    },
    onSplit: startSplit,
  };

  /* ---------------- Ações de sub-região (painel) ---------------- */
  const commitRegions = (next) => regionsHook.commit(next);
  const regionActions = {
    onUpdate: (id, form, typedBy) => {
      const by = authorFor(typedBy);
      const r = regionById.get(id);
      try {
        const parentGeometry = r.parentCustomRegionId ? regionById.get(r.parentCustomRegionId)?.geometry : hierarchy?.byCode.get(r.ibgeParentCode)?.geometry;
        const { regions: next, changed } = updateRegion(regionsHook.current(), id, form, {
          regions: regionsHook.current(), orgId: ORGANIZATION.id, parentGeometry, rules,
        }, { by });
        if (!changed) { notify('info', 'Nenhuma alteração para salvar.'); return true; }
        commitRegions(next);
        rememberOperator(by);
        notify('success', isCommunity(r) ? `Comunidade "${r.name}" atualizada. O nome do arquivo fica guardado como nome original e no histórico.` : 'Sub-região atualizada. A alteração ficou no histórico.');
        return true;
      } catch (err) {
        notify('error', err.message);
        return false;
      }
    },
    onDelete: (id, typedBy) => {
      const by = authorFor(typedBy);
      const r = regionById.get(id);
      const n = descendantsOf(regions, id).length;
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Excluir a sub-região "${r.name}"${n ? ` e ${n} sub-região(ões) dentro dela` : ''}? A exclusão é lógica: o histórico fica e é possível restaurar.`)) return;
      try {
        const { regions: next, count } = softDeleteRegion(regionsHook.current(), id, { by });
        commitRegions(next);
        rememberOperator(by);
        notify('info', `${count} sub-região(ões) excluída(s).`);
        setPanel((p) => ({ ...p, detailId: null }));
        setPick(null);
      } catch (err) {
        notify('error', err.message);
      }
    },
    onRestore: (id, typedBy) => {
      const by = authorFor(typedBy);
      try {
        commitRegions(restoreRegion(regionsHook.current(), id, { rules }, { by }));
        notify('success', 'Sub-região restaurada.');
      } catch (err) {
        notify('error', err.message);
      }
    },
    onExport: (list) => {
      const gj = regionsToGeoJSON(list, { ibgeName: (c) => hierarchy?.byCode.get(c)?.name ?? c });
      download(`sub_regioes_${new Date().toISOString().slice(0, 10)}.geojson`, gj);
      notify('success', `${list.length} sub-região(ões) exportada(s) em GeoJSON.`);
    },
    onShowOnMap: (id) => {
      const r = regionById.get(id);
      if (!r) return;
      updateLs((cur) => patchLayer(cur, 'custom_regions', { visible: true }));
      setPanel((p) => ({ ...p, open: false }));
      setPick({ latlng: null, items: [{ kind: 'custom', id, key: `c:${id}`, short: r.name }], index: 0 });
      flyTo(bboxToBounds(geometryBboxAny(r.geometry)), 16);
      onShowMap?.();
    },
    onSetAllowOverlap: (v) => {
      regionsHook.saveSettings({ ...regionsHook.settings, allowSiblingOverlap: v });
      notify('info', v ? 'Sobreposição entre sub-regiões irmãs permitida para a organização.' : 'Sobreposição entre sub-regiões irmãs bloqueada.');
    },
  };

  /* ---------------- Ações de camada ---------------- */
  const layerActions = {
    onToggle: (id) => {
      if (OP_LAYER_KEYS[id]) {
        const key = OP_LAYER_KEYS[id];
        const next = !opLayers[key];
        setOpLayers((l) => ({ ...l, [key]: next }));
        updateLs((cur) => patchLayer(cur, id, { visible: next }));
        return;
      }
      updateLs((cur) => patchLayer(cur, id, { visible: !effective[id]?.visible }));
    },
    onOpacity: (id, v) => updateLs((cur) => patchLayer(cur, id, { opacity: v })),
    onReorder: (id, siblings, to) => updateLs((cur) => ({ ...cur, order: reorderSiblings(cur.order, siblings, id, to) })),
    onToggleCollapse: (gid) => updateLs((cur) => ({ ...cur, collapsed: { ...cur.collapsed, [gid]: !cur.collapsed[gid] } })),
    onBasemap: (id) => updateLs((cur) => ({ ...cur, basemap: id })),
    onZoomTo: (l) => flyTo(l.bounds, 15),
    onConfigure: (l) => {
      if (l.kind === 'communities') setCommunitiesOpen(true);
      else if (l.kind === 'custom_regions') setPanel({ open: true, detailId: null, focusCode: null });
      else setSettingsId(l.id);
    },
    onAddLayer: () => setUploadTarget({ target: null }),
  };

  const onUploadSaved = async ({
    layerId, version, mode, result: res, form, upload,
  }) => {
    const by = authorFor(operator) || 'local';
    const now = new Date().toISOString();
    const versionEntry = {
      version, mode, featureCount: res.featureCount, createdAt: now, createdBy: by, fileName: upload.fileName, rejectedCount: upload.rejectedCount,
    };
    const uploadEntry = {
      id: registry.newId(), status: 'done', fileName: upload.fileName, kind: upload.kind, originalCrs: upload.originalCrs, featureCount: res.featureCount,
      acceptedCount: upload.acceptedCount, rejectedCount: upload.rejectedCount, fixedCount: upload.fixedCount, errors: upload.rejected, createdBy: by, createdAt: now, finishedAt: new Date().toISOString(),
    };
    const target = registry.layers.find((l) => l.id === layerId);
    if (target) {
      await registry.updateLayer(layerId, {
        currentVersion: version,
        geometryType: res.geometryType,
        attributesSchema: res.attributes,
        metadata: {
          ...target.metadata, featureCount: res.featureCount, bbox: res.bbox, fileName: upload.fileName, originalCrs: upload.originalCrs,
        },
        versions: [...(target.versions ?? []), versionEntry],
        uploads: [...(target.uploads ?? []), uploadEntry],
      }, { by });
      notify('success', `${target.name}: versão ${version} com ${res.featureCount.toLocaleString('pt-BR')} feições.`);
    } else {
      const groupId = await registry.ensureGroupPath(form.group || 'Camadas importadas', { by });
      const fam = res.geometryType === 'mixed' ? 'point' : res.geometryType;
      const base = defaultStyleFor(fam);
      await registry.saveLayer({
        id: layerId,
        orgId: ORGANIZATION.id,
        groupId,
        name: form.name,
        description: form.description?.trim() || null,
        kind: 'data',
        geometryType: res.geometryType,
        sourceType: 'upload',
        sourceUrl: null,
        visibility: form.visibility,
        shares: [],
        style: {
          ...base, color: form.color, symbol: form.symbol ?? base.symbol, radius: fam === 'point' ? Number(form.radius) || base.radius : base.radius, weight: fam !== 'point' ? Number(form.weight) || base.weight : base.weight, rule: null,
        },
        defaultOpacity: 1,
        minZoom: form.minZoom === '' || form.minZoom == null ? null : Number(form.minZoom),
        maxZoom: null,
        attributesSchema: res.attributes,
        metadata: {
          source: 'Envio da organização', fileName: upload.fileName, originalCrs: upload.originalCrs, featureCount: res.featureCount, bbox: res.bbox,
        },
        currentVersion: version,
        versions: [versionEntry],
        uploads: [uploadEntry],
        createdBy: by,
        createdAt: now,
        updatedAt: now,
        updatedBy: by,
        deletedAt: null,
      });
      notify('success', `Camada "${form.name}" importada: ${res.featureCount.toLocaleString('pt-BR')} feições.`);
    }
    updateLs((cur) => patchLayer(cur, layerId, { visible: true }));
    if (res.bbox) flyTo(bboxToBounds(res.bbox), 15);
  };

  const onExternalSaved = async (f) => {
    const by = authorFor(operator) || 'local';
    const now = new Date().toISOString();
    const groupId = await registry.ensureGroupPath(f.group || 'Camadas externas', { by });
    const id = registry.newId();
    await registry.saveLayer({
      id,
      orgId: ORGANIZATION.id,
      groupId,
      name: f.name,
      description: null,
      kind: 'external',
      geometryType: null,
      sourceType: 'url',
      sourceUrl: f.url,
      external: {
        type: f.type, url: f.url, layers: f.layers || null, format: f.format, attribution: f.attribution || null,
      },
      visibility: 'organization',
      shares: [],
      style: null,
      defaultOpacity: 1,
      minZoom: null,
      maxZoom: null,
      metadata: { source: f.url },
      currentVersion: 1,
      versions: [],
      createdBy: by,
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
      deletedAt: null,
    });
    updateLs((cur) => patchLayer(cur, id, { visible: true }));
    notify('success', `Camada externa "${f.name}" adicionada.`);
  };

  const settingsLayer = settingsId ? registry.layers.find((l) => l.id === settingsId) : null;
  const settingsApi = {
    onSave: async (patch, { groupPath } = {}) => {
      const by = authorFor(operator) || 'local';
      let groupId = settingsLayer.groupId;
      if (groupPath !== undefined && groupPath.trim() !== groupPathOf(settingsLayer.groupId)) groupId = await registry.ensureGroupPath(groupPath, { by });
      await registry.updateLayer(settingsLayer.id, { ...patch, groupId }, { by });
      notify('success', 'Camada atualizada.');
    },
    onDelete: async () => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Excluir a camada "${settingsLayer.name}"? As feições são apagadas deste navegador; o registro (metadados e versões) fica para rastreio.`)) return;
      await registry.removeLayer(settingsLayer, { by: authorFor(operator) || 'local' });
      setSettingsId(null);
      notify('info', 'Camada excluída.');
    },
    onRemoveVersion: async (version) => {
      try {
        await registry.removeVersion(settingsLayer, version, { by: authorFor(operator) || 'local' });
        notify('info', `Feições da versão ${version} apagadas; o registro da versão foi mantido.`);
      } catch (err) {
        notify('error', err.message);
      }
    },
    onUpdateData: () => { setUploadTarget({ target: settingsLayer }); setSettingsId(null); },
  };

  /* ---------------- Cliques no mapa ---------------- */
  const pickables = useMemo(() => {
    const out = [];
    if (effective.custom_regions?.visible) {
      // Sub-regiões mais internas primeiro (aninhadas por cima).
      const depth = (r) => { let d = 0; let cur = r; while (cur?.parentCustomRegionId) { d += 1; cur = regionById.get(cur.parentCustomRegionId); } return d; };
      [...activeRegions].sort((a, b) => depth(b) - depth(a)).forEach((r) => out.push({
        kind: 'custom', id: r.id, key: `c:${r.id}`, short: r.name, geometry: r.geometry, bbox: geometryBboxAny(r.geometry),
      }));
    }
    shownCommunitiesByMun.forEach((list, cod) => {
      if (!effective[`communities:${cod}`]?.visible) return;
      list.forEach((r) => out.push({
        kind: 'custom', id: r.id, key: `c:${r.id}`, short: `Comunidade ${r.name}`, geometry: r.geometry, bbox: geometryBboxAny(r.geometry),
      }));
    });
    [...IBGE_HIERARCHY.levels].reverse().forEach((lv) => {
      if (!effective[lv.layerId]?.visible) return;
      (hierarchy?.byLevel[lv.level] ?? []).forEach((r) => out.push({
        kind: 'ibge', code: r.code, key: `i:${r.code}`, short: `${lv.short} ${r.name}`, geometry: r.geometry, bbox: r.bbox,
      }));
    });
    return out;
  }, [effective, activeRegions, shownCommunitiesByMun, hierarchy, regionById]);

  const pickCurrent = useMemo(() => {
    const it = pick?.items[pick.index];
    if (!it) return null;
    if (it.kind === 'custom') {
      const r = regionById.get(it.id);
      return r && isActive(r) ? { kind: 'custom', region: r } : null;
    }
    const r = hierarchy?.byCode.get(it.code);
    return r ? { kind: 'ibge', region: r } : null;
  }, [pick, regionById, hierarchy]);

  const visibleOrdered = ordered.filter((l) => effective[l.id]?.visible && !l.disabled);
  const dataForClick = visibleOrdered.filter((l) => l.kind === 'data').map((l) => ({
    ...l, filterKey: effective[l.id]?.filterRegionId ? filterStatus[l.id]?.readyKey ?? null : null,
  }));

  const visibleCommunityMuns = useMemo(
    () => [...communitiesByMun.keys()].filter((cod) => effective[`communities:${cod}`]?.visible),
    [communitiesByMun, effective],
  );

  // Nomes no mapa: comunidades marcadas dos municípios ligados.
  const labelRegions = useMemo(
    () => visibleCommunityMuns.flatMap((cod) => shownCommunitiesByMun.get(cod) ?? []),
    [visibleCommunityMuns, shownCommunitiesByMun],
  );

  /* ---------------- Busca de lugares ---------------- */
  const [mobileSearch, setMobileSearch] = useState(false);
  // Coordenada buscada (lat/long digitados): pino com o lugar, a fazenda e as ações.
  const [coordPin, setCoordPin] = useState(null);
  const onSearchSelect = (r) => {
    if (r.kind === 'coordenada') {
      setPick(null);
      setCoordPin({ lat: r.lat, lng: r.lng, nonce: Date.now() });
      setMobileSearch(false);
      const d = 0.004;
      flyTo([[r.lat - d, r.lng - d], [r.lat + d, r.lng + d]], 16);
      onShowMap?.();
      return;
    }
    if (r.kind === 'comunidade') {
      const reg = regionById.get(r.id);
      updateLs((cur) => {
        const { [r.id]: _drop, ...hidden } = cur.hiddenCommunities ?? {};
        return { ...patchLayer(cur, `communities:${reg.ibgeParentCode}`, { visible: true }), hiddenCommunities: hidden };
      });
      setPick({ latlng: null, items: [{ kind: 'custom', id: r.id, key: `c:${r.id}`, short: `Comunidade ${r.nome}` }], index: 0 });
    } else {
      const lv = IBGE_HIERARCHY.levels.find((x) => x.level === r.kind);
      if (lv) updateLs((cur) => patchLayer(cur, lv.layerId, { visible: true }));
      setPick({ latlng: null, items: [{ kind: 'ibge', code: r.id, key: `i:${r.id}`, short: r.nome }], index: 0 });
    }
    setMobileSearch(false);
    flyTo(bboxToBounds(r.bbox), 15);
    onShowMap?.();
  };

  /* ---------------- Saída para o MapView ---------------- */
  const basemap = BASEMAPS.find((b) => b.id === ls.basemap) ?? BASEMAPS[0];
  const navBounds = useMemo(() => (hierarchy ? padBounds(hierarchy.bounds, 0.15) : null), [hierarchy]);
  const highlightCode = pickCurrent?.kind === 'ibge' ? pickCurrent.region.code : null;

  const mapChildren = enabled ? (
    <>
      <PaneManager panes={panes} />
      <NavigationBounds maxBounds={navBounds} minZoom={navBounds ? 6 : null} />
      <CameraRequest request={camera} compact={isMobile} editing={!!editor} />
      {coordPin && (
        <CoordinatePin
          pin={coordPin}
          locator={locator}
          onAddPoint={onAddPoint ? (p) => { onAddPoint(p); setCoordPin(null); } : null}
          onRegisterPriority={onRegisterPriority ? (p) => { onRegisterPriority(p); setCoordPin(null); } : null}
          onClose={() => setCoordPin(null)}
        />
      )}
      {visibleOrdered.map((l) => {
        if (l.kind === 'ibge') return <IbgeLevelLayer key={l.id} layer={l} regions={hierarchy?.byLevel[l.levelStyle.level] ?? []} highlightCode={highlightCode} />;
        if (l.kind === 'communities') {
          return l.codMun ? <CommunitiesLayer key={l.id} layer={l} regions={shownCommunitiesByMun.get(l.codMun) ?? []} colors={communityColors} municipality={hierarchy?.byCode.get(l.codMun)?.geometry ?? null} editing={!!editor} hoveredId={hoveredCommunity} selectedId={selectedRegionId} /> : null;
        }
        if (l.kind === 'custom_regions') {
          return <CustomRegionsLayer key={l.id} layer={l} regions={activeRegions} selectedId={selectedRegionId} editingId={editor?.editingId ?? null} />;
        }
        if (l.kind === 'data') {
          const fk = effective[l.id]?.filterRegionId ? filterStatus[l.id]?.readyKey : null;
          if (effective[l.id]?.filterRegionId && !fk) return null;
          return <DataLayer key={`${l.id}@${l.currentVersion}`} layer={l} filterKey={fk ?? null} />;
        }
        if (l.kind === 'external') return <ExternalLayer key={l.id} layer={l} />;
        return null;
      })}
      {editor && (
        <Suspense fallback={null}>
        <SubRegionEditorMap
          editor={{ ...editor, geometry: draftGeometry }}
          units={editorUnits?.units ?? []}
          onGeometry={editorApi.onGeometry}
          onToggleUnit={editorApi.onToggleUnit}
          onToolDone={editorApi.onToolDone}
        />
        </Suspense>
      )}
      {ls.communityLabels !== false && visibleCommunityMuns.length > 0 && (
        <CommunityLabels regions={labelRegions} selectedId={selectedRegionId} />
      )}
      <CommunityHover
        enabled={!editor && visibleCommunityMuns.length > 0}
        locator={locator}
        visibleMunicipalities={visibleCommunityMuns}
        hiddenIds={hiddenCommunities}
        regionsById={regionById}
        onHover={setHoveredCommunity}
      />
      <MapClickRouter
        enabled={!editor}
        dataLayers={dataForClick}
        pickables={pickables}
        onPick={(p) => setPick(p ? { ...p, index: 0 } : null)}
      />
    </>
  ) : null;

  /* ---------------- Comunidades no painel: filtro e marcar/desmarcar ---------------- */
  const [communityQuery, setCommunityQuery] = useState('');
  const communityMuns = useMemo(() => [...communitiesByMun.entries()].map(([cod, list]) => ({
    cod,
    layerId: `communities:${cod}`,
    name: hierarchy?.byCode.get(cod)?.name ?? cod,
    communities: list.map((c) => ({ id: c.id, name: c.name, low: c.confidence === 'baixa' })),
  })), [communitiesByMun, hierarchy]);
  const communityFound = useMemo(() => matchCommunities(communityMuns, communityQuery), [communityMuns, communityQuery]);
  const communityTotals = useMemo(() => {
    const on = communityMuns.filter((m) => effective[m.layerId]?.visible);
    return {
      muns: communityMuns.length,
      munsOn: on.length,
      comms: communityMuns.reduce((a, m) => a + m.communities.length, 0),
      commsOn: on.reduce((a, m) => a + m.communities.filter((c) => !hiddenCommunities[c.id]).length, 0),
    };
  }, [communityMuns, effective, hiddenCommunities]);
  const filtering = !!communityQuery.trim();
  // Marcar/desmarcar: o município inteiro quando o nome dele bate (ou sem filtro); senão, só as comunidades encontradas.
  const setCommunities = (on) => updateLs((cur) => {
    let next = cur;
    const hidden = { ...(cur.hiddenCommunities ?? {}) };
    communityFound.forEach((m) => {
      if (!filtering || m.munMatch) {
        next = patchLayer(next, m.layerId, { visible: on });
        if (on) m.communities.forEach((c) => { delete hidden[c.id]; });
        return;
      }
      if (on) {
        // Município desligado: liga só as encontradas (as outras ficam desmarcadas).
        if (!effective[m.layerId]?.visible) {
          m.communities.forEach((c) => { hidden[c.id] = true; });
          next = patchLayer(next, m.layerId, { visible: true });
        }
        m.matches.forEach((c) => { delete hidden[c.id]; });
      } else {
        m.matches.forEach((c) => { hidden[c.id] = true; });
      }
    });
    return { ...next, hiddenCommunities: hidden };
  });
  const toggleCommunity = (m, c) => updateLs((cur) => {
    const hidden = { ...(cur.hiddenCommunities ?? {}) };
    const munOn = !!effective[m.layerId]?.visible;
    if (munOn && !hidden[c.id]) {
      hidden[c.id] = true;
      return { ...cur, hiddenCommunities: hidden };
    }
    let next = cur;
    if (!munOn) {
      m.communities.forEach((x) => { hidden[x.id] = true; });
      next = patchLayer(next, m.layerId, { visible: true });
    }
    delete hidden[c.id];
    return { ...next, hiddenCommunities: hidden };
  });
  const foundByLayer = useMemo(() => new Map(communityFound.map((m) => [m.layerId, m])), [communityFound]);
  const communityTools = communityMuns.length ? (
    <CommunityLayerTools
      query={communityQuery}
      onQuery={setCommunityQuery}
      found={communityFound}
      totals={communityTotals}
      onMarkAll={() => setCommunities(true)}
      onUnmarkAll={() => setCommunities(false)}
      showLabels={ls.communityLabels !== false}
      onShowLabels={(v) => updateLs((cur) => ({ ...cur, communityLabels: v }))}
    />
  ) : null;
  const communityRows = filtering ? Object.fromEntries(communityFound.filter((m) => m.matches.length).map((m) => [m.layerId, (
    <CommunityMatches
      matches={m.matches}
      isOn={(c) => !!effective[m.layerId]?.visible && !hiddenCommunities[c.id]}
      onToggle={(c) => toggleCommunity(m, c)}
    />
  )])) : {};
  const communityRowFilter = filtering ? (l) => l.kind !== 'communities' || !l.codMun || foundByLayer.has(l.id) : null;

  // Durante a edição de sub-região o painel de camadas sai da frente (o mapa precisa de espaço).
  const layerPanel = enabled && !editor ? (
    <LayerPanel
      tree={tree}
      effective={effective}
      basemaps={BASEMAPS}
      basemap={basemap.id}
      onBasemap={layerActions.onBasemap}
      onToggle={layerActions.onToggle}
      onOpacity={layerActions.onOpacity}
      onReorder={layerActions.onReorder}
      collapsed={ls.collapsed}
      onToggleCollapse={layerActions.onToggleCollapse}
      onZoomTo={layerActions.onZoomTo}
      onConfigure={layerActions.onConfigure}
      onAddLayer={layerActions.onAddLayer}
      canUpload={canUpload}
      regionsForFilter={activeRegions}
      onFilter={setLayerFilter}
      filterStatus={filterStatus}
      extras={{ 'op:points': pointFilterExtra }}
      legendExtras={{ 'op:territories': <TerritoryLegend />, 'op:priority': <PriorityLegend /> }}
      groupTools={communityTools ? { 'grp:comunidades': communityTools } : {}}
      rowFilter={communityRowFilter}
      rowChildren={communityRows}
      embedded
    />
  ) : null;

  const overlay = enabled ? (
    <>
      {editor && (
        <div className="pointer-events-none absolute right-3 top-3 z-[700] flex max-h-[calc(100%-1.5rem)] max-lg:inset-x-0 max-lg:bottom-0 max-lg:right-0 max-lg:top-auto max-lg:z-[1001]">
          <div className="pointer-events-auto flex max-h-full flex-col max-lg:w-full">
            <SubRegionEditorPanel
              compact={isMobile}
              responsible={operatorLocked ? null : (
                <label className="block">
                  <span className="text-slate-600">Responsável *</span>
                  <input value={editorBy} onChange={(e) => setEditorBy(e.target.value)} placeholder="Nome ou matrícula" className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11" autoComplete="off" />
                </label>
              )}
              editor={editor}
              validation={validation}
              validating={validating}
              parentLabel={editor.parent.label}
              unitsLabel={editorUnits?.label ?? 'municípios'}
              onMethod={editorApi.onMethod}
              onTool={editorApi.onTool}
              onClear={editorApi.onClear}
              onField={editorApi.onField}
              onImportFile={editorApi.onImportFile}
              onSave={editorApi.onSave}
              onCancel={editorApi.onCancel}
            />
          </div>
        </div>
      )}
      {!editor && pickCurrent && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[700] max-lg:inset-x-3 max-lg:z-[1001]">
          <MapPickCard
            pick={pick}
            current={pickCurrent}
            summary={pickCurrent.kind === 'custom' ? summary : null}
            place={pickCurrent.kind === 'custom' && isCommunity(pickCurrent.region) && locator ? locator.locate(pickCurrent.region.labelPoint) : null}
            canCreate={FEATURES.orgSubregions && canEditRegions && !(pickCurrent.kind === 'custom' && isCommunity(pickCurrent.region))}
            panelLabel={FEATURES.orgSubregions ? 'Sub-regiões' : 'Comunidades'}
            canEditCommunity={canManage}
            needsResponsible={!operatorLocked && !String(operator ?? '').trim()}
            onRename={(newName, typedBy) => regionActions.onUpdate(pickCurrent.region.id, { name: newName }, typedBy ?? operator)}
            onEditGeometry={() => startEditGeometry(pickCurrent.region.id)}
            onSplit={() => startSplit(pickCurrent.region.id)}
            onSelect={(i) => setPick((p) => ({ ...p, index: i }))}
            onClose={() => setPick(null)}
            onCreateHere={() => startCreate(pickCurrent.kind === 'custom' ? { kind: 'custom', id: pickCurrent.region.id } : { kind: 'ibge', code: pickCurrent.region.code })}
            onDetails={() => setPanel(pickCurrent.kind === 'custom'
              ? { open: true, detailId: pickCurrent.region.id, focusCode: null }
              : { open: true, detailId: null, focusCode: pickCurrent.region.code })}
            onZoom={() => flyTo(pickCurrent.kind === 'custom' ? bboxToBounds(geometryBboxAny(pickCurrent.region.geometry)) : pickCurrent.region.bounds, 16)}
            onFilterLayers={() => {
              const targets = dataLayers.filter((l) => l.kind === 'data' && effective[l.id]?.visible);
              if (!targets.length) { notify('info', 'Ligue uma camada de dados para filtrar pela sub-região.'); return; }
              targets.forEach((l) => setLayerFilter(l.id, pickCurrent.region.id));
              notify('info', `${targets.length} camada(s) filtrada(s) por "${pickCurrent.region.name}". Remova o filtro nas opções da camada.`);
            }}
          />
        </div>
      )}
    </>
  ) : null;

  const searchBox = enabled && hierarchy ? (
    <PlaceSearch hierarchy={hierarchy} communities={activeCommunities} onSelect={onSearchSelect} />
  ) : null;
  const mobileSearchButton = enabled && hierarchy ? (
    <button
      type="button"
      onClick={() => setMobileSearch((v) => !v)}
      aria-expanded={mobileSearch}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[14px] font-medium text-petrol-800 shadow-md"
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      Buscar
    </button>
  ) : null;
  const subRegionsButton = enabled ? (
    <button
      type="button"
      onClick={() => setPanel({ open: true, detailId: null, focusCode: null })}
      className="inline-flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-3 max-lg:text-[14px] max-lg:shadow-md"
    >
      {FEATURES.orgSubregions ? <Shapes className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" aria-hidden="true" /> : <Users className="h-3.5 w-3.5 max-lg:h-4 max-lg:w-4" aria-hidden="true" />}
      {FEATURES.orgSubregions ? `Sub-regiões (${activeRegions.length})` : `Comunidades (${activeCommunities.length.toLocaleString('pt-BR')})`}
    </button>
  ) : null;

  const dialogs = enabled ? (
    <>
      <Suspense fallback={null}>
      {uploadTarget && (
      <LayerUploadDialog
        open
        target={uploadTarget?.target ?? null}
        groupPaths={groupPaths}
        existingCount={dataLayers.length}
        by={operator}
        onClose={() => setUploadTarget(null)}
        onSaved={onUploadSaved}
        onSavedExternal={onExternalSaved}
        newId={registry.newId}
      />
      )}
      {communitiesOpen && (
      <CommunitiesDialog
        open
        onClose={() => setCommunitiesOpen(false)}
        manifest={manifest}
        countsByMun={Object.fromEntries([...communitiesByMun.entries()].map(([k, v]) => [k, v.length]))}
        canManage={canManage}
        operator={operator}
        operatorLocked={operatorLocked}
        lastReport={lastCommunityReport}
        onImport={communityActions.onImport}
        onApplyNames={communityActions.onApplyNames}
        onExportNames={communityActions.onExportNames}
      />
      )}
      {settingsLayer && (
      <LayerSettingsDialog
        key={settingsLayer?.id ?? 'none'}
        layer={settingsLayer}
        groupPath={settingsLayer ? groupPathOf(settingsLayer.groupId) : ''}
        groupPaths={groupPaths}
        canEdit={settingsLayer ? canEditLayer(settingsLayer, ctxUser) : false}
        onClose={() => setSettingsId(null)}
        {...settingsApi}
      />
      )}
      </Suspense>
      <SubRegionsPanel
        open={panel.open}
        onClose={() => setPanel((p) => ({ ...p, open: false }))}
        hierarchy={hierarchy}
        regions={FEATURES.orgSubregions ? regions : regions.filter(isCommunity)}
        communitiesOnly={!FEATURES.orgSubregions}
        sectorsLabel="Setores censitários"
        detailId={panel.detailId}
        onOpenDetail={(id) => setPanel((p) => ({ ...p, detailId: id }))}
        summary={summary}
        settings={regionsHook.settings}
        role={role}
        canEdit={canEditRegions}
        canManage={canManage}
        operator={operator}
        operatorLocked={operatorLocked}
        onCreate={startCreate}
        onEditGeometry={startEditGeometry}
        onDuplicate={startDuplicate}
        focusCode={panel.focusCode}
        locator={locator}
        onOpenCommunities={() => setCommunitiesOpen(true)}
        onSplitCommunity={startSplit}
        onMergeCommunity={communityActions.onMerge}
        {...regionActions}
      />
    </>
  ) : null;

  return {
    basemap: enabled ? basemap : null,
    opPanes: enabled ? {
      points: paneName('op'), priority: paneName('op:priority'), territories: paneName('op'),
    } : null,
    opOpacity: enabled ? {
      points: effective['op:points']?.opacity ?? 1, territories: effective['op:territories']?.opacity ?? 1,
    } : null,
    mapChildren,
    layerPanel,
    overlay,
    subRegionsButton,
    headerActions: enabled ? <span className="flex items-center gap-2">{searchBox}{subRegionsButton}</span> : null,
    mobileActions: enabled ? <>{mobileSearchButton}{subRegionsButton}</> : null,
    mobileSearch: enabled && mobileSearch && hierarchy ? (
      <div className="pointer-events-auto absolute inset-x-3 top-3 z-[1001] lg:hidden">
        <PlaceSearch hierarchy={hierarchy} communities={activeCommunities} onSelect={onSearchSelect} compact autoFocus onClose={() => setMobileSearch(false)} />
      </div>
    ) : null,
    locator,
    communitiesVisible: visibleCommunityMuns.length > 0,
    dialogs,
    editing: !!editor,
    modalOpen: !!uploadTarget || !!settingsId || panel.open,
    closeTransient: () => { setPick(null); },
  };
}
