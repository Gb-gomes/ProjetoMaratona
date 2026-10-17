import { LoaderCircle, Layers } from 'lucide-react';
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
 * Resumo das camadas ativas dentro de uma sub-região.
 * summary: { status: 'loading'|'ready'|'error', items: [{ layerId, name, legend, ... }], error }
 */
export default function RegionSummary({ summary, regionName, compact = false }) {
  if (!summary) return null;
  if (summary.status === 'loading') {
    return <p className="flex items-center gap-1.5 text-slate-500"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Calculando o resumo das camadas ativas…</p>;
  }
  if (summary.status === 'error') return <p className="text-red-700">Não foi possível calcular o resumo: {summary.error}</p>;
  if (!summary.items.length) {
    return <p className="text-slate-500">Ligue camadas de dados (ou processe um CSV) para ver o resumo do que há dentro {regionName ? `de ${regionName}` : 'da sub-região'}.</p>;
  }
  return (
    <div>
      {!compact && (
        <p className="flex items-center gap-1.5 font-medium text-petrol-900">
          <Layers className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />
          Camadas ativas dentro da área
        </p>
      )}
      <ul className="mt-0.5 space-y-0.5">
        {summary.items.map((it) => (
          <li key={it.layerId} className="flex items-start gap-1.5">
            {it.legend && <span className="mt-0.5"><LegendSwatch {...it.legend} size={14} /></span>}
            <span className="min-w-0"><strong className="font-medium">{it.name}:</strong> {summaryPhrase(it)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[10.5px] text-slate-500">Comprimentos e áreas em metros reais (cálculo geodésico).</p>
    </div>
  );
}
