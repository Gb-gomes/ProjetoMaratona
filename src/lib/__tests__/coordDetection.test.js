import { describe, it, expect } from 'vitest';
import {
  suggestMappingFromData, suggestCrs, columnLetter, TEMPLATE_LAT_COLUMN, TEMPLATE_LNG_COLUMN,
} from '../csv.js';

// Cabeçalho do modelo da Energisa ("teste maratona"): COORD_X/COORD_Y em UTM (V, W) e LAT/LONG em graus (X, Y).
const HEADERS = ['LOCAL', 'TRANSFORMADOR', 'NUMCDC', 'NOME', 'ENDERECO', 'BAIRRO', 'MEDIDOR', 'SITUACAO', 'DATALIG', 'NUM_ROTA',
  'NUM_CONTA', 'TIPO_MEDIDOR', 'GRANDEZA', 'FASES', 'COD_EMPRESA_ANEEL', 'TUC', 'TIPO_BEM', 'A2', 'A3', 'CLASSE', 'LOCALIZACAO',
  'COORD_X', 'COORD_Y', 'LAT', 'LONG', 'LAT_GMS', 'LONG_GMS'];
const row = (x, y, lat, lng) => {
  const r = HEADERS.map(() => '');
  r[21] = x; r[22] = y; r[23] = lat; r[24] = lng; r[25] = '21°29\'53.321"S';
  return r;
};
const ROWS = [
  row('', '', '', ''),
  row('749702,04', '7620794,21', '-21,498145', '-42,589809'),
  row('753027,66', '7619814,97', '-21,506518', '-42,557583'),
  row('752650,42', '7620073,85', '-21.504234', '-42.561261'),
];

describe('detecção das coordenadas', () => {
  it('modelo da Energisa: latitude na coluna X (LAT) e longitude na Y (LONG), nunca COORD_X/COORD_Y (UTM)', () => {
    const { mapping, coordSource } = suggestMappingFromData(HEADERS, ROWS);
    expect([columnLetter(mapping.lat), columnLetter(mapping.lng)]).toEqual(['X', 'Y']);
    expect([mapping.lat, mapping.lng]).toEqual([TEMPLATE_LAT_COLUMN, TEMPLATE_LNG_COLUMN]);
    expect(coordSource).toBe('cabecalho');
    expect(suggestCrs(ROWS, mapping)).toBe('EPSG:4674');
  });

  it('sem cabeçalho reconhecível: usa as colunas X e Y da planilha', () => {
    const headers = HEADERS.map((h, i) => (i === 23 ? 'COL_A' : i === 24 ? 'COL_B' : h)).map((h) => (h === 'COORD_X' || h === 'COORD_Y' ? `${h}_UTM` : h));
    const { mapping, coordSource } = suggestMappingFromData(headers, ROWS);
    expect(coordSource).toBe('colunas_xy');
    expect([columnLetter(mapping.lat), columnLetter(mapping.lng)]).toEqual(['X', 'Y']);
  });

  it('outra planilha qualquer: encontra latitude e longitude pelos valores', () => {
    const { mapping, coordSource } = suggestMappingFromData(['ponto', 'a', 'b'], [['1', '-42,51', '-21,38'], ['2', '-42,60', '-21,40']]);
    expect(coordSource).toBe('valores');
    expect(mapping).toMatchObject({ lat: 2, lng: 1 });
  });

  it('só UTM: não sugere coordenadas nem referencial', () => {
    const { mapping, coordSource } = suggestMappingFromData(['x', 'y'], [['749702,04', '7620794,21']]);
    expect(coordSource).toBeNull();
    expect(suggestCrs([['749702,04', '7620794,21']], mapping)).toBe('');
  });

  it('letras das colunas', () => {
    expect([0, 23, 24, 25, 27].map(columnLetter)).toEqual(['A', 'X', 'Y', 'Z', 'AB']);
  });
});
