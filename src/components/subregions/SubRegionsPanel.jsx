import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Search, Plus, ArrowLeft, MapPin, Pencil, Copy, Trash2, Download, RotateCcw, History, Info, ChevronRight, Shapes, Save, Users, Scissors, Combine,
} from 'lucide-react';
import RegionSummary from './RegionSummary.jsx';
import StatusBadge from '../StatusBadge.jsx';
import {
  CREATION_METHODS, REGION_COLORS, fmtArea, nameKey, normalizeFields, descendantsOf,
} from '../../lib/customRegions.js';
import { LEVEL_LABEL, LEVEL_RANK, hierarchyPath } from '../../lib/ibgeHierarchy.js';
import { ROLE_LABEL } from '../../lib/layers/layerModel.js';
import { isCommunity, confidenceReason } from '../../lib/communities.js';
import { geometryBboxAny, bboxIntersects } from '../../lib/geoOps.js';

const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};
const ACTION_TEXT = {
  criada: 'Criada', editada: 'Editada', 'geometria editada': 'Área editada', excluída: 'Excluída', restaurada: 'Restaurada',
  importada: 'Importada', reimportada: 'Reimportada', unida: 'Unida', dividida: 'Dividida',
};
const FIELD_TEXT = {
  name: 'nome', description: 'descrição', color: 'cor', internalCode: 'código interno', tags: 'tags', geometry: 'área',
};

/**
 * Painel lateral de gestão das sub-regiões: árvore "Região IBGE > Sub-regiões",
 * busca, detalhes, renomear, editar área, duplicar, excluir (lógico),
 * restaurar, exportar GeoJSON e histórico.
 */
