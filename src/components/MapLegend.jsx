/**
 * Peças da legenda do mapa, usadas dentro do painel "Camadas e legenda".
 * Cada item tem o símbolo numa coluna fixa de 20 px, com o texto ao lado,
 * reproduzindo a aparência no mapa (mesmas classes e cores).
 */

/** Linha de legenda: símbolo (20 px) + texto. */
export function LegendRow({ symbol, children, muted = false }) {
  return (
    <li className={`flex min-h-6 items-center gap-2 text-[12px] leading-tight max-lg:min-h-8 max-lg:text-[13px] ${muted ? 'text-slate-500' : 'text-petrol-900'}`}>
      <span className="flex w-5 shrink-0 items-center justify-center" aria-hidden="true">{symbol}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** Subtítulo dentro de uma seção (ex.: "Categoria", "Situação"). */
export function LegendSubtitle({ children }) {
  return <p className="mt-2 text-[12px] font-medium text-slate-500 first:mt-0">{children}</p>;
}

/* Símbolos ----------------------------------------------------------- */

/** Ponto do CSV (mesma cor do status no mapa). */
export const PointSymbol = ({ dot = 'bg-petrol-800' }) => (
  <span className={`h-2.5 w-2.5 rounded-full border-[1.5px] border-white ring-1 ring-slate-300 ${dot}`} />
);

const Area = ({ cls }) => <span className={`h-3 w-4 rounded-sm ${cls}`} />;

/** Estados das unidades territoriais (iguais aos estilos dos polígonos). */
export const TERRITORY_STATES = [
  { key: 'affected', label: 'Com pontos afetados', cls: 'border-[1.5px] border-accent-600 bg-accent-400/40' },
  { key: 'excluded', label: 'Afetada, fora do aviso', cls: 'border-[1.5px] border-dashed border-accent-600 bg-accent-400/10' },
  { key: 'idle', label: 'Sem pontos afetados', cls: 'border border-dashed border-slate-400 bg-slate-200/60' },
  { key: 'focused', label: 'Selecionada', cls: 'border-[2.5px] border-petrol-900 bg-accent-500/50' },
];

export function TerritoryLegend() {
  return (
    <ul>
      {TERRITORY_STATES.map((s) => <LegendRow key={s.key} symbol={<Area cls={s.cls} />}>{s.label}</LegendRow>)}
    </ul>
  );
}

/** Marcador do ponto prioritário (mesmas classes do mapa, sem o anel de situação). */
const PrioMark = ({ category }) => (
  <span className="cr-prio-legend">
    <span className={`cr-prio-mark cat-${category}`}><span>{category}</span></span>
  </span>
);

/** Anel de situação da análise (mesmas bordas do mapa). */
const Ring = ({ cls }) => <span className={`h-3.5 w-3.5 rounded-full border-2 ${cls}`} />;

export const PRIORITY_SITUATIONS = [
  { key: 'confirmed', label: 'Correspondência confirmada', cls: 'border-petrol-900' },
  { key: 'possible', label: 'Possível correspondência', cls: 'border-dashed border-amber-600' },
  { key: 'review', label: 'Exige revisão', cls: 'border-dotted border-red-600' },
];

export function PriorityLegend() {
  return (
    <div>
      <LegendSubtitle>Categoria</LegendSubtitle>
      <ul>
        <LegendRow symbol={<PrioMark category="A" />}>A — Equipamento vital</LegendRow>
        <LegendRow symbol={<PrioMark category="B" />}>B — Atividade produtiva</LegendRow>
      </ul>
      <LegendSubtitle>Situação</LegendSubtitle>
      <ul>
        {PRIORITY_SITUATIONS.map((s) => <LegendRow key={s.key} symbol={<Ring cls={s.cls} />}>{s.label}</LegendRow>)}
      </ul>
    </div>
  );
}

/** Aviso do modo demonstração (rodapé do painel). */
export function DemoMapNote() {
  return (
    <p className="text-[12px] leading-snug text-slate-500">
      Visualização demonstrativa: os polígonos não são fronteiras oficiais.
    </p>
  );
}
