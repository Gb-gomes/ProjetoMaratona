import { Layers } from 'lucide-react';

/**
 * Controle de camadas do mapa. A rede elétrica fica desabilitada porque
 * o protótipo não possui dados dessa camada.
 */
const POINT_FILTERS = [
  { key: 'matched', label: 'Associados', dot: 'bg-petrol-800' },
  { key: 'unmatched', label: 'Sem correspondência', dot: 'bg-red-600' },
  { key: 'ambiguous', label: 'Ambíguos', dot: 'bg-amber-600' },
];

export default function LayerControl({
  layers, onToggle, territorialTitle, pointFilter, onTogglePointFilter, counts, priorityCount = 0,
}) {
  return (
    <fieldset className="w-[230px] max-lg:w-[min(272px,calc(100vw-1.5rem))] rounded-md border border-slate-200 bg-white/95 px-3 py-2.5 shadow-md backdrop-blur-sm">
      <legend className="sr-only">Camadas do mapa</legend>
      <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-petrol-900" aria-hidden="true">
        <Layers className="h-3.5 w-3.5 text-petrol-500" />
        Camadas
      </p>
      <label className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] max-lg:min-h-11 max-lg:py-2 max-lg:text-[14px] text-petrol-900">
        <input
          type="checkbox"
          checked={layers.points}
          onChange={() => onToggle('points')}
          className="h-3.5 w-3.5 accent-accent-500 max-lg:h-5 max-lg:w-5"
        />
        Pontos importados
      </label>
      {pointFilter && (
        <div className="mb-1 ml-5 space-y-0.5">
          {POINT_FILTERS.map((f) => (
            <label key={f.key} className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-slate-600 max-lg:min-h-11 max-lg:gap-2 max-lg:text-[13.5px]">
              <input
                type="checkbox"
                checked={pointFilter[f.key]}
                disabled={!layers.points}
                onChange={() => onTogglePointFilter(f.key)}
                className="h-3 w-3 accent-accent-500 max-lg:h-5 max-lg:w-5"
              />
              <span className={`h-2 w-2 rounded-full ${f.dot}`} aria-hidden="true" />
              {f.label}{counts ? ` (${counts[f.key]})` : ''}
            </label>
          ))}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 py-1 text-[12.5px] max-lg:min-h-11 max-lg:py-2 max-lg:text-[14px] text-petrol-900">
        <input
          type="checkbox"
          checked={layers.priority}
          onChange={() => onToggle('priority')}
          className="h-3.5 w-3.5 accent-accent-500 max-lg:h-5 max-lg:w-5"
        />
        Pontos prioritários ({priorityCount})
      </label>
      <label className="flex cursor-pointer items-start gap-2 py-1 text-[12.5px] max-lg:min-h-11 max-lg:py-2 max-lg:text-[14px] text-petrol-900">
        <input
          type="checkbox"
          checked={layers.territories}
          onChange={() => onToggle('territories')}
          className="mt-0.5 h-3.5 w-3.5 accent-accent-500 max-lg:h-5 max-lg:w-5"
        />
        <span className="leading-tight">
          Camada territorial
          <span className="block text-[11px] max-lg:text-[12.5px] text-slate-500">{territorialTitle}</span>
        </span>
      </label>
      <label className="flex cursor-not-allowed items-start gap-2 py-1 text-[12.5px] max-lg:min-h-11 max-lg:py-2 max-lg:text-[14px] text-slate-400" title="Sem dados da rede elétrica nesta demonstração">
        <input type="checkbox" disabled checked={false} readOnly className="mt-0.5 h-3.5 w-3.5 max-lg:h-5 max-lg:w-5" aria-describedby="rede-sem-dados" />
        <span className="leading-tight">
          Rede elétrica
          <span id="rede-sem-dados" className="block text-[11px] max-lg:text-[12.5px]">Indisponível: sem dados</span>
        </span>
      </label>
    </fieldset>
  );
}
