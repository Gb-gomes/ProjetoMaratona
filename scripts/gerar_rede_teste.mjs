#!/usr/bin/env node
/**
 * Gera uma rede elétrica FICTÍCIA para testar a importação de camadas grandes.
 * Nada aqui é dado real: as linhas são passeios aleatórios em torno de Cataguases (MG).
 *
 * Saída (Shapefile compactado, SIRGAS 2000 / UTM zona 23S — EPSG:31983, com .prj):
 *   dados/rede_teste/rede_teste_postes.zip        500.000 pontos (postes e transformadores)
 *   dados/rede_teste/rede_teste_linhas.zip        linhas de média e baixa tensão (campo TENSAO)
 *   dados/rede_teste/rede_teste_subestacoes.zip   subestações
 *
 * Uso: node scripts/gerar_rede_teste.mjs [quantidade_de_postes=500000]
 * A pasta dados/ é ignorada pelo git.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import proj4 from 'proj4';

const N_POSTES = Number(process.argv[2] ?? 500000);
const OUT = 'dados/rede_teste';
const UTM23S = '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const PRJ = 'PROJCS["SIRGAS_2000_UTM_Zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
const toUtm = proj4('EPSG:4326', UTM23S);

// Gerador pseudoaleatório com semente fixa (resultado reproduzível).
let seed = 20221;
const rand = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------------- Escrita de Shapefile (pontos e polilinhas) ---------------- */
function shpHeader(view, shapeType, fileBytes, [minX, minY, maxX, maxY]) {
  view.setInt32(0, 9994, false);
  view.setInt32(24, fileBytes / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  view.setFloat64(36, minX, true); view.setFloat64(44, minY, true);
  view.setFloat64(52, maxX, true); view.setFloat64(60, maxY, true);
}

function writeShp(shapeType, geoms) {
  const contentLen = geoms.map((g) => (shapeType === 1 ? 20 : 44 + 4 + g.length * 16));
  const shpBytes = 100 + contentLen.reduce((s, c) => s + 8 + c, 0);
  const shp = new DataView(new ArrayBuffer(shpBytes));
  const shx = new DataView(new ArrayBuffer(100 + geoms.length * 8));
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  geoms.flat(shapeType === 1 ? 0 : 1).forEach((p) => {
    const [x, y] = shapeType === 1 ? p : p;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  });
  const bbox = [minX, minY, maxX, maxY];
  shpHeader(shp, shapeType, shpBytes, bbox);
  shpHeader(shx, shapeType, 100 + geoms.length * 8, bbox);
  let off = 100;
  geoms.forEach((g, i) => {
    shx.setInt32(100 + i * 8, off / 2, false);
    shx.setInt32(104 + i * 8, contentLen[i] / 2, false);
    shp.setInt32(off, i + 1, false);
    shp.setInt32(off + 4, contentLen[i] / 2, false);
    const c = off + 8;
    shp.setInt32(c, shapeType, true);
    if (shapeType === 1) {
      shp.setFloat64(c + 4, g[0], true);
      shp.setFloat64(c + 12, g[1], true);
    } else {
      const xs = g.map((p) => p[0]); const ys = g.map((p) => p[1]);
      shp.setFloat64(c + 4, Math.min(...xs), true); shp.setFloat64(c + 12, Math.min(...ys), true);
      shp.setFloat64(c + 20, Math.max(...xs), true); shp.setFloat64(c + 28, Math.max(...ys), true);
      shp.setInt32(c + 36, 1, true);
      shp.setInt32(c + 40, g.length, true);
      shp.setInt32(c + 44, 0, true);
      g.forEach(([x, y], k) => { shp.setFloat64(c + 48 + k * 16, x, true); shp.setFloat64(c + 56 + k * 16, y, true); });
    }
    off += 8 + contentLen[i];
  });
  return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
}

function writeDbf(fields, rows) {
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const headLen = 32 + fields.length * 32 + 1;
  const buf = new Uint8Array(headLen + rows.length * recLen + 1);
  const view = new DataView(buf.buffer);
  const now = new Date();
  buf[0] = 0x03; buf[1] = now.getFullYear() - 1900; buf[2] = now.getMonth() + 1; buf[3] = now.getDate();
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headLen, true);
  view.setUint16(10, recLen, true);
  fields.forEach((f, i) => {
    const o = 32 + i * 32;
    buf.set(strToU8(f.name.padEnd(11, '\0').slice(0, 11)), o);
    buf[o + 11] = f.type.charCodeAt(0);
    buf[o + 16] = f.len;
    buf[o + 17] = f.dec ?? 0;
  });
  buf[headLen - 1] = 0x0d;
  rows.forEach((row, r) => {
    let o = headLen + r * recLen;
    buf[o] = 0x20; o += 1;
    fields.forEach((f) => {
      const raw = String(row[f.name] ?? '');
      const s = f.type === 'N' ? raw.padStart(f.len, ' ').slice(-f.len) : raw.padEnd(f.len, ' ').slice(0, f.len);
      buf.set(strToU8(s), o);
      o += f.len;
    });
  });
  buf[buf.length - 1] = 0x1a;
  return buf;
}

