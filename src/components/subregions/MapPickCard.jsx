import {
  X, Plus, ChevronRight, Filter, Maximize2, Lock,
} from 'lucide-react';
import RegionSummary from './RegionSummary.jsx';
import { LEVEL_LABEL } from '../../lib/ibgeHierarchy.js';
import { fmtArea } from '../../lib/customRegions.js';

/**
 * Cartão exibido ao clicar no mapa: a região sob o cursor (sub-região ou
 * limite do IBGE), com atalhos para as outras camadas no mesmo ponto.
 */
export default function MapPickCard({
  pick, current, summary, canCreate, onSelect, onClose, onCreateHere, onDetails, onZoom, onFilterLayers,
}) {
  if (!pick || !current) return null;
  const isCustom = current.kind === 'custom';
  const r = current.region;
  return (
    <section className="pointer-events-auto w-[320px] rounded-md border border-slate-200 bg-white text-[12.5px] text-petrol-900 shadow-xl max-lg:w-full max-lg:text-[14px]" aria-label="Região selecionada">
      <div className="flex items-start gap-2 border-b border-slate-100 px-3 py-2">
        <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: isCustom ? r.color : '#94A3B8' }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{r.name}</p>
          <p className="truncate text-[11.5px] text-slate-500 max-lg:text-[12.5px]">
            {isCustom ? `Sub-região · ${fmtArea(r.areaKm2)}` : `${LEVEL_LABEL[r.level]} · IBGE ${r.code}`}
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
