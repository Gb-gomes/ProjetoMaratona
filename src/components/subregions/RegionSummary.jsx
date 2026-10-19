import { LoaderCircle } from 'lucide-react';
import LegendSwatch from '../layers/LegendSwatch.jsx';

const n = (v) => Math.round(v).toLocaleString('pt-BR');
const km = (m) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: m >= 10000 ? 0 : 1 });

/** Frase de uma camada: "1.870 Transformadores", "412 km de Linhas MT", "3 áreas (2,1 km²) de Lotes". */
export function summaryPhrase(item) {
  const parts = [];
  if (item.points) parts.push(`${n(item.points)} ${item.points === 1 ? 'ponto' : 'pontos'}`);
  if (item.lineMeters) parts.push(`${km(item.lineMeters)} km`);
  if (item.polygons) parts.push(`${n(item.polygons)} ${item.polygons === 1 ? 'área' : 'áreas'} (${(item.polygonM2 / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} km²)`);
  return parts.length ? parts.join(' · ') : 'nenhuma feição';
}

/**
 * Resumo das camadas ativas dentro de uma sub-região: uma linha por camada,
 * nome à esquerda e quantidade à direita.
 * summary: { status: 'loading'|'ready'|'error', items: [{ layerId, name, legend, ... }], error }
 */
export default function RegionSummary({ summary, compact = false }) {
  if (!summary) return null;
  if (summary.status === 'loading') {
    return <p className="flex items-center gap-1.5 text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Calculando…</p>;
  }
  if (summary.status === 'error') return <p className="text-red-700">Não foi possível calcular o resumo: {summary.error}</p>;
  if (!summary.items.length) {
    return <p className="text-slate-500">Nenhuma camada de dados ativa. Ligue uma camada ou processe um CSV para ver o que há na área.</p>;
  }
  return (
    <div>
      {!compact && <p className="mb-1 font-medium text-petrol-900">Camadas ativas na área</p>}
      <ul className="divide-y divide-slate-100" title="Comprimentos e áreas com cálculo geodésico (metros reais)">
        {summary.items.map((it) => (
          <li key={it.layerId} className="flex items-center gap-2 py-1">
            {it.legend && <LegendSwatch {...it.legend} size={12} />}
            <span className="min-w-0 flex-1 truncate text-slate-600">{it.name}</span>
            <span className="shrink-0 font-medium tabular-nums text-petrol-900">{summaryPhrase(it)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