export default function SubRegionsPanel({
  open, onClose, hierarchy, regions, sectorsLabel, detailId, onOpenDetail, summary, settings, role, canEdit, canManage,
  operator, operatorLocked, onSetAllowOverlap, onCreate, onEditGeometry, onDuplicate, onDelete, onRestore, onUpdate, onExport, onShowOnMap,
  focusCode = null, locator = null, onOpenCommunities, onSplitCommunity, onMergeCommunity, communitiesOnly = false,
}) {
  const panelRef = useRef(null);
  const [query, setQuery] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [by, setBy] = useState(operator ?? '');
  useEffect(() => { if (open) setBy((b) => b || operator || ''); }, [open, operator]);
  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  useEffect(() => {
    if (open && focusCode) document.getElementById(`ibge-${focusCode}`)?.scrollIntoView({ block: 'start' });
  }, [open, focusCode]);

  const active = useMemo(() => regions.filter((r) => !r.deletedAt), [regions]);
  const detail = detailId ? regions.find((r) => r.id === detailId) : null;

  if (!open) return null;
  const who = operatorLocked ? operator : by;

  return (
    <div className="fixed inset-0 z-[1100] flex justify-end">
      <button type="button" className="absolute inset-0 cursor-default bg-black/40" aria-label={communitiesOnly ? 'Fechar comunidades' : 'Fechar sub-regiões'} onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="subregions-title" className="relative flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl outline-none max-lg:h-[100dvh] max-lg:max-w-none">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 max-lg:gap-1 max-lg:pl-[max(0.5rem,env(safe-area-inset-left))] max-lg:pt-[max(0.25rem,env(safe-area-inset-top))] max-lg:pb-1">
          {detail && (
            <button type="button" onClick={() => onOpenDetail(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center" aria-label="Voltar para a lista">
              <ArrowLeft className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            </button>
          )}
          <Shapes className="h-4 w-4 text-petrol-500 max-lg:hidden" aria-hidden="true" />
          <h2 id="subregions-title" className="min-w-0 flex-1 truncate text-[14px] font-semibold text-petrol-900 max-lg:text-[15px]">{detail ? detail.name : communitiesOnly ? `Comunidades (${active.length.toLocaleString('pt-BR')})` : `Sub-regiões (${active.filter((r) => !isCommunity(r)).length})`}</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:inline-flex max-lg:min-h-11 max-lg:items-center max-lg:gap-1 max-lg:px-3 max-lg:text-[15px] max-lg:font-medium max-lg:text-petrol-700" aria-label="Fechar">
            <X className="h-4 w-4 max-lg:h-5 max-lg:w-5" />
            <span className="lg:hidden" aria-hidden="true">Fechar</span>
          </button>
        </div>

        {canEdit && (
          <div className="border-b border-slate-100 px-4 py-2">
            <label className="flex items-center gap-2 text-[12px] text-slate-600 max-lg:flex-wrap max-lg:gap-1 max-lg:text-[13px]">
              Responsável pelas alterações *
              <input
                value={who}
                readOnly={operatorLocked}
                onChange={(e) => setBy(e.target.value)}
                title={operatorLocked ? 'Identificado pelo login do Cloudflare Access' : undefined}
                className={`min-w-0 flex-1 rounded border px-2 py-1 text-[13px] max-lg:min-h-11 ${operatorLocked ? 'cursor-default border-slate-200 bg-slate-50' : 'border-slate-300 bg-white'}`}
                placeholder="Nome ou matrícula"
                autoComplete="off"
              />
            </label>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[13px] text-petrol-900 max-lg:text-[14px]">
          {detail ? (
            <RegionDetail
              key={detail.id}
              region={detail}
              regions={regions}
              hierarchy={hierarchy}
              summary={summary}
              canEdit={canEdit}
              by={who}
              onUpdate={onUpdate}
              onEditGeometry={onEditGeometry}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onRestore={onRestore}
              onExport={onExport}
              onShowOnMap={onShowOnMap}
              onCreate={onCreate}
              onOpenDetail={onOpenDetail}
              sectorsLabel={sectorsLabel}
              canManage={canManage}
              locator={locator}
              onSplit={onSplitCommunity}
              onMerge={onMergeCommunity}
            />
          ) : (
            <RegionTree
              hierarchy={hierarchy}
              regions={showDeleted ? regions : active}
              query={query}
              setQuery={setQuery}
              canEdit={canEdit}
              onCreate={onCreate}
              onOpenDetail={onOpenDetail}
              onShowOnMap={onShowOnMap}
              onRestore={(id) => onRestore(id, who)}
              focusCode={focusCode}
              onOpenCommunities={onOpenCommunities}
              communitiesOnly={communitiesOnly}
            />
          )}
        </div>

        <div className="space-y-1.5 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[12px] leading-snug text-slate-600 max-lg:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-lg:text-[13px]">
          {!detail && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className="flex items-center gap-1.5 max-lg:min-h-11">
                <input type="checkbox" checked={showDeleted} onChange={() => setShowDeleted((v) => !v)} className="accent-accent-500 max-lg:h-5 max-lg:w-5" />
                Mostrar excluídas
              </label>
              {!communitiesOnly && (
              <label className={`flex items-center gap-1.5 max-lg:min-h-11 ${canManage ? '' : 'opacity-60'}`} title={canManage ? undefined : 'Somente administradores da organização'}>
                <input type="checkbox" checked={!!settings.allowSiblingOverlap} disabled={!canManage} onChange={() => onSetAllowOverlap(!settings.allowSiblingOverlap)} className="accent-accent-500 max-lg:h-5 max-lg:w-5" />
                Permitir sobreposição entre sub-regiões irmãs
              </label>
              )}
              {onOpenCommunities && (
                <button type="button" onClick={onOpenCommunities} className="inline-flex items-center gap-1 font-medium text-petrol-700 hover:underline max-lg:min-h-11">
                  <Users className="h-3 w-3" aria-hidden="true" />
                  Comunidades (importar, nomes)
                </button>
              )}
              <button type="button" onClick={() => onExport(active)} disabled={!active.length} className="inline-flex items-center gap-1 font-medium text-petrol-700 hover:underline disabled:opacity-40 max-lg:min-h-11">
                <Download className="h-3 w-3" aria-hidden="true" />
                Exportar todas (GeoJSON)
              </button>
            </div>
          )}
          <p className="flex gap-1.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              Papel: {ROLE_LABEL[role]} (interface, sem verificação em servidor). {communitiesOnly ? 'As comunidades e suas edições' : 'As sub-regiões'} ficam no IndexedDB deste navegador; exporte em GeoJSON para guardar uma cópia.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

function RegionTree({
  hierarchy, regions, query, setQuery, canEdit, onCreate, onOpenDetail, onShowOnMap, onRestore, focusCode, onOpenCommunities, communitiesOnly = false,
}) {
  const q = nameKey(query);
  const byParent = useMemo(() => {
    const m = new Map();
    regions.forEach((r) => {
      const key = r.parentCustomRegionId ?? `ibge:${r.ibgeParentCode}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    });
    m.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    return m;
  }, [regions]);

  const matches = (r) => !q || nameKey(r.name).includes(q) || nameKey(r.originalName ?? '').includes(q) || nameKey(r.internalCode ?? '').includes(q) || (r.tags ?? []).some((t) => nameKey(t).includes(q));
  const ibgeRegions = [...(hierarchy?.regions ?? [])]
    // Só comunidades: só os municípios que têm comunidade.
    .filter((ib) => !communitiesOnly || (byParent.get(`ibge:${ib.code}`) ?? []).length > 0).sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.name.localeCompare(b.name, 'pt-BR'));

  const renderRegion = (r, depth) => {
    const children = byParent.get(r.id) ?? [];
    return (
      <li key={r.id}>
        <div className={`flex items-center gap-1.5 rounded py-1 pr-1 hover:bg-slate-50 max-lg:min-h-11 ${r.deletedAt ? 'opacity-60' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: r.color }} aria-hidden="true" />
          <button type="button" onClick={() => onOpenDetail(r.id)} className="min-w-0 flex-1 truncate text-left font-medium">
            {r.name}
            {isCommunity(r) && r.confidence === 'baixa' && <span className="ml-1 text-[11px] font-normal text-amber-700" title={confidenceReason(r)}>≈</span>}
            {isCommunity(r) && r.nameEdited && <span className="ml-1 rounded bg-petrol-50 px-1 text-[11px] font-normal text-petrol-700">nome editado</span>}
            <span className="ml-1.5 font-normal text-slate-500">{fmtArea(r.areaKm2)}</span>
            {r.internalCode && <span className="ml-1.5 font-mono text-[11px] text-slate-500">{r.internalCode}</span>}
          </button>
          {r.deletedAt ? (
            canEdit && <button type="button" onClick={() => onRestore(r.id)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-petrol-700 hover:bg-slate-100 max-lg:min-h-11"><RotateCcw className="h-3 w-3" aria-hidden="true" />Restaurar</button>
          ) : (
            <button type="button" onClick={() => onShowOnMap(r.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-petrol-700 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center" aria-label={`Ver ${r.name} no mapa`}>
              <MapPin className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden="true" />
        </div>
        {!q && children.length > 0 && <ul>{children.map((c) => renderRegion(c, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded border border-slate-300 bg-white px-2 py-1 max-lg:min-h-11">
        <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={communitiesOnly ? 'Buscar comunidade por nome ou código' : 'Buscar por nome, código interno ou tag'} className="min-w-0 flex-1 bg-transparent outline-none" aria-label="Buscar sub-regiões" />
      </label>
      {q ? (
        <ul>
          {regions.filter(matches).map((r) => renderRegion(r, 0))}
          {!regions.some(matches) && <li className="text-slate-500">{communitiesOnly ? 'Nenhuma comunidade encontrada.' : 'Nenhuma sub-região encontrada.'}</li>}
        </ul>
      ) : ibgeRegions.map((ib) => {
        const all = byParent.get(`ibge:${ib.code}`)?.filter((r) => !r.parentCustomRegionId) ?? [];
        const top = all.filter((r) => !isCommunity(r));
        const comms = all.filter(isCommunity);
        return (
          <section key={ib.code} id={`ibge-${ib.code}`} className={`rounded border ${focusCode === ib.code ? 'border-accent-300 bg-accent-50/40' : 'border-slate-200'}`}>
            <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{ib.name}</p>
                <p className="text-[11px] text-slate-500 max-lg:text-[12px]">{LEVEL_LABEL[ib.level]} · IBGE {ib.code}</p>
              </div>
              {communitiesOnly ? <StatusBadge tone="neutral">{comms.length}</StatusBadge> : <StatusBadge tone="neutral">{descendantCount(byParent, ib.code) - comms.length}</StatusBadge>}
              {canEdit && !communitiesOnly && (
                <button type="button" onClick={() => onCreate({ kind: 'ibge', code: ib.code })} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[12px] font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-2.5" aria-label={`Nova sub-região em ${ib.name}`}>
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  Nova
                </button>
              )}
            </div>
            {!communitiesOnly && (top.length ? <ul className="py-1">{top.map((r) => renderRegion(r, 0))}</ul> : <p className="px-2.5 py-1.5 text-[12px] text-slate-500">Nenhuma sub-região.</p>)}
            {comms.length > 0 && (
              <details className="border-t border-slate-100" open={focusCode === ib.code}>
                <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 font-medium text-petrol-800 max-lg:min-h-11">
                  <Users className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />
                  Comunidades ({comms.length})
                  <span className="text-[11px] font-normal text-slate-500">· {comms.filter((c) => c.confidence === 'baixa').length} aproximada(s)</span>
                </summary>
                <ul className="pb-1">{comms.map((r) => renderRegion(r, 0))}</ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

function descendantCount(byParent, ibgeCode) {
  let n = 0;
  const stack = [...(byParent.get(`ibge:${ibgeCode}`) ?? [])];
  while (stack.length) {
    const r = stack.pop();
    n += 1;
    stack.push(...(byParent.get(r.id) ?? []));
  }
  return n;
}

function RegionDetail({
  region: r, regions, hierarchy, summary, canEdit: canEditRegion, by, onUpdate, onEditGeometry, onDuplicate, onDelete, onRestore, onExport, onShowOnMap, onCreate, onOpenDetail, sectorsLabel,
  canManage, locator, onSplit, onMerge,
}) {
  const community = isCommunity(r);
  // Comunidades: só administradores renomeiam, ajustam, dividem ou unem.
  const canEdit = community ? canManage : canEditRegion;
  const [mergeWith, setMergeWith] = useState('');
  const neighbors = community ? regions.filter((x) => x.id !== r.id && !x.deletedAt && isCommunity(x) && x.ibgeParentCode === r.ibgeParentCode
    && bboxIntersects(geometryBboxAny(x.geometry), geometryBboxAny(r.geometry))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) : [];
  const place = community && locator && r.labelPoint ? locator.locate(r.labelPoint) : null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => ({
    name: r.name, description: r.description ?? '', color: r.color, internalCode: r.internalCode ?? '', tags: (r.tags ?? []).join(', '),
  }));
  const path = hierarchyPath(hierarchy, r.ibgeParentCode);
  const parentCustom = r.parentCustomRegionId ? regions.find((x) => x.id === r.parentCustomRegionId) : null;
  const children = regions.filter((x) => !x.deletedAt && x.parentCustomRegionId === r.id);
  const errs = normalizeFields(form).errors;
  const deleted = !!r.deletedAt;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-4 w-4 shrink-0 rounded" style={{ background: r.color }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-slate-500 max-lg:text-[13px]">
            {path.map((p) => p.name).join(' › ')}
            {parentCustom && (
              <>
                {' › '}
                <button type="button" className="underline" onClick={() => onOpenDetail(parentCustom.id)}>{parentCustom.name}</button>
              </>
            )}
          </p>
          {deleted && <StatusBadge tone="danger" className="mt-1">Excluída em {fmtDate(r.deletedAt)} por {r.deletedBy}</StatusBadge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!deleted && <Action icon={MapPin} onClick={() => onShowOnMap(r.id)}>Ver no mapa</Action>}
        {canEdit && !deleted && <Action icon={Pencil} onClick={() => setEditing((v) => !v)}>Renomear / detalhes</Action>}
        {canEdit && !deleted && <Action icon={Shapes} onClick={() => onEditGeometry(r.id)}>{community ? 'Ajustar contorno' : 'Editar área'}</Action>}
        {canEdit && !deleted && community && <Action icon={Scissors} onClick={() => onSplit(r.id)}>Dividir</Action>}
        {canEditRegion && !deleted && !community && <Action icon={Plus} onClick={() => onCreate({ kind: 'custom', id: r.id })}>Sub-região dentro</Action>}
        {canEdit && !deleted && !community && <Action icon={Copy} onClick={() => onDuplicate(r.id)}>Duplicar</Action>}
        {!deleted && <Action icon={Download} onClick={() => onExport([r, ...descendantsOf(regions, r.id)])}>Exportar GeoJSON</Action>}
        {canEdit && !deleted && <Action icon={Trash2} danger onClick={() => onDelete(r.id, by)}>Excluir</Action>}
        {canEdit && deleted && <Action icon={RotateCcw} onClick={() => onRestore(r.id, by)}>Restaurar</Action>}
      </div>

      {editing && (
        <form
          className="space-y-2 rounded border border-slate-200 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (onUpdate(r.id, form, by)) setEditing(false);
          }}
        >
          <label className="block"><span className="text-slate-600">Nome *</span><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" /></label>
          {errs.name && <p className="text-red-700">{errs.name}</p>}
          <label className="block"><span className="text-slate-600">Descrição</span><textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1" /></label>
          <div>
            <span className="text-slate-600">Cor</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {REGION_COLORS.map((c) => <button key={c} type="button" onClick={() => set('color', c)} aria-label={`Cor ${c}`} aria-pressed={form.color === c} className={`h-6 w-6 rounded-full border-2 max-lg:h-9 max-lg:w-9 ${form.color === c ? 'border-petrol-900' : 'border-white ring-1 ring-slate-200'}`} style={{ background: c }} />)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-slate-600">Código interno</span><input value={form.internalCode} onChange={(e) => set('internalCode', e.target.value)} maxLength={40} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" /></label>
            <label className="block"><span className="text-slate-600">Tags (vírgula)</span><input value={form.tags} onChange={(e) => set('tags', e.target.value)} className="mt-0.5 block w-full rounded border border-slate-300 px-2 py-1 max-lg:min-h-11" /></label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={Object.keys(errs).length > 0} className="inline-flex items-center gap-1 rounded bg-accent-500 px-3 py-1 font-semibold text-white disabled:opacity-40 max-lg:min-h-11"><Save className="h-3.5 w-3.5" aria-hidden="true" />Salvar</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-slate-300 px-3 py-1 max-lg:min-h-11">Cancelar</button>
          </div>
        </form>
      )}

      {canEdit && !deleted && community && neighbors.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 px-3 py-2">
          <Combine className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />
          <label className="flex min-w-0 flex-1 items-center gap-2">
            Unir com
            <select value={mergeWith} onChange={(e) => setMergeWith(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-1.5 py-0.5 max-lg:min-h-11">
              <option value="">vizinha…</option>
              {neighbors.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>
          <button type="button" disabled={!mergeWith} onClick={() => { onMerge(r.id, mergeWith, by); setMergeWith(''); }} className="rounded border border-slate-300 px-2 py-0.5 font-medium disabled:opacity-40 max-lg:min-h-11">Unir</button>
        </div>
      )}

      {community && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded border border-petrol-100 bg-petrol-50/50 px-3 py-2 text-[12px] max-lg:text-[14px]">
          {place?.rotulo && (<><dt className="text-slate-500">Localização</dt><dd>{place.rotulo}</dd></>)}
          <dt className="text-slate-500">ID</dt><dd className="font-mono">{r.externalCode}</dd>
          {r.originalName && r.originalName !== r.name && (<><dt className="text-slate-500">Nome no arquivo</dt><dd>{r.originalName}</dd></>)}
          <dt className="text-slate-500">Confiança</dt>
          <dd>{r.confidence === 'baixa' ? <span className="text-amber-800">≈ baixa — localização aproximada ({confidenceReason(r)})</span> : 'boa'}</dd>
          {r.metadata?.CONFIRMADO_EM && (<><dt className="text-slate-500">Fontes</dt><dd>{r.metadata.CONFIRMADO_EM}</dd></>)}
          {r.metadata?.ENDERECOS_IBGE != null && (<><dt className="text-slate-500">Endereços (Censo)</dt><dd>{Number(r.metadata.ENDERECOS_IBGE).toLocaleString('pt-BR')}</dd></>)}
          {r.metadata?.DISTRITOS && (<><dt className="text-slate-500">Distritos tocados</dt><dd>{r.metadata.DISTRITOS}</dd></>)}
          {r.importVersion && (<><dt className="text-slate-500">Importação</dt><dd>versão {r.importVersion} · {r.sourceFile}</dd></>)}
          {(r.nameEdited || r.geometryEdited) && (<><dt className="text-slate-500">Edições manuais</dt><dd>{[r.nameEdited && 'nome', r.geometryEdited && 'contorno'].filter(Boolean).join(' e ')} (mantidas ao reimportar)</dd></>)}
          {r.metadata?.CONTORNO && (<><dt className="text-slate-500">Contorno</dt><dd className="text-slate-600">{r.metadata.CONTORNO}</dd></>)}
        </dl>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] max-lg:text-[14px]">
        <dt className="text-slate-500">Área</dt><dd>{fmtArea(r.areaKm2)}</dd>
        <dt className="text-slate-500">Perímetro</dt><dd>{r.perimeterKm.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km</dd>
        <dt className="text-slate-500">Criação</dt><dd>{CREATION_METHODS[r.creationMethod]}{r.sourceFile ? ` (${r.sourceFile})` : ''}</dd>
        {r.municipalityCodes?.length > 0 && (<><dt className="text-slate-500">Municípios</dt><dd>{r.municipalityCodes.map((c) => hierarchy?.byCode.get(c)?.name ?? c).join(', ')}</dd></>)}
        {r.sectorCodes?.length > 0 && (<><dt className="text-slate-500">{sectorsLabel}</dt><dd className="break-words">{r.sectorCodes.length}: {r.sectorCodes.join(', ')}</dd></>)}
        {r.description && (<><dt className="text-slate-500">Descrição</dt><dd className="whitespace-pre-line">{r.description}</dd></>)}
        {r.internalCode && (<><dt className="text-slate-500">Código interno</dt><dd>{r.internalCode}</dd></>)}
        {r.tags?.length > 0 && (<><dt className="text-slate-500">Tags</dt><dd>{r.tags.join(', ')}</dd></>)}
        <dt className="text-slate-500">Atualizada</dt><dd>{fmtDate(r.updatedAt)} por {r.updatedBy}</dd>
        <dt className="text-slate-500">Identificador</dt><dd className="break-all font-mono text-[11px]">{r.id}</dd>
      </dl>

      {children.length > 0 && (
        <div>
          <p className="font-medium">Sub-regiões dentro ({children.length})</p>
          <ul className="mt-0.5">
            {children.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenDetail(c.id)} className="flex items-center gap-1.5 py-0.5 hover:underline max-lg:min-h-11">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} aria-hidden="true" />
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!deleted && (
        <div className="rounded border border-slate-200 px-3 py-2">
          <RegionSummary summary={summary} regionName={r.name} />
        </div>
      )}

      <div>
        <p className="flex items-center gap-1.5 font-medium"><History className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />Histórico</p>
        <ol className="mt-1 space-y-1 border-l border-slate-200 pl-3">
          {[...r.history].reverse().map((h, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <li key={i} className="text-[12px] max-lg:text-[13px]">
              <span className="font-medium">{ACTION_TEXT[h.action] ?? h.action}</span>
              {' '}
              <span className="text-slate-500">{fmtDate(h.at)} · {h.by}</span>
              {Object.keys(h.changes ?? {}).filter((k) => FIELD_TEXT[k]).length > 0 && (
                <span className="block text-slate-600">
                  {Object.entries(h.changes).filter(([k]) => FIELD_TEXT[k]).map(([k, c]) => (k === 'geometry'
                    ? `área: ${fmtArea(c.fromAreaKm2)} → ${fmtArea(c.toAreaKm2)}`
                    : `${FIELD_TEXT[k]}: ${fmtValue(c.from)} → ${fmtValue(c.to)}`)).join('; ')}
                </span>
              )}
              {h.changes?.clippedAreaKm2 > 0 && <span className="block text-amber-800">Recorte na borda da região-mãe: {fmtArea(h.changes.clippedAreaKm2)}</span>}
              {h.changes?.motivo && <span className="block text-slate-600">{h.changes.motivo}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const fmtValue = (v) => (Array.isArray(v) ? (v.join(', ') || '—') : (v ?? '—'));

function Action({
  icon: Icon, onClick, children, danger = false,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[12px] font-medium max-lg:min-h-11 max-lg:px-3 max-lg:text-[14px] ${danger ? 'border-red-200 text-red-700 hover:bg-red-50' : 'border-slate-300 text-petrol-800 hover:bg-slate-50'}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </button>
  );
}
