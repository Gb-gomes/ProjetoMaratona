import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseXlsx, tableFromRows, detectHeaderRow, readPointsFile } from '../spreadsheet.js';
import { createFarmIndex, nameCore, normalizeCar } from '../farmIndex.js';
import { parseCsv, suggestMapping, validateRecords } from '../csv.js';
import { withManualPoints, isManualLine, lineLabel } from '../manualPoints.js';
import { parseLatLngText } from '../coords.js';
import { parseHierarchy } from '../ibgeHierarchy.js';
import { parseCommunityFile, importCommunities } from '../communities.js';
import { createPlaceLocator } from '../placeNames.js';
import { placeJoin } from '../placeJoin.js';
import { spatialJoin } from '../spatialJoin.js';
import { attachPlaces } from '../summary.js';
import { groupByPlace } from '../placeRegions.js';
import { validateLayer } from '../layer.js';
import { PILOT_CONFIG } from '../../config.js';

/* ---------------- Excel montado em memória ---------------- */
function makeXlsx(sheets) {
  const shared = [];
  const sIdx = (s) => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const col = (i) => String.fromCharCode(65 + i);
  const files = {};
  sheets.forEach((sh, n) => {
    const rows = sh.rows.map((r, ri) => `<row r="${ri + 1 + (sh.offset ?? 0)}">${r.map((v, ci) => {
      if (v == null || v === '') return '';
      const ref = `${col(ci)}${ri + 1 + (sh.offset ?? 0)}`;
      return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${n + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`);
  });
  files['xl/workbook.xml'] = strToU8(`<workbook><sheets>${sheets.map((s, n) => `<sheet name="${s.name}" sheetId="${n + 1}" r:id="rId${n + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<Relationships>${sheets.map((_, n) => `<Relationship Id="rId${n + 1}" Target="worksheets/sheet${n + 1}.xml"/>`).join('')}</Relationships>`);
  files['xl/sharedStrings.xml'] = strToU8(`<sst>${shared.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`);
  return zipSync(files);
}
const fakeFile = (name, bytes) => ({ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });

describe('planilha Excel', () => {
  it('lê abas, textos compartilhados, números e células vazias', () => {
    const bytes = makeXlsx([{ name: 'Pontos', rows: [['id', 'latitude', 'longitude'], ['A&B', -21.390448000000001, -42.55], ['C', '', -42.6]] }]);
    const [sheet] = parseXlsx(bytes);
    expect(sheet.name).toBe('Pontos');
    expect(sheet.rows[1]).toEqual(['A&B', '-21.390448', '-42.55']);
    expect(sheet.rows[2]).toEqual(['C', '', '-42.6']);
  });

  it('ignora título acima da tabela e escolhe a aba com os pontos', async () => {
    const bytes = makeXlsx([
      { name: 'Capa', rows: [['Desligamento programado'], ['Ordem 123']] },
      { name: 'Clientes', rows: [['Relação de clientes afetados'], [], ['UC', 'Código CAR', 'Fazenda'], ['111', 'MG-3115300-0030.E8D1.8E59.417D.AEFC.B2F0.2C0A.1C85', 'Sítio Jaboticabeira']] },
    ]);
    const book = await readPointsFile(fakeFile('desligamento.xlsx', bytes));
    expect(book.format).toBe('xlsx');
    expect(book.sheets[book.sheetIndex].name).toBe('Clientes');
    const { table } = book.sheets[book.sheetIndex];
    expect(table.headers).toEqual(['UC', 'Código CAR', 'Fazenda']);
    expect(table.headerLine).toBe(3);
    expect(table.rowLines).toEqual([4]);
    expect(suggestMapping(table.headers)).toMatchObject({ client: 0, car: 1, property: 2 });
  });

  it('.xls antigo: pede para salvar como .xlsx ou CSV', async () => {
    await expect(readPointsFile(fakeFile('a.xls', new Uint8Array([0xd0, 0xcf])))).rejects.toThrow(/xlsx/);
  });

  it('cabeçalho: primeira linha com a maioria das colunas', () => {
    expect(detectHeaderRow([['Título'], ['a', 'b', 'c'], ['1', '2', '3']])).toBe(1);
    expect(tableFromRows([['id', 'lat'], ['1', '2']], [1, 2]).headers).toEqual(['id', 'lat']);
  });
});

/* ---------------- Índice de fazendas ---------------- */
const RAW = {
  municipios: { 3115300: 'Cataguases', 3138401: 'Leopoldina' },
  campos: ['id', 'mun', 'nome', 'car', 'incra', 'lat', 'lon', 'trafos', 'carRep'],
  fazendas: [
    ['00001', '3115300', 'Sitio Jaboticabeira', '0030E8D18E59417DAEFCB2F02C0A1C85', '4450370028524', -21.390473, -42.552061, '32842557', ''],
    ['00002', '3115300', 'Fazenda Boa Vista', 'AAAA', '', -21.30, -42.60, '900, 901', ''],
    ['00003', '3138401', 'Fazenda Boa Vista', 'BBBB', '', -21.50, -42.65, '901', ''],
    ['00004', '3115300', '', 'CCCC', '', -21.31, -42.61, '', 'MG-3115300-DDDD'],
  ],
};
const farms = createFarmIndex(RAW);

describe('índice de fazendas', () => {
  it('acha pelo CAR com ou sem pontos, pelo CAR repetido, pelo INCRA e pelo ID', () => {
    expect(farms.find({ car: 'MG-3115300-0030.E8D1.8E59.417D.AEFC.B2F0.2C0A.1C85' }).farm.nome).toBe('Sitio Jaboticabeira');
    expect(farms.find({ car: 'mg-3115300-dddd' }).farm.id).toBe('3115300-00004');
    expect(farms.find({ incra: '445.037.002.852-4' }).farm.id).toBe('3115300-00001');
    expect(farms.find({ catalogId: '3115300-00002' }).method).toBe('catalogo');
  });

  it('nome: precisa do município quando se repete; aceita sem "Fazenda" e sem acento', () => {
    const amb = farms.find({ property: 'Fazenda Boa Vista' });
    expect(amb.farm).toBeNull();
    expect(amb.candidates).toHaveLength(2);
    expect(farms.find({ property: 'boa vista', municipality: 'Leopoldina/MG' }).farm.id).toBe('3138401-00003');
    expect(farms.find({ property: 'Sítio Jaboticabeira', municipality: '3115300' }).farm.id).toBe('3115300-00001');
    expect(nameCore('Fazenda da Contenda')).toBe('contenda');
  });

  it('transformador só identifica quando atende uma fazenda', () => {
    expect(farms.find({ equipment: '32842557' }).farm.id).toBe('3115300-00001');
    expect(farms.find({ equipment: '901' }).farm).toBeNull();
    expect(farms.find({ equipment: '901', municipality: 'Leopoldina' }).farm.id).toBe('3138401-00003');
  });

  it('fazenda mais próxima de uma coordenada', () => {
    expect(farms.nearest(-21.3906, -42.5521, 500).farm.id).toBe('3115300-00001');
    expect(farms.nearest(-20, -40, 500)).toBeNull();
    expect(normalizeCar(' mg-1.2 ')).toBe('MG-12');
  });
});

/* ---------------- Validação amarrada à fazenda ---------------- */
describe('validação com o catálogo de fazendas', () => {
  const validate = (text, opts) => {
    const parsed = parseCsv(text);
    return validateRecords(parsed, suggestMapping(parsed.headers), opts);
  };

  it('linha sem coordenada recebe o ponto da fazenda; não achada ou ambígua vira erro com motivo', () => {
    const v = validate([
      'uc;car;fazenda;municipio',
      '1;MG-3115300-0030E8D18E59417DAEFCB2F02C0A1C85;;',
      '2;;Fazenda Boa Vista;',
      '3;;Fazenda Boa Vista;Leopoldina',
      '4;MG-3115300-NAOEXISTE;;',
    ].join('\n'), { farms });
    const [a, b, c, d] = v.records;
    expect(a).toMatchObject({ status: 'valid', coordOrigin: 'fazenda', lat: -21.390473, property: 'Sitio Jaboticabeira' });
    expect(b.issues[0].code).toBe('farm-ambiguous');
    expect(b.issues[0].message).toMatch(/2 fazendas possíveis/);
    expect(c).toMatchObject({ status: 'valid', coordOrigin: 'fazenda', lng: -42.65 });
    expect(d.issues[0].code).toBe('farm-not-found');
    expect(v.fromFarm).toBe(2);
  });

  it('linha com coordenada: a fazenda só confere (longe = alerta, vale o arquivo)', () => {
    const v = validate([
      'id;lat;lon;car',
      'perto;-21,3905;-42,5521;MG-3115300-0030E8D18E59417DAEFCB2F02C0A1C85',
      'longe;-21,10;-42,90;MG-3115300-0030E8D18E59417DAEFCB2F02C0A1C85',
    ].join('\n'), { farms });
    expect(v.records[0]).toMatchObject({ status: 'valid', coordOrigin: 'arquivo', issues: [] });
    expect(v.records[1].issues.map((i) => i.code)).toContain('farm-far');
    expect(v.records[1].lat).toBeCloseTo(-21.1);
    expect(v.farmChecked).toBe(2);
  });

  it('coordenada inválida com fazenda citada: usa a fazenda e registra o alerta', () => {
    const v = validate('id;lat;lon;car\nx;8480000;560000;MG-3115300-0030E8D18E59417DAEFCB2F02C0A1C85\n', { farms });
    expect(v.records[0]).toMatchObject({ status: 'valid', coordOrigin: 'fazenda' });
    expect(v.records[0].issues[0].code).toBe('farm-replaced');
  });

  it('sem coordenada e sem fazenda mapeada: pede as colunas', () => {
    const v = validate('id;nome\n1;x\n', { farms });
    expect(v.fileProblems.join(' ')).toMatch(/latitude e longitude/);
  });
});

/* ---------------- Pontos inseridos à mão ---------------- */
describe('pontos inseridos à mão', () => {
  it('entram como linhas M1, M2 na mesma validação, inclusive sem arquivo', () => {
    const { parsed, mapping } = withManualPoints(null, {}, [{ lat: -21.39, lng: -42.69, id: 'X' }, { car: 'MG-3115300-AAAA' }]);
    const v = validateRecords(parsed, mapping, { farms });
    expect(v.records.map((r) => r.line)).toEqual(['M1', 'M2']);
    expect(v.records.every((r) => r.status === 'valid')).toBe(true);
    expect(v.records[1].coordOrigin).toBe('fazenda');
    expect(isManualLine('M2')).toBe(true);
    expect(lineLabel('M2')).toBe('Ponto inserido 2');
    expect(lineLabel(7)).toBe('Linha 7');
  });

  it('com arquivo: usa as colunas mapeadas e cria as que faltam', () => {
    const file = parseCsv('id;lat;lon\nA;-21,3;-42,6\n');
    const { parsed, mapping } = withManualPoints(file, suggestMapping(file.headers), [{ lat: -21.4, lng: -42.7, client: '99' }]);
    expect(parsed.headers).toEqual(['id', 'lat', 'lon', 'Cliente / UC (inserido)']);
    const v = validateRecords(parsed, mapping);
    expect(v.records[1]).toMatchObject({ line: 'M1', client: '99', lat: -21.4 });
  });
});

describe('coordenada digitada', () => {
  it('aceita ponto, vírgula e separadores; detecta inversão', () => {
    expect(parseLatLngText('-21.3905, -42.5520')).toMatchObject({ lat: -21.3905, lng: -42.552 });
    expect(parseLatLngText('-21,3905 -42,5520')).toMatchObject({ lat: -21.3905, lng: -42.552 });
    expect(parseLatLngText('-21,3905,-42,5520')).toMatchObject({ lat: -21.3905, lng: -42.552 });
    expect(parseLatLngText('-42,552; -21,39')).toMatchObject({ lat: -21.39, swapped: true });
    expect(parseLatLngText('48.8, 2.3').error).toMatch(/fora do Brasil/);
    expect(parseLatLngText('Cataguases')).toBeNull();
  });
});

/* ---------------- Cruzamento por lugar (sem depender dos setores) ---------------- */
describe('cruzamento por lugar', () => {
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const main = read('public/data/ibge/hierarquia_piloto.geojson');
  const districts = read('public/data/ibge/distritos_piloto.geojson');
  const hierarchy = parseHierarchy({ type: 'FeatureCollection', features: [...main.features, ...districts.features], ufSigla: 'MG' });
  const communities = ['3115300', '3138401'].flatMap((cod) => {
    const name = `microrregioes_${cod}.geojson`;
    const parsed = parseCommunityFile(read(`public/data/comunidades/${name}`), { fileName: name, municipalityExists: (c) => hierarchy.byCode.get(c)?.level === 'municipio' });
    const mun = hierarchy.byCode.get(cod);
    return importCommunities([], parsed, {
      orgId: 'energisa', municipalityGeometry: mun.geometry, municipalityName: mun.name, fileName: name, by: 'teste',
    }).regions;
  });
  const locator = createPlaceLocator({ hierarchy, communities });
  const { layer } = validateLayer(read('public/data/ibge/camada_piloto.geojson'), PILOT_CONFIG.layer.fields);

  const PTS = [
    [-21.26855, -42.6516], // Cataguases, comunidade Joaquim Vieira
    [-21.3892, -42.6961], // Cataguases, área urbana
    [-21.4700, -42.7300], // Leopoldina, zona rural (fora da malha de setores de Cataguases)
    [-19.92, -43.94], // Belo Horizonte: fora da área
  ];
  const validation = {
    total: PTS.length,
    warnings: 0,
    records: PTS.map(([lat, lng], i) => ({
      line: i + 2, id: `P${i + 1}`, lat, lng, client: null, equipment: null, property: null, status: 'valid', issues: [],
    })),
  };

  it('ponto de outro município da área é associado (antes ficava sem correspondência)', () => {
    const old = spatialJoin(validation, layer);
    expect(old.points[2].status).toBe('unmatched');

    const joined = placeJoin(validation, { locator, sectorLayer: layer });
    expect(joined.points.map((p) => p.status)).toEqual(['matched', 'matched', 'matched', 'unmatched']);
    expect(joined.points[3].reason).toMatch(/Fora dos municípios/);
    expect(joined.checks).toEqual({ unitSumEqualsMatched: true, statusSumEqualsValid: true });

    const placed = groupByPlace(attachPlaces(joined, locator), { locator, sectorLayer: layer });
    const leo = placed.points[2];
    expect(leo.place.municipio.nome).toBe('Leopoldina');
    const unit = placed.units.find((u) => u.id === leo.unitId);
    expect(unit.kind).toBe('microrregiao');
    expect(placed.checks.unitSumEqualsMatched).toBe(true);
  });

  it('funciona sem a malha de setores', () => {
    const joined = placeJoin(validation, { locator, sectorLayer: null });
    expect(joined.matched).toBe(3);
    const placed = groupByPlace(attachPlaces(joined, locator), { locator, sectorLayer: null });
    expect(placed.units.reduce((s, u) => s + u.count, 0)).toBe(3);
    expect(placed.units.map((u) => u.label).join(' | ')).toMatch(/Joaquim Vieira/);
  });
});
