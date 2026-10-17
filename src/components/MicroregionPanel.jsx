import { useEffect, useState } from 'react';
import {
  CircleMarker, Pane, Tooltip, useMap,
} from 'react-leaflet';
import {
  Crosshair, MapPin, LoaderCircle, TriangleAlert, X,
} from 'lucide-react';
import { parseLatLng } from '../lib/microregions.js';

export const UNIT_SOURCES = {
  microrregioes: 'Microrregiões',
  setores: 'Setores censitários',
};

const fmtKm2 = (v) => (v == null ? '' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km²`);

/**
 * Microrregiões no modo real: qual camada o cruzamento usa (microrregiões ou setores) e a
 * busca por coordenada (marca o ponto no mapa e diz em qual microrregião ele está).
 */
export default function MicroregionPanel({
  unitSource, onUnitSource, unitLocked, microregions, seed, municipalityName, result, onLocate, onClear, onShowOnMap,
}) {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [error, setError] = useState('');
  const loading = seed?.status === 'loading' || seed?.status === 'idle';

  const counts = microregions.reduce((m, r) => m.set(r.ibgeParentCode, (m.get(r.ibgeParentCode) ?? 0) + 1), new Map());
  const countLabel = [...counts.entries()].map(([code, n]) => `${municipalityName(code)} ${n}`).join(' · ');

  const submit = (e) => {
    e.preventDefault();
    const p = parseLatLng(lat, lng);
    if (p.error) { setError(p.error); return; }
    setError('');
    onLocate(p.lat, p.lng);
  };
  const clear = () => { setLat(''); setLng(''); setError(''); onClear(); };

  return (
    <section className="rounded-md border border-slate-200 bg-white shadow-panel" aria-labelledby="micro-title">
      <h2 id="micro-title" className="flex items-center gap-2 border-b border-slate-100 px-3.5 py-2.5 text-[13.5px] font-semibold text-petrol-900">
        <MapPin className="h-4 w-4 text-petrol-500" aria-hidden="true" />
        Microrregiões
      </h2>
      <div className="space-y-2.5 px-3.5 py-2.5 text-[12px] max-lg:text-[13.5px]">
        <p className="text-slate-500" aria-live="polite">
          {loading && (
            <span className="inline-flex items-center gap-1.5">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Carregando microrregiões{seed?.total ? ` (${seed.done} de ${seed.total})` : ''}…
            </span>
          )}
          {!loading && microregions.length > 0 && <>{microregions.length} microrregiões ({countLabel}). Ajuste área e nome em &quot;Sub-regiões&quot;.</>}
          {!loading && !microregions.length && (
            <span className="text-amber-800">Nenhuma microrregião ativa{seed?.error ? `: ${seed.error}` : ''}.</span>
          )}
        </p>

        <fieldset disabled={unitLocked}>
          <legend className="mb-1 font-medium text-petrol-900">Regiões da carta</legend>
          <div className="inline-flex rounded-md border border-slate-300 p-0.5" role="radiogroup" aria-label="Unidade do cruzamento">
            {Object.entries(UNIT_SOURCES).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={unitSource === key}
                onClick={() => onUnitSource(key)}
                className={`rounded px-2.5 py-1 font-medium max-lg:min-h-11 ${unitSource === key ? 'bg-petrol-700 text-white' : 'text-petrol-800 hover:bg-slate-50'} disabled:opacity-60`}
              >
                {label}
              </button>
            ))}
          </div>
          {unitLocked && <p className="mt-1 text-[11px] text-slate-500">Para trocar, comece uma nova importação.</p>}
        </fieldset>

        <form onSubmit={submit} className="space-y-1.5" aria-label="Localizar coordenada">
          <p className="flex items-center gap-1.5 font-medium text-petrol-900">
            <Crosshair className="h-3.5 w-3.5 text-petrol-500" aria-hidden="true" />
            Localizar coordenada
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="Latitude (-21,49)"
              aria-label="Latitude"
              inputMode="decimal"
              className="min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[12px] text-petrol-900 placeholder:text-slate-400 max-lg:min-h-11 max-lg:text-[14px]"
            />
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="Longitude (-42,55)"
              aria-label="Longitude"
              inputMode="decimal"
              className="min-w-0 rounded border border-slate-300 px-1.5 py-1 text-[12px] text-petrol-900 placeholder:text-slate-400 max-lg:min-h-11 max-lg:text-[14px]"
            />
          </div>
          <p className="text-[11px] text-slate-500">Graus decimais. Também aceita &quot;-21,49 -42,55&quot; no primeiro campo.</p>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="rounded-md bg-petrol-700 px-3 py-1 font-semibold text-white hover:bg-petrol-800 disabled:opacity-60 max-lg:min-h-11">
              Localizar
            </button>
            {result && (
              <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50 max-lg:min-h-11">
                <X className="h-3 w-3" aria-hidden="true" />
                Limpar
              </button>
            )}
          </div>
          {error && <p className="text-red-700" role="alert">{error}</p>}
        </form>

        {result && <LookupResult result={result} municipalityName={municipalityName} onShowOnMap={onShowOnMap} />}
      </div>
    </section>
  );
}

function LookupResult({ result, municipalityName, onShowOnMap }) {
  const r = result.microregions[0];
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-2.5 py-2" aria-live="polite">
      <p className="font-mono text-[11px] text-slate-500">
        {result.lat.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}, {result.lng.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}
      </p>
      {r ? (
        <>
          <p className="mt-0.5 text-[14px] font-semibold text-petrol-900 max-lg:text-[16px]">{r.name}</p>
          <p className="text-slate-600">
            Microrregião de {municipalityName(r.ibgeParentCode)} · {fmtKm2(r.areaKm2)}
          </p>
          {result.microregions.length > 1 && (
            <p className="mt-1 text-amber-800">Também em: {result.microregions.slice(1).map((x) => x.name).join(', ')}</p>
          )}
          {(r.tags ?? []).includes('conferir') && (
            <p className="mt-1 flex gap-1 text-amber-800">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              Confiança baixa: poucos endereços no Censo; conferir a área.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mt-0.5 font-semibold text-amber-800">Fora das microrregiões mapeadas</p>
          <p className="text-slate-600">
            {result.municipality
              ? `Dentro de ${result.municipality.name}: provavelmente área urbana (as microrregiões cobrem a zona rural).`
              : 'Fora dos municípios carregados.'}
          </p>
        </>
      )}
      {onShowOnMap && (
        <button type="button" onClick={onShowOnMap} className="mt-1.5 text-[12px] font-medium text-petrol-700 underline underline-offset-2 hover:text-petrol-900 lg:hidden">
          Ver no mapa
        </button>
      )}
    </div>
  );
}

/** Marcador do ponto buscado (dentro do MapContainer); leva a câmera até ele. */
export function LookupMarker({ result }) {
  const map = useMap();
  useEffect(() => {
    if (result) map.flyTo([result.lat, result.lng], Math.max(map.getZoom(), 13), { duration: 0.7 });
  }, [result, map]);
  if (!result) return null;
  const r = result.microregions[0];
  return (
    <Pane name="cr-lookup" style={{ zIndex: 660 }}>
    <CircleMarker
      center={[result.lat, result.lng]}
      radius={9}
      pathOptions={{ color: '#DC2626', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }}
    >
      <Tooltip permanent direction="top" offset={[0, -10]} className="cr-point-tip">
        <strong>{r ? r.name : 'Fora das microrregiões'}</strong>
        {r && <><br />Microrregião · {result.municipality?.name ?? ''}</>}
      </Tooltip>
    </CircleMarker>
    </Pane>
  );
}
