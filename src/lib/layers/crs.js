/**
 * Sistemas de referência aceitos na importação de camadas. Tudo é
 * reprojetado para EPSG:4326 (WGS 84 geográfico), o referencial do mapa.
 *
 * SIRGAS 2000 geográfico (EPSG:4674) é tratado como idêntico ao WGS 84
 * (diferença < 1 m), como faz o ogr2ogr e como já é feito na camada piloto.
 */
import proj4 from 'proj4';

const SIRGAS_UTM = (zone) => `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
const WGS_UTM = (zone) => `+proj=utm +zone=${zone} +south +datum=WGS84 +units=m +no_defs`;
const SAD69 = '+towgs84=-67.35,3.88,-38.22,0,0,0,0';
const SAD69_UTM = (zone) => `+proj=utm +zone=${zone} +south +ellps=aust_SA ${SAD69} +units=m +no_defs`;

export const KNOWN_CRS = [
  { code: 'EPSG:4326', name: 'WGS 84 (geográfico, graus)', geographic: true, def: '+proj=longlat +datum=WGS84 +no_defs' },
  { code: 'EPSG:4674', name: 'SIRGAS 2000 (geográfico, graus)', geographic: true, def: '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs' },
  ...[18, 19, 20, 21, 22, 23, 24, 25].map((z) => ({
    code: `EPSG:${31960 + z}`, name: `SIRGAS 2000 / UTM zona ${z}S`, geographic: false, def: SIRGAS_UTM(z), zone: z,
  })),
  ...[18, 19, 20, 21, 22, 23, 24, 25].map((z) => ({
    code: `EPSG:${32700 + z}`, name: `WGS 84 / UTM zona ${z}S`, geographic: false, def: WGS_UTM(z), zone: z,
  })),
  { code: 'EPSG:4618', name: 'SAD69 (geográfico, graus)', geographic: true, def: `+proj=longlat +ellps=aust_SA ${SAD69} +no_defs` },
  ...[22, 23, 24].map((z) => ({
    code: `EPSG:${29170 + z}`, name: `SAD69 / UTM zona ${z}S`, geographic: false, def: SAD69_UTM(z), zone: z,
  })),
];

const BY_CODE = new Map(KNOWN_CRS.map((c) => [c.code, c]));
export const crsByCode = (code) => BY_CODE.get(code) ?? null;

/** Identidade: não precisa transformar. */
export const isIdentity = (code) => code === 'EPSG:4326' || code === 'EPSG:4674';

/** Nome declarado em um WKT (.prj). */
export function wktName(wkt) {
  return /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/i.exec(wkt ?? '')?.[1] ?? null;
}

/**
 * Identifica o CRS de um .prj (WKT/ESRI).
 * @returns {{ code: string|null, name: string, def: string|null, source: 'prj' }}
 */
export function crsFromPrj(wkt) {
  const text = String(wkt ?? '');
  const name = wktName(text) ?? 'Referencial do .prj';
  const projected = /PROJCS|PROJCRS/i.test(text);
  const zone = /UTM[_\s]*zone[_\s]*(\d{1,2})\s*S/i.exec(text)?.[1];
  const sirgas = /SIRGAS[_\s-]*2000/i.test(text);
  const sad69 = /SAD[_\s-]*69|South_American_1969/i.test(text);
  const wgs = /WGS[_\s-]*(19)?84/i.test(text);
  let code = null;
  if (!projected) {
    if (sirgas) code = 'EPSG:4674';
    else if (sad69) code = 'EPSG:4618';
    else if (wgs) code = 'EPSG:4326';
  } else if (zone) {
    const z = Number(zone);
    if (sirgas) code = `EPSG:${31960 + z}`;
    else if (sad69 && z >= 22 && z <= 24) code = `EPSG:${29170 + z}`;
    else if (wgs) code = `EPSG:${32700 + z}`;
  }
  const known = code ? crsByCode(code) : null;
  if (known) return { code, name: known.name, def: known.def, source: 'prj', declared: name };
  // Referencial não catalogado: usa o próprio WKT, se o proj4 o entender.
  try {
    proj4(text);
    return { code: null, name, def: text, source: 'prj', declared: name };
  } catch {
    return { code: null, name, def: null, source: 'prj', declared: name };
  }
}

/** CRS declarado num GeoJSON antigo (membro "crs", removido na RFC 7946). */
export function crsFromGeoJSON(gj) {
  const name = gj?.crs?.properties?.name;
  if (!name) return null;
  if (/CRS84|4326/.test(name)) return { code: 'EPSG:4326', name: crsByCode('EPSG:4326').name, def: crsByCode('EPSG:4326').def, source: 'geojson' };
  const epsg = /EPSG:{1,2}(\d{4,5})/i.exec(name)?.[1];
  const known = epsg ? crsByCode(`EPSG:${epsg}`) : null;
  return known
    ? { code: known.code, name: known.name, def: known.def, source: 'geojson' }
    : { code: null, name, def: null, source: 'geojson' };
}

/** As coordenadas parecem métricas (fora da faixa de graus)? */
export function looksProjected(sample) {
  return sample.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90);
}

/** Sugestão de zona UTM a partir de uma longitude (para orientar o usuário). */
export const utmZoneForLng = (lng) => Math.floor((lng + 180) / 6) + 1;

/**
 * Função de transformação [x, y] → [lng, lat] (EPSG:4326).
 * @param {string} def definição proj4 ou WKT
 */
export function makeTransform(crs) {
  if (!crs?.def) throw new Error('Sistema de referência indefinido.');
  if (crs.code && isIdentity(crs.code)) return null;
  const converter = proj4(crs.def, 'EPSG:4326');
  return (c) => converter.forward([c[0], c[1]]);
}

/** Aplica a transformação a todas as coordenadas de uma geometria (in place). */
export function transformGeometry(g, fn) {
  if (!g || !fn) return g;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      const [x, y] = fn(c);
      c[0] = x;
      c[1] = y;
      return;
    }
    for (let i = 0; i < c.length; i += 1) visit(c[i]);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => transformGeometry(x, fn));
  else visit(g.coordinates);
  return g;
}
