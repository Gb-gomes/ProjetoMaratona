#!/usr/bin/env node
/**
 * Prepara a hierarquia territorial oficial do IBGE usada como "região-mãe"
 * das sub-regiões: UF → Região Geográfica Intermediária → Região Geográfica
 * Imediata → Municípios da Imediata do município piloto.
 *
 * Fonte: Malha Municipal 2022 do IBGE (Shapefile por UF, SIRGAS 2000 geográfico),
 * a mesma base da Malha de Setores Censitários do Censo 2022 usada na camada piloto.
 *   https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/UFs/<UF>/
 * A lista de municípios da Imediata vem da API de localidades do IBGE.
 *
 * Uso (a partir da raiz do projeto):
 *   node scripts/preparar_hierarquia_ibge.mjs [UF=MG] [CD_MUN=3115300]
 *   node scripts/preparar_hierarquia_ibge.mjs --lista scripts/ibge/municipios_energisa_mr.txt
 *
 * Com --lista, os municípios vêm de um arquivo (um código IBGE por linha; '#' é comentário),
 * podendo ser de mais de uma UF; entram as UFs, Intermediárias e Imediatas desses municípios.
 *
 * O que faz:
 *   1. Baixa os ZIPs oficiais para scripts/ibge/raw/hierarquia/ (ignorado pelo git), se ainda não existirem.
 *   2. Registra SHA-256, URL e data de cada arquivo.
 *   3. Recorta só as unidades da hierarquia do município piloto.
 *   4. Municípios e Imediata: geometria integral (sem simplificação).
 *      UF e Intermediária: simplificação Douglas-Peucker de ~5 m (SIMPLIFY_M), muito
 *      abaixo da tolerância de contenção das sub-regiões (50 m).
 *   5. Grava public/data/ibge/hierarquia_piloto.geojson (+ .origem.json).
 *   6. Compara o limite municipal do piloto com a união dos setores censitários
 *      (camada_piloto.geojson) e informa a diferença.
 *
 * SIRGAS 2000 (EPSG:4674) é gravado como EPSG:4326 sem transformação, como faz o ogr2ogr.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { parseShp, parseDbf } from 'shpjs';
import area from '@turf/area';
import union from '@turf/union';
import difference from '@turf/difference';
import { featureCollection, feature } from '@turf/helpers';

const LISTA = process.argv[2] === '--lista' ? process.argv[3] : null;
const UF = LISTA ? null : (process.argv[2] ?? 'MG').toUpperCase();
const CD_MUN = (LISTA ? null : process.argv[3]) ?? '3115300';
const RAW = 'scripts/ibge/raw/hierarquia';
const OUT = 'public/data/ibge/hierarquia_piloto.geojson';
const ORIGEM = 'public/data/ibge/hierarquia_piloto.origem.json';
const SECTORS = 'public/data/ibge/camada_piloto.geojson';
const baseFor = (uf) => `https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/UFs/${uf}`;
const API = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const SIMPLIFY_M = 5;
const DIST_SIMPLIFY_M = 2;
const DIST_BASE = `https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/distritos/shp/UF`;
const DIST_OUT = 'public/data/ibge/distritos_piloto.geojson';
const DECIMALS = 7;

mkdirSync(RAW, { recursive: true });

const download = (uf, name) => downloadFrom(baseFor(uf), name);

async function downloadFrom(base, name) {
  const path = `${RAW}/${name}`;
  if (!existsSync(path)) {
    const res = await fetch(`${base}/${name}`);
    if (!res.ok) throw new Error(`Falha ao baixar ${name}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(path);
  return {
    buf,
    meta: {
      arquivo: name, url: `${base}/${name}`, tamanhoBytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
    },
  };
}

function readShapefile(buf) {
  const zip = unzipSync(buf);
  const shpName = Object.keys(zip).find((k) => k.toLowerCase().endsWith('.shp'));
  const base = shpName.slice(0, -4);
  const prj = zip[`${base}.prj`] ? strFromU8(zip[`${base}.prj`]) : '';
  if (!/GEOGCS\["GCS_SIRGAS_2000"/.test(prj) || /PROJCS/.test(prj)) {
    throw new Error(`Referencial inesperado em ${shpName}: ${prj.slice(0, 120)}`);
  }
  const geoms = parseShp(zip[shpName]);
  const props = parseDbf(zip[`${base}.dbf`], zip[`${base}.cpg`]);
  return geoms.map((g, i) => ({ geometry: g, properties: props[i] }));
}

/* Douglas-Peucker em metros (projeção equiretangular local). */
function simplifyRing(ring, tolM) {
  if (ring.length <= 8) return ring;
  const lat0 = (ring[0][1] * Math.PI) / 180;
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;
  const pts = ring.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i += 1) {
      const [px, py] = pts[i];
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolM && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const round = (n) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
const vertexCount = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat().reduce((s, r) => s + r.length, 0);

function normalizeGeometry(g, simplify, tolM = SIMPLIFY_M) {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const coordinates = polys.map((poly) => poly.map((ring) => {
    const r = simplify ? simplifyRing(ring, tolM) : ring;
    return r.map(([x, y]) => [round(x), round(y)]);
  }));
  return coordinates.length === 1 ? { type: 'Polygon', coordinates: coordinates[0] } : { type: 'MultiPolygon', coordinates };
}

const asList = (x) => (Array.isArray(x) ? x : [x]);

/** Municípios a incluir: os da Imediata do piloto ou os do arquivo --lista (objetos da API de localidades). */
async function municipalityList() {
  if (LISTA) {
    const codes = readFileSync(LISTA, 'utf8').split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean).map((l) => l.split(/\s+/)[0]);
    const list = asList(await (await fetch(`${API}/municipios/${codes.join('|')}`)).json());
    const found = new Set(list.map((m) => String(m.id)));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) throw new Error(`Códigos não encontrados na API do IBGE: ${missing.join(', ')}`);
    console.log(`Lista ${LISTA}: ${list.length} municípios`);
    return { list, origemLista: { listaMunicipios: LISTA, api: `${API}/municipios/<códigos da lista>` } };
  }
  const mun = await (await fetch(`${API}/municipios/${CD_MUN}`)).json();
  const rgi = mun['regiao-imediata'];
  const rgint = rgi['regiao-intermediaria'];
  console.log(`Piloto ${mun.nome} (${CD_MUN}) → Imediata ${rgi.nome} (${rgi.id}) → Intermediária ${rgint.nome} (${rgint.id}) → ${rgint.UF.sigla}`);
  if (rgint.UF.sigla !== UF) throw new Error(`O município ${CD_MUN} é de ${rgint.UF.sigla}, não de ${UF}.`);
  const list = await (await fetch(`${API}/regioes-imediatas/${rgi.id}/municipios`)).json();
  return {
    list,
    origemLista: { listaMunicipiosImediata: `${API}/regioes-imediatas/${rgi.id}/municipios` },
    piloto: { municipio: mun.nome, CD_MUN, imediata: { code: String(rgi.id), name: rgi.nome }, intermediaria: { code: String(rgint.id), name: rgint.nome }, uf: rgint.UF.sigla },
  };
}

