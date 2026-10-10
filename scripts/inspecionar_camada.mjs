#!/usr/bin/env node
/**
 * Inspeciona um GeoJSON de camada territorial antes de usá-lo no piloto.
 *
 * Uso: node scripts/inspecionar_camada.mjs <arquivo.geojson> [campo_id=CD_SETOR] [campo_nome]
 *
 * Mostra: quantidade de feições, tipos de geometria, atributos disponíveis,
 * caixa envolvente, unicidade do identificador e valores distintos de campos
 * de hierarquia (município, distrito...). Usa a mesma validação da aplicação
 * (src/lib/layer.js). Lê apenas a camada pública do IBGE, nunca dados de clientes.
 */
import { readFileSync, statSync } from 'node:fs';
import { validateLayer } from '../src/lib/layer.js';

const [file, idField = 'CD_SETOR', nameField = null] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/inspecionar_camada.mjs <arquivo.geojson> [campo_id] [campo_nome]');
  process.exit(1);
}

const sizeMb = statSync(file).size / 1024 / 1024;
const geojson = JSON.parse(readFileSync(file, 'utf-8'));
const result = validateLayer(geojson, { idField, codeField: idField, nameField });

console.log(`Arquivo: ${file} (${sizeMb.toFixed(2)} MB)`);
console.log(`Feições: ${result.stats.features} | Polygon: ${result.stats.polygons} | MultiPolygon: ${result.stats.multiPolygons} | ignoradas: ${result.stats.skipped}`);
console.log(`Atributos: ${result.stats.attributes.join(', ')}`);

const HIERARCHY = ['CD_MUN', 'NM_MUN', 'CD_DIST', 'NM_DIST', 'CD_SUBDIST', 'NM_SUBDIST', 'SITUACAO', 'CD_SIT', 'NM_NU', 'NM_AGLOM', 'NM_BAIRRO'];
HIERARCHY.filter((k) => result.stats.attributes.includes(k)).forEach((k) => {
  const values = new Map();
  geojson.features.forEach((f) => {
    const v = f.properties?.[k] ?? '(vazio)';
    values.set(v, (values.get(v) ?? 0) + 1);
  });
  const list = [...values.entries()].sort((a, b) => b[1] - a[1]);
  const shown = list.slice(0, 12).map(([v, n]) => `${v} (${n})`).join('; ');
  console.log(`  ${k}: ${list.length} valor(es) distinto(s) → ${shown}${list.length > 12 ? '; …' : ''}`);
});

if (result.layer) {
  const [[s, w], [n, e]] = result.layer.bounds;
  console.log(`Caixa envolvente (lat/lng): S ${s.toFixed(5)} O ${w.toFixed(5)} N ${n.toFixed(5)} L ${e.toFixed(5)}`);
}
result.warnings.slice(0, 10).forEach((w) => console.log(`AVISO: ${w}`));
result.errors.slice(0, 20).forEach((e) => console.log(`ERRO: ${e}`));
console.log(result.ok ? 'Resultado: camada utilizável pela aplicação.' : 'Resultado: camada RECUSADA. Corrija os erros acima.');
if (sizeMb > 15) console.log('Atenção: arquivo grande para o navegador; avalie uma versão de exibição simplificada (docs/CAMADA_TERRITORIAL.md).');
process.exit(result.ok ? 0 : 2);
