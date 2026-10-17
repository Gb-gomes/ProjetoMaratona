import {
  LegendRow, PointSymbol, TerritoryLegend, PriorityLegend, DemoMapNote,
} from './MapLegend.jsx';

/**
 * Conteúdo do painel "Camadas e legenda" (demonstração e camadas
 * operacionais): cada camada tem a sua caixa de seleção e, logo abaixo, a
 * legenda dos símbolos que ela desenha. Assim o controle também é a legenda.
 * A rede elétrica fica desabilitada porque a demonstração não tem esses dados.
 */
const POINT_FILTERS = [
  { key: 'matched', label: 'Associados', dot: 'bg-petrol-800' },
  { key: 'unmatched', label: 'Sem correspondência', dot: 'bg-red-600' },
  { key: 'ambiguous', label: 'Ambíguos', dot: 'bg-amber-600' },
];

const checkbox = 'h-4 w-4 shrink-0 accent-accent-500 max-lg:h-5 max-lg:w-5';

/** Filtros dos pontos importados por situação: cada um com o símbolo do mapa e a contagem. */
export function PointFilters({
  pointFilter, onTogglePointFilter, counts, disabled = false,
}) {
  return (
    <ul className="space-y-0.5">
      {POINT_FILTERS.map((f) => (
        <li key={f.key}>
          <label className={`flex min-h-6 cursor-pointer items-center gap-2 text-[12px] max-lg:min-h-11 max-lg:text-[13px] ${disabled ? 'text-slate-400' : 'text-petrol-900'}`}>
            <span className="flex w-5 shrink-0 items-center justify-center" aria-hidden="true"><PointSymbol dot={f.dot} /></span>
            <span className="min-w-0 flex-1">{f.label}</span>
            {counts && <span className="tabular-nums text-slate-500">{counts[f.key]}</span>}
            <input
              type="checkbox"
              checked={pointFilter[f.key]}
              disabled={disabled}
              onChange={() => onTogglePointFilter(f.key)}
              className={checkbox}
              aria-label={`Mostrar pontos ${f.label.toLowerCase()}`}
            />
          </label>
        </li>
      ))}
    </ul>
  );
}

/** Seção do painel: título curto e divisor sutil entre seções. */
export function PanelSection({ title, children }) {
  return (
    <section className="border-t border-slate-100 px-3 py-2.5 first:border-t-0">
      {title && <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>}
      {children}
    </section>
  );
}

/** Linha de camada: caixa de seleção + nome (+ subtítulo). */
function LayerToggle({
  checked, onChange, children, subtitle, disabled = false, describedBy,
}) {
  return (
    <label className={`flex min-h-7 items-start gap-2 py-0.5 text-[13px] max-lg:min-h-11 max-lg:items-center max-lg:text-[14px] ${disabled ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-petrol-900'}`}>
      <span className="flex w-5 shrink-0 justify-center pt-0.5 max-lg:pt-0">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className={checkbox} aria-describedby={describedBy} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="font-medium">{children}</span>
        {subtitle && <span id={describedBy} className="block text-[12px] font-normal text-slate-500">{subtitle}</span>}
      </span>
    </label>
  );
}

export default function LayerControl({
  layers, onToggle, territorialTitle, pointFilter, onTogglePointFilter, counts, priorityCount = 0, demo = false,
}) {
  return (
    <div>
      <PanelSection title="Pontos importados">
        <LayerToggle checked={layers.points} onChange={() => onToggle('points')}>
          {demo ? 'Registros geográficos' : 'Pontos importados'}
        </LayerToggle>
        <div className="ml-7 mt-0.5">
          {pointFilter ? (
            <PointFilters pointFilter={pointFilter} onTogglePointFilter={onTogglePointFilter} counts={counts} disabled={!layers.points} />
          ) : (
            <ul><LegendRow symbol={<PointSymbol />} muted={!layers.points}>{demo ? 'Registro geográfico importado' : 'Ponto importado'}</LegendRow></ul>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Unidades territoriais">
        <LayerToggle checked={layers.territories} onChange={() => onToggle('territories')} subtitle={territorialTitle} describedBy="legend-territorial-title">
          Camada territorial
        </LayerToggle>
        <div className="ml-7 mt-0.5"><TerritoryLegend /></div>
      </PanelSection>

      <PanelSection title="Pontos prioritários">
        <LayerToggle checked={layers.priority} onChange={() => onToggle('priority')}>
          Pontos prioritários ({priorityCount})
        </LayerToggle>
        <div className="ml-7 mt-0.5"><PriorityLegend /></div>
      </PanelSection>

      <PanelSection title="Rede elétrica">
        <span title="Sem dados da rede elétrica nesta demonstração">
          <LayerToggle checked={false} disabled onChange={() => {}} subtitle="Indisponível: sem dados" describedBy="rede-sem-dados">
            Rede elétrica
          </LayerToggle>
        </span>
      </PanelSection>

      {demo && (
        <PanelSection>
          <DemoMapNote />
        </PanelSection>
      )}
    </div>
  );
}
