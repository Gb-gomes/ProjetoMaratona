import { useEffect, useRef, useState } from 'react';
import { CircleMarker, Popup } from 'react-leaflet';
import { MapPinPlus, ShieldAlert, X } from 'lucide-react';
import { loadFarmIndex, describeFarm } from '../../lib/farmIndex.js';
import { formatLatLng } from '../../lib/coords.js';

/** Raio da busca da fazenda mais próxima de uma coordenada. */
const FARM_NEAR_METERS = 500;

/**
 * Pino de uma coordenada buscada (lat/long digitados). Mostra onde o ponto
 * cai (comunidade, distrito, município) e a fazenda mais próxima no
 * catálogo, e oferece as ações: incluir o ponto no desligamento ou cadastrar
 * como ponto prioritário.
 */
export default function CoordinatePin({
  pin, locator, onAddPoint, onRegisterPriority, onClose,
}) {
  const ref = useRef(null);
  const [farm, setFarm] = useState({ status: 'loading' });
  const place = locator?.locate([pin.lng, pin.lat]) ?? null;

  useEffect(() => {
    let alive = true;
    setFarm({ status: 'loading' });
    loadFarmIndex()
      .then((idx) => { if (alive) setFarm({ status: 'ready', hit: idx.nearest(pin.lat, pin.lng, FARM_NEAR_METERS) }); })
      .catch(() => { if (alive) setFarm({ status: 'error' }); });
    return () => { alive = false; };
  }, [pin.lat, pin.lng]);

  // Abre o balão depois que o mapa chega ao ponto (e a cada nova busca); o autoPan respeita os botões do mapa.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.openPopup(), 900);
    return () => clearTimeout(t);
  }, [pin.nonce]);

  const point = { lat: pin.lat, lng: pin.lng, farm: farm.hit?.farm ?? null };

  return (
    <CircleMarker
      ref={ref}
      center={[pin.lat, pin.lng]}
      radius={8}
      pathOptions={{ color: '#DC2626', weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }}
    >
      <Popup minWidth={240} maxWidth={300} autoPan autoPanPaddingTopLeft={[16, 120]} autoPanPaddingBottomRight={[16, 24]} closeButton={false}>
        <div className="space-y-1.5 text-[12px] text-petrol-900">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">Coordenada {formatLatLng(pin.lat, pin.lng)}</p>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Fechar">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
          <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5">
            <dt className="text-slate-500">Lugar</dt>
            <dd>
              {place?.comunidade ? <strong>Comunidade {place.comunidade.nome}</strong> : (place?.local ?? <span className="text-amber-700">{place?.rotulo ?? 'Malha ainda não carregada'}</span>)}
              {place?.origem_nome === 'comunidade_proxima' && <span className="block text-[11px] text-slate-500">comunidade mais próxima (até 100 m)</span>}
            </dd>
            {place?.municipio && (
              <>
                <dt className="text-slate-500">Município</dt>
                <dd>{place.municipio.nome}{place.municipio.uf ? `/${place.municipio.uf}` : ''}{place.distrito ? ` · ${place.distrito.sede ? 'distrito-sede' : `distrito de ${place.distrito.nome}`}` : ''}</dd>
              </>
            )}
            <dt className="text-slate-500">Fazenda</dt>
            <dd>
              {farm.status === 'loading' && <span className="text-slate-500">procurando no catálogo…</span>}
              {farm.status === 'error' && <span className="text-slate-500">catálogo indisponível</span>}
              {farm.status === 'ready' && (farm.hit
                ? <>{describeFarm(farm.hit.farm)} <span className="text-slate-500">· a {Math.round(farm.hit.meters)} m</span></>
                : <span className="text-slate-500">nenhuma a até {FARM_NEAR_METERS} m</span>)}
            </dd>
          </dl>
          {(onAddPoint || onRegisterPriority) && (
            <div className="flex flex-col gap-1 pt-1">
              {onAddPoint && (
                <button type="button" onClick={() => onAddPoint(point)} className="flex items-center justify-center gap-1.5 rounded-md bg-petrol-700 px-2.5 py-1.5 font-semibold text-white hover:bg-petrol-800">
                  <MapPinPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Incluir no desligamento
                </button>
              )}
              {onRegisterPriority && (
                <button type="button" onClick={() => onRegisterPriority(point)} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 font-medium text-petrol-800 hover:bg-slate-50">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Cadastrar ponto prioritário aqui
                </button>
              )}
            </div>
          )}
        </div>
      </Popup>
    </CircleMarker>
  );
}
