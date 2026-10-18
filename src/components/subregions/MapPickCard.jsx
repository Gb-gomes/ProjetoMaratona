import { useState, useEffect } from 'react';
import {
  X, Plus, ChevronRight, Filter, Maximize2, Lock, Pencil, Shapes, Scissors, Check,
} from 'lucide-react';
import RegionSummary from './RegionSummary.jsx';
import { LEVEL_LABEL } from '../../lib/ibgeHierarchy.js';
import { fmtArea } from '../../lib/customRegions.js';
import { isCommunity, confidenceReason } from '../../lib/communities.js';

/**
 * Cartão exibido ao clicar no mapa: a região sob o cursor (sub-região ou
 * limite do IBGE), com atalhos para as outras camadas no mesmo ponto.
 */
export default function MapPickCard({
  pick, current, summary, place = null, canCreate, onSelect, onClose, onCreateHere, onDetails, onZoom, onFilterLayers,
  canEditCommunity = false, needsResponsible = false, onRename, onEditGeometry, onSplit,
}) {
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [by, setBy] = useState('');
  const rid = current?.region?.id ?? current?.region?.code;
  useEffect(() => { setRenaming(false); }, [rid]);
  if (!pick || !current) return null;
  const isCustom = current.kind === 'custom';
  const r = current.region;
  const community = isCustom && isCommunity(r);
  const submitRename = (e) => {
    e.preventDefault();
    if (onRename?.(newName, needsResponsible ? by : undefined)) setRenaming(false);
  };
  return (
    <section className="pointer-events-auto w-[320px] rounded-md border border-slate-200 bg-white text-[12.5px] text-petrol-900 shadow-xl max-lg:w-full max-lg:text-[14px]" aria-label="Região selecionada">
      <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: isCustom ? r.color : '#94A3B8' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{r.name}</p>
          <p className="truncate text-[11.5px] text-slate-500 max-lg:text-[12.5px]">
            {community ? `Comunidade · ${r.externalCode} · ${fmtArea(r.areaKm2)}` : isCustom ? `Sub-região · ${fmtArea(r.areaKm2)}` : `${LEVEL_LABEL[r.level]} · IBGE ${r.code}`}
            {!isCustom && <Lock className="ml-1 inline h-3 w-3" aria-label="Limite oficial, somente leitura" />}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 max-lg:grid max-lg:h-11 max-lg:w-11 max-lg:place-items-center" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      {pick.items.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-slate-100 px-3 py-1.5">
          <span className="text-[11px] text-slate-500">Neste ponto:</span>
          {pick.items.map((it, i) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onSelect(i)}
              aria-pressed={i === pick.index}
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium max-lg:min-h-9 max-lg:px-2 max-lg:text-[12.5px] ${i === pick.index ? 'bg-petrol-800 text-white' : 'bg-slate-100 text-petrol-800 hover:bg-slate-200'}`}
            >
              {it.short}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-2 px-3 py-2">
        {community && (
          <div className="text-[12px] max-lg:text-[13px]">
            {place?.rotulo && <p className="text-petrol-800">{place.rotulo}</p>}
            {r.confidence === 'baixa' ? (
              <p className="mt-0.5 text-amber-800" title={confidenceReason(r)}>≈ Localização aproximada: {confidenceReason(r)}</p>
            ) : <p className="mt-0.5 text-slate-500">Confiança: boa</p>}
            {r.metadata?.CONFIRMADO_EM && <p className="text-slate-500">Fontes: {r.metadata.CONFIRMADO_EM}</p>}
            {r.originalName && r.originalName !== r.name && <p className="text-slate-500">Nome no arquivo: {r.originalName}</p>}
          </div>
        )}
        {community && canEditCommunity && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Editar comunidade</p>
            {renaming ? (
              <form onSubmit={submitRename} className="space-y-1.5">
                <label className="block text-[12px] text-slate-600">
                  Nome conhecido na região
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-[13px] text-petrol-900 max-lg:min-h-11"
                    autoFocus
                    autoComplete="off"
                  />
                </label>
                {needsResponsible && (
                  <label className="block text-[12px] text-slate-600">
                    Responsável
                    <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Nome ou matrícula" className="mt-0.5 block w-full rounded border border-slate-300 bg-white px-2 py-1 text-[13px] max-lg:min-h-11" autoComplete="off" />
                  </label>
                )}
                <div className="flex gap-1.5">
                  <button type="submit" disabled={!newName.trim() || newName.trim() === r.name} className="inline-flex items-center gap-1 rounded bg-petrol-800 px-2 py-1 font-semibold text-white hover:bg-petrol-700 disabled:opacity-50 max-lg:min-h-11 max-lg:px-3">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Salvar nome
                  </button>
                  <button type="button" onClick={() => setRenaming(false)} className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-petrol-800 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-3">Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => { setNewName(r.name); setRenaming(true); }} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-medium text-petrol-800 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-3" title="Trocar pelo nome como a comunidade é conhecida">
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  Renomear
                </button>
                <button type="button" onClick={onEditGeometry} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-medium text-petrol-800 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-3" title="Aumentar ou diminuir a área; as vizinhas se ajustam junto">
                  <Shapes className="h-3.5 w-3.5" aria-hidden="true" />
                  Ajustar contorno
                </button>
                <button type="button" onClick={onSplit} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 font-medium text-petrol-800 hover:bg-slate-100 max-lg:min-h-11 max-lg:px-3" title="Separar uma parte como comunidade nova">
                  <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
                  Dividir
                </button>
              </div>
            )}
          </div>
        )}
        {isCustom && <RegionSummary summary={summary} regionName={r.name} />}
        <div className="flex flex-wrap gap-1.5">
          {canCreate && (
            <button type="button" onClick={onCreateHere} className="inline-flex items-center gap-1 rounded bg-accent-500 px-2 py-1 font-semibold text-white hover:bg-accent-600 max-lg:min-h-11 max-lg:px-3">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Criar sub-região aqui
            </button>
          )}
          <button type="button" onClick={onZoom} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-3">
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            Enquadrar
          </button>
          {isCustom && (
            <button type="button" onClick={onFilterLayers} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-3" title="Mostrar só o que está dentro desta sub-região nas camadas de dados ativas">
              <Filter className="h-3.5 w-3.5" aria-hidden="true" />
              Filtrar camadas
            </button>
          )}
          <button type="button" onClick={onDetails} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-medium text-petrol-800 hover:bg-slate-50 max-lg:min-h-11 max-lg:px-3">
            {isCustom ? 'Detalhes' : 'Sub-regiões'}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
