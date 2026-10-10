#!/usr/bin/env node
/**
 * Gera um CSV de TESTE a partir do CNEFE 2022 (IBGE), com pontos reais e
 * públicos de estabelecimentos agropecuários (COD_ESPECIE = 3).
 *
 * NÃO são clientes nem equipamentos da Energisa. O arquivo serve para testar
 * o cruzamento com coordenadas reais enquanto o CSV da engenharia não chega.
 *
 * Fonte: https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/
 * Referencial: SIRGAS 2000 (EPSG:4674), conforme o "crs" do GeoJSON oficial do CNEFE.
 *
 * Uso:
 *   node scripts/gerar_teste_cnefe.mjs <CNEFE_municipio.csv> <saida.csv> [--centro lat,lng --raio-km N]
 *
 * Colunas geradas (separador ";"):
 *   id                    COD_UNICO_ENDERECO
 *   latitude, longitude   coordenadas do CNEFE, sem alteração
 *   localidade_cnefe      DSC_LOCALIDADE (localidade do endereço segundo o Censo)
 *   setor_ibge_cnefe      COD_SETOR atribuído pelo IBGE (15 dígitos), usado como referência
 *   nivel_geocodificacao  NV_GEO_COORD (1 = coordenada original do Censo 2022)
 *
 * Por privacidade, DSC_ESTABELECIMENTO (pode conter nome de pessoa) e o
 * logradouro NÃO são copiados.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv } from '../src/lib/csv.js';

const args = process.argv.slice(2);
const [input, output] = args;
if (!input || !output) {
  console.error('Uso: node scripts/gerar_teste_cnefe.mjs <CNEFE_municipio.csv> <saida.csv> [--centro lat,lng --raio-km N]');
  process.exit(1);
}
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const centro = opt('--centro')?.split(',').map(Number) ?? null;
const raioKm = opt('--raio-km') ? Number(opt('--raio-km')) : null;

const { headers, rows } = parseCsv(readFileSync(input, 'utf-8'));
const col = Object.fromEntries(headers.map((h, i) => [h, i]));
['COD_UNICO_ENDERECO', 'LATITUDE', 'LONGITUDE', 'COD_ESPECIE', 'COD_SETOR', 'DSC_LOCALIDADE', 'NV_GEO_COORD'].forEach((c) => {
  if (!(c in col)) throw new Error(`Coluna ausente no CNEFE: ${c}`);
});

/** Distância geodésica aproximada (haversine), em km. */
const distKm = (lat1, lng1, lat2, lng2) => {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(a));
};

const agro = rows.filter((r) => r[col.COD_ESPECIE] === '3');
const selected = agro.filter((r) => {
  if (!centro || !raioKm) return true;
  return distKm(centro[0], centro[1], Number(r[col.LATITUDE]), Number(r[col.LONGITUDE])) <= raioKm;
});

const out = ['id;latitude;longitude;localidade_cnefe;setor_ibge_cnefe;nivel_geocodificacao'];
selected.forEach((r) => {
  out.push([
    r[col.COD_UNICO_ENDERECO], r[col.LATITUDE], r[col.LONGITUDE],
    r[col.DSC_LOCALIDADE], r[col.COD_SETOR].slice(0, 15), r[col.NV_GEO_COORD],
  ].join(';'));
});
writeFileSync(output, `${out.join('\r\n')}\r\n`, 'utf-8');
console.log(`Registros no CNEFE: ${rows.length} | agropecuários: ${agro.length} | exportados: ${selected.length}`
  + (centro ? ` (raio de ${raioKm} km de ${centro.join(', ')})` : ''));