function saveZip(name, shapeType, geoms, fields, rows) {
  const { shp, shx } = writeShp(shapeType, geoms);
  const zip = zipSync({
    [`${name}.shp`]: shp, [`${name}.shx`]: shx, [`${name}.dbf`]: writeDbf(fields, rows), [`${name}.prj`]: strToU8(PRJ), [`${name}.cpg`]: strToU8('UTF-8'),
  }, { level: 6 });
  writeFileSync(`${OUT}/${name}.zip`, zip);
  console.log(`${OUT}/${name}.zip — ${geoms.length.toLocaleString('pt-BR')} feições, ${(zip.length / 1e6).toFixed(1)} MB`);
}

/* ---------------- Rede fictícia ---------------- */
mkdirSync(OUT, { recursive: true });
const AREA = { w: -42.85, e: -42.45, s: -21.48, n: -21.18 };
const FEEDERS = 12;
const subestacoes = Array.from({ length: 6 }, (_, i) => ({
  ll: [AREA.w + 0.06 + rand() * (AREA.e - AREA.w - 0.12), AREA.s + 0.05 + rand() * (AREA.n - AREA.s - 0.1)], nome: `SE TESTE ${i + 1}`,
}));

function walk(start, steps, stepM) {
  const pts = [start];
  let ang = rand() * Math.PI * 2;
  let [x, y] = start;
  for (let i = 0; i < steps; i += 1) {
    ang += (rand() - 0.5) * 0.6;
    x += (Math.cos(ang) * stepM) / (111320 * Math.cos((y * Math.PI) / 180));
    y += (Math.sin(ang) * stepM) / 110540;
    x = Math.min(AREA.e, Math.max(AREA.w, x));
    y = Math.min(AREA.n, Math.max(AREA.s, y));
    pts.push([x, y]);
  }
  return pts;
}

const lines = [];
for (let i = 0; i < 480; i += 1) {
  const se = subestacoes[i % subestacoes.length];
  lines.push({ pts: walk(se.ll, 40 + Math.floor(rand() * 60), 120), tensao: i % 4 === 0 ? '34.5 kV' : '13.8 kV', alim: `CAT${String((i % FEEDERS) + 1).padStart(2, '0')}` });
}
const mt = lines.slice();
for (let i = 0; i < 5200; i += 1) {
  const parent = mt[Math.floor(rand() * mt.length)];
  const start = parent.pts[Math.floor(rand() * parent.pts.length)];
  lines.push({ pts: walk(start, 3 + Math.floor(rand() * 6), 60), tensao: '0.22 kV', alim: parent.alim });
}

const segLen = (a, b) => Math.hypot((b[0] - a[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * 110540);
const totalLen = lines.reduce((s, l) => s + l.pts.slice(1).reduce((t, p, k) => t + segLen(l.pts[k], p), 0), 0);
const spacing = totalLen / N_POSTES;

const postes = [];
const posteRows = [];
for (const l of lines) {
  let carry = 0;
  for (let k = 1; k < l.pts.length && postes.length < N_POSTES; k += 1) {
    const a = l.pts[k - 1]; const b = l.pts[k];
    const d = segLen(a, b);
    let t = carry;
    while (t < d && postes.length < N_POSTES) {
      const f = t / d;
      postes.push(toUtm.forward([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]));
      const n = postes.length;
      posteRows.push({
        ID: n, TIPO: n % 25 === 0 ? 'TRANSFORMADOR' : 'POSTE', TENSAO: l.tensao, ALIMENT: l.alim, ALTURA_M: (9 + (n % 4) * 1.5).toFixed(1),
      });
      t += spacing;
    }
    carry = t - d;
  }
}
while (postes.length < N_POSTES) {
  const l = lines[postes.length % lines.length];
  postes.push(toUtm.forward(l.pts[0]));
  posteRows.push({ ID: postes.length, TIPO: 'POSTE', TENSAO: l.tensao, ALIMENT: l.alim, ALTURA_M: '9.0' });
}

saveZip('rede_teste_postes', 1, postes, [
  { name: 'ID', type: 'N', len: 9 }, { name: 'TIPO', type: 'C', len: 14 }, { name: 'TENSAO', type: 'C', len: 8 },
  { name: 'ALIMENT', type: 'C', len: 6 }, { name: 'ALTURA_M', type: 'N', len: 5, dec: 1 },
], posteRows);
saveZip('rede_teste_linhas', 3, lines.map((l) => l.pts.map((p) => toUtm.forward(p))), [
  { name: 'ID', type: 'N', len: 7 }, { name: 'TENSAO', type: 'C', len: 8 }, { name: 'ALIMENT', type: 'C', len: 6 },
], lines.map((l, i) => ({ ID: i + 1, TENSAO: l.tensao, ALIMENT: l.alim })));
saveZip('rede_teste_subestacoes', 1, subestacoes.map((s) => toUtm.forward(s.ll)), [
  { name: 'ID', type: 'N', len: 3 }, { name: 'NOME', type: 'C', len: 20 },
], subestacoes.map((s, i) => ({ ID: i + 1, NOME: s.nome })));
console.log(`Rede fictícia: ${(totalLen / 1000).toFixed(0)} km de linhas; postes a cada ${spacing.toFixed(1)} m.`);
