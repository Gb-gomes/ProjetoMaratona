/**
 * Utilitários geográficos sem dependências externas.
 *
 * Convenção GeoJSON: coordenadas em [longitude, latitude].
 * Convenção Leaflet: posições em [latitude, longitude].
 */

/** Teste ponto-em-anel pelo algoritmo de ray casting. */
export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Ponto dentro de um Polygon (considera buracos). */
export function pointInPolygonCoords(point, polygonCoords) {
  const [outer, ...holes] = polygonCoords;
  if (!pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

/** Ponto dentro de uma Feature Polygon ou MultiPolygon. */
export function pointInFeature(point, feature) {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') return pointInPolygonCoords(point, coordinates);
  if (type === 'MultiPolygon') return coordinates.some((poly) => pointInPolygonCoords(point, poly));
  return false;
}

/** Caixa envolvente [[sul, oeste], [norte, leste]] no formato do Leaflet. */
export function featureBounds(feature) {
  const rings = feature.geometry.type === 'Polygon'
    ? feature.geometry.coordinates
    : feature.geometry.coordinates.flat();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  rings.flat().forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  return [[minY, minX], [maxY, maxX]];
}

/** União de várias caixas envolventes no formato do Leaflet. */
export function mergeBounds(boundsList) {
  if (!boundsList.length) return null;
  return boundsList.reduce((acc, [[s, w], [n, e]]) => [
    [Math.min(acc[0][0], s), Math.min(acc[0][1], w)],
    [Math.max(acc[1][0], n), Math.max(acc[1][1], e)],
  ]);
}

/** Amplia uma caixa envolvente em uma fração do seu tamanho. */
export function padBounds([[s, w], [n, e]], ratio) {
  const dLat = (n - s) * ratio;
  const dLng = (e - w) * ratio;
  return [[s - dLat, w - dLng], [n + dLat, e + dLng]];
}

/** Centroide de área de um anel (usado para posicionar rótulos). */
export function ringCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  area *= 0.5;
  return [cx / (6 * area), cy / (6 * area)];
}

/** Converte um anel GeoJSON ([lng, lat]) em posições do Leaflet ([lat, lng]). */
export const ringToLatLngs = (ring) => ring.map(([lng, lat]) => [lat, lng]);

/**
 * Cruzamento espacial GENÉRICO (point-in-polygon) entre pontos e uma
 * FeatureCollection. Está pronto para receber a malha oficial do IBGE.
 *
 * Mantido por compatibilidade. O modo com dados reais usa spatialJoin()
 * (lib/spatialJoin.js), que também detecta limites e ambiguidades. Para volumes
 * grandes, prefira executar o cruzamento no banco (PostGIS) ou usar um
 * índice espacial.
 *
 * @param {{id:string,lat:number,lng:number}[]} points
 * @param {{features: object[]}} collection FeatureCollection GeoJSON
 * @returns {Map<string, string|null>} id do ponto → id da feição (ou null)
 */
export function spatialJoinGeoJSON(points, collection) {
  const result = new Map();
  points.forEach((p) => {
    const hit = collection.features.find((f) => pointInFeature([p.lng, p.lat], f));
    result.set(p.id, hit ? hit.properties.id : null);
  });
  return result;
}

/** Converte uma geometria Polygon/MultiPolygon em posições do Leaflet. */
export function geometryToLatLngs(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringToLatLngs);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((poly) => poly.map(ringToLatLngs));
  return [];
}

/** Caixa envolvente [minX, minY, maxX, maxY] (convenção GeoJSON). */
export function geometryBbox(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  polys.forEach((poly) => poly.forEach((ring) => ring.forEach(([x, y]) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  })));
  return [minX, minY, maxX, maxY];
}

/** Caixa GeoJSON → caixa do Leaflet [[sul, oeste], [norte, leste]]. */
export const bboxToBounds = ([minX, minY, maxX, maxY]) => [[minY, minX], [maxY, maxX]];
