#!/usr/bin/env node
/**
 * Executa o MESMO pipeline da aplicação (parseCsv → validateRecords →
 * spatialJoin) sobre um CSV e, se houver uma coluna de referência com o
 * código oficial esperado (ex.: setor do CNEFE), compara ponto a ponto.
 *
 * Uso:
 *   node scripts/validar_cruzamento.mjs <pontos.csv> [camada.geojson] [coluna_referencia]
 *   padrão da camada: public/data/ibge/camada_piloto.geojson
 *
 * Usa os campos configurados em PILOT_CONFIG (src/config.js). Não envia nada
 * para fora e não imprime coordenadas, exceto das divergências (que servem
 * para conferência no QGIS).
 */
import { readFileSync } from 'node:fs';
import { parseCsv, suggestMapping, validateRecords } from '../src/lib/csv.js';
import { validateLayer } from '../src/lib/layer.js';
import { spatialJoin } from '../src/lib/spatialJoin.js';
import { PILOT_CONFIG } from '../src/config.js';

const [csvPath, layerPath = 'public/data/ibge/camada_piloto.geojson', refColumn = null] = process.argv.slice(2);
if (!csvPath) {
  console.error('Uso: node scripts/validar_cruzamento.mjs <pontos.csv> [camada.geojson] [coluna_referencia]');
  process.exit(1);
}

const layerCheck = validateLayer(JSON.parse(readFileSync(layerPath, 'utf-8')), PILOT_CONFIG.layer.fields);
if (!layerCheck.ok) throw new Error(`Camada inválida: ${layerCheck.errors.join('; ')}`);
const { layer } = layerCheck;

const parsed = parseCsv(readFileSync(csvPath, 'utf-8'));
const mapping = suggestMapping(parsed.headers);
const validation = validateRecords(parsed, mapping);
const t0 = performance.now();
const result = spatialJoin(validation, layer, { mapping });
const ms = performance.now() - t0;

console.log(`Arquivo: ${csvPath}`);
console.log(`Mapeamento sugerido: ${Object.entries(mapping).filter(([, i]) => i != null).map(([k, i]) => `${k}=${parsed.headers[i]}`).join(', ')}`);
console.log(`Importados: ${result.imported} | válidos: ${result.valid} | inválidos: ${result.invalid} | com alerta: ${result.warnings}`);
console.log(`Associados: ${result.matched} | sem correspondência: ${result.unmatched} | ambíguos: ${result.ambiguous} | unidades: ${result.units.length}`);
console.log(`Soma por unidade = associados: ${result.checks.unitSumEqualsMatched} | status somam os válidos: ${result.checks.statusSumEqualsValid} | cruzamento em ${ms.toFixed(0)} ms`);

validation.records.filter((r) => r.issues.length).slice(0, 10).forEach((r) => {
  console.log(`  ocorrência linha ${r.line}: ${r.issues.map((i) => `${i.severity}: ${i.message}`).join(' ')}`);
});

if (!refColumn) process.exit(0);
const refIdx = parsed.headers.indexOf(refColumn);
if (refIdx < 0) throw new Error(`Coluna de referência não encontrada: ${refColumn}`);

/** Menor distância (m) do ponto ao limite de uma geometria. */
const byId = new Map(layer.features.map((f) => [f.properties.id, f]));
function distanceToBoundaryM(lng, lat, geometry) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110574;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best = Infinity;
  polys.forEach((poly) => poly.forEach((ring) => {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const ax = (ring[i][0] - lng) * kx; const ay = (ring[i][1] - lat) * ky;
      const bx = (ring[i + 1][0] - lng) * kx; const by = (ring[i + 1][1] - lat) * ky;
      const dx = bx - ax; const dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }));
  return best;
}

const refByLine = new Map(parsed.rows.map((row, i) => [parsed.rowLines[i], row[refIdx]]));
let agree = 0;
let refMissingInLayer = 0;
const divergences = [];
result.points.forEach((p) => {
  const ref = refByLine.get(p.line);
  if (!byId.has(ref)) refMissingInLayer += 1;
  if (p.status === 'matched' && p.unitId === ref) { agree += 1; return; }
  const refFeature = byId.get(ref);
  divergences.push({
    line: p.line,
    id: p.id,
    status: p.status,
    calculado: p.unitId ?? (p.candidates.join('/') || '—'),
    referencia: ref,
    distLimiteRefM: refFeature ? distanceToBoundaryM(p.lng, p.lat, refFeature.geometry) : null,
    lat: p.lat,
    lng: p.lng,
  });
});

const pct = (n) => ((n / result.points.length) * 100).toFixed(1);
console.log(`\nComparação com "${refColumn}": ${agree} de ${result.points.length} pontos válidos concordam (${pct(agree)}%).`);
console.log(`Divergências: ${divergences.length} | referência inexistente na camada: ${refMissingInLayer}`);
divergences.forEach((d) => {
  console.log(`  linha ${d.line} id ${d.id}: ${d.status}; calculado ${d.calculado}; referência ${d.referencia}; `
    + `distância ao limite do setor de referência: ${d.distLimiteRefM == null ? 'n/d' : `${d.distLimiteRefM.toFixed(1)} m`}; (${d.lat}, ${d.lng})`);
});