async function main() {
  const { list: munList, origemLista, piloto } = await municipalityList();
  const rgiOf = new Map(munList.map((m) => [String(m.id), m['regiao-imediata']]));
  // agrupa por UF: cada UF tem seus próprios arquivos de malha no IBGE
  const byUf = new Map();
  munList.forEach((m) => {
    const rgi = m['regiao-imediata'];
    const rgint = rgi['regiao-intermediaria'];
    const sigla = rgint.UF.sigla;
    if (!byUf.has(sigla)) byUf.set(sigla, { uf: rgint.UF, rgints: new Map(), rgis: new Map(), muns: new Set() });
    const u = byUf.get(sigla);
    u.rgints.set(String(rgint.id), String(rgint.UF.id));
    u.rgis.set(String(rgi.id), String(rgint.id));
    u.muns.add(String(m.id));
  });
  const munCodes = new Set(rgiOf.keys());

  const features = [];
  const districts = [];
  const metas = [];
  const add = (level, rows, codeField, nameField, filter, parentOf, simplify) => {
    rows.filter((r) => filter(String(r.properties[codeField]))).forEach((r) => {
      const geometry = normalizeGeometry(r.geometry, simplify);
      console.log(`  ${level} ${r.properties[codeField]} ${r.properties[nameField]}: ${vertexCount(r.geometry)} → ${vertexCount(geometry)} vértices`);
      features.push({
        type: 'Feature',
        properties: {
          code: String(r.properties[codeField]),
          name: r.properties[nameField],
          level,
          parentCode: parentOf(r.properties),
          areaKm2Oficial: r.properties.AREA_KM2 ?? null,
          ...(level === 'uf' ? { sigla: r.properties.SIGLA_UF ?? null } : {}),
        },
        geometry,
      });
    });
  };

  for (const [sigla, u] of byUf) {
    const files = {
      uf: await download(sigla, `${sigla}_UF_2022.zip`),
      intermediaria: await download(sigla, `${sigla}_RG_Intermediarias_2022.zip`),
      imediata: await download(sigla, `${sigla}_RG_Imediatas_2022.zip`),
      municipio: await download(sigla, `${sigla}_Municipios_2022.zip`),
    };
    add('uf', readShapefile(files.uf.buf), 'CD_UF', 'NM_UF', (c) => c === String(u.uf.id), () => null, true);
    add('intermediaria', readShapefile(files.intermediaria.buf), 'CD_RGINT', 'NM_RGINT', (c) => u.rgints.has(c), (p) => u.rgints.get(String(p.CD_RGINT)), true);
    add('imediata', readShapefile(files.imediata.buf), 'CD_RGI', 'NM_RGI', (c) => u.rgis.has(c), (p) => u.rgis.get(String(p.CD_RGI)), false);
    add('municipio', readShapefile(files.municipio.buf), 'CD_MUN', 'NM_MUN', (c) => u.muns.has(c), (p) => String(rgiOf.get(String(p.CD_MUN)).id), false);

    // Distritos (Malha de Distritos do Censo 2022) dos municípios, em arquivo próprio.
    // Simplificação de DIST_SIMPLIFY_M: bem abaixo da tolerância de 100 m do serviço de nomes.
    const distFile = await downloadFrom(DIST_BASE, `${sigla}_distritos_CD2022.zip`);
    readShapefile(distFile.buf)
      .filter((r) => u.muns.has(String(r.properties.CD_MUN)))
      .forEach((r) => districts.push({
        type: 'Feature',
        properties: {
          code: String(r.properties.CD_DIST),
          name: r.properties.NM_DIST,
          level: 'distrito',
          parentCode: String(r.properties.CD_MUN),
          // No IBGE, o distrito-sede do município tem o código terminado em 05.
          sede: String(r.properties.CD_DIST).endsWith('05'),
        },
        geometry: normalizeGeometry(r.geometry, true, DIST_SIMPLIFY_M),
      }));
    metas.push(...Object.values(files).map((f) => f.meta), distFile.meta);
  }

  if (features.filter((f) => f.properties.level === 'municipio').length !== munCodes.size) {
    throw new Error('Nem todos os municípios foram encontrados na malha.');
  }

  writeFileSync(OUT, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`);
  writeFileSync(DIST_OUT, `${JSON.stringify({ type: 'FeatureCollection', features: districts })}\n`);
  console.log(`Gravado ${DIST_OUT} (${districts.length} distritos).`);

  // Conferência: limite municipal do piloto × união dos setores censitários.
  let conferencia = null;
  const munFeature = features.find((f) => f.properties.code === CD_MUN);
  if (existsSync(SECTORS) && munFeature) {
    const sectors = JSON.parse(readFileSync(SECTORS, 'utf8'));
    const sectorUnion = union(featureCollection(sectors.features.map((f) => feature(f.geometry))));
    const munGeom = munFeature.geometry;
    const outside = difference(featureCollection([sectorUnion, feature(munGeom)]));
    const missing = difference(featureCollection([feature(munGeom), sectorUnion]));
    conferencia = {
      areaMunicipioKm2: +(area(feature(munGeom)) / 1e6).toFixed(3),
      areaSetoresKm2: +(area(sectorUnion) / 1e6).toFixed(3),
      setoresForaDoMunicipioM2: Math.round(outside ? area(outside) : 0),
      municipioSemSetorM2: Math.round(missing ? area(missing) : 0),
    };
    console.log('Conferência setores × município:', conferencia);
  }

  writeFileSync(ORIGEM, `${JSON.stringify({
    fonte: 'IBGE — Malha Municipal 2022 (Shapefile por UF)',
    arquivos: metas,
    ...origemLista,
    dataObtencao: new Date().toISOString().slice(0, 10),
    crsOrigem: 'GCS_SIRGAS_2000 (geográfico) — gravado como EPSG:4326 sem transformação',
    ...(piloto ? { piloto } : {}),
    ufs: [...byUf.keys()],
    municipios: munCodes.size,
    simplificacao: `UF e Intermediária: Douglas-Peucker ${SIMPLIFY_M} m. Imediata e municípios: sem simplificação.`,
    conferenciaSetores: conferencia,
    feicoes: features.length,
  }, null, 2)}\n`);
  console.log(`Gravado ${OUT} (${features.length} feições).`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
