import { describe, it, expect } from 'vitest';
import {
  parseCsv, detectDelimiter, suggestMapping, validateRecords, parseDecimal, decodeBuffer, isProcessableCrs,
} from '../csv.js';

const validate = (text, mapping) => {
  const parsed = parseCsv(text);
  return validateRecords(parsed, mapping ?? suggestMapping(parsed.headers));
};
const issueCodes = (rec) => rec.issues.map((i) => i.code);

describe('parseCsv', () => {
  it('detecta ponto e vírgula, remove BOM e respeita aspas', () => {
    const p = parseCsv('﻿id;latitude;longitude;propriedade\n1;-13,7;-56,2;"Fazenda; Boa ""Vista"""\n');
    expect(p.delimiter).toBe(';');
    expect(p.headers).toEqual(['id', 'latitude', 'longitude', 'propriedade']);
    expect(p.rows[0][3]).toBe('Fazenda; Boa "Vista"');
  });

  it('detecta vírgula e tabulação', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('aceita quebra de linha dentro de aspas e registra a linha física', () => {
    const p = parseCsv('id,lat,lon,obs\n1,-13.1,-56.1,"linha\nquebrada"\n2,-13.2,-56.2,x\n');
    expect(p.rows).toHaveLength(2);
    expect(p.rowLines).toEqual([2, 4]);
  });

  it('decodifica Windows-1252 quando o arquivo não é UTF-8', () => {
    const bytes = new Uint8Array([0x53, 0xed, 0x74, 0x69, 0x6f]); // "Sítio" em Windows-1252
    expect(decodeBuffer(bytes.buffer)).toEqual({ text: 'Sítio', encoding: 'Windows-1252' });
  });
});

describe('parseDecimal', () => {
  it('aceita vírgula e ponto decimal; recusa formatos ambíguos', () => {
    expect(parseDecimal('-13,744311')).toBeCloseTo(-13.744311);
    expect(parseDecimal('-13.744311')).toBeCloseTo(-13.744311);
    expect(parseDecimal('−13.5')).toBe(-13.5);
    expect(parseDecimal('1.234,5')).toBeNaN();
    expect(parseDecimal("13°44'S")).toBeNaN();
    expect(parseDecimal('')).toBeNaN();
  });
});

describe('validateRecords', () => {
  it('7a. CSV vazio', () => {
    const v = validate('');
    expect(v.ok).toBe(false);
    expect(v.fileProblems[0]).toMatch(/vazio/);
  });

  it('7b. CSV só com cabeçalho', () => {
    const v = validate('id;latitude;longitude\n');
    expect(v.ok).toBe(false);
    expect(v.fileProblems[0]).toMatch(/apenas o cabeçalho/);
  });

  it('7c. CSV sem colunas de coordenadas', () => {
    const v = validate('id;nome\n1;x\n');
    expect(v.ok).toBe(false);
    expect(v.fileProblems.join(' ')).toMatch(/latitude e longitude/);
  });

  it('6. coordenadas inválidas: ausente, não numérica, fora do intervalo, invertida, projetada, fora do Brasil', () => {
    const v = validate([
      'id;latitude;longitude',
      'ok;-13,7;-56,2',
      'vazio;;-56,2',
      'texto;abc;-56,2',
      'faixa;-95;-56',
      'invertida;-56,2;-13,7',
      'utm;8480000;560000',
      'europa;48,85;2,35',
    ].join('\n'));
    const byId = Object.fromEntries(v.records.map((r) => [r.id, r]));
    expect(byId.ok.status).toBe('valid');
    expect(issueCodes(byId.vazio)).toContain('missing');
    expect(issueCodes(byId.texto)).toContain('not-numeric');
    expect(issueCodes(byId.faixa)).toContain('lat-range');
    expect(issueCodes(byId.invertida)).toContain('swapped');
    expect(issueCodes(byId.utm)).toContain('projected');
    expect(issueCodes(byId.europa)).toContain('outside-brazil');
    expect(v.valid).toBe(1);
    expect(v.invalid).toBe(6);
    // inversões NÃO são corrigidas
    expect(byId.invertida.lat).toBeNull();
  });

  it('8. duplicados: id repetido e registro idêntico são inválidos; coordenada repetida é alerta', () => {
    const v = validate([
      'id;latitude;longitude;propriedade',
      'P1;-13,70;-56,20;Fazenda A',
      'P1;-13,71;-56,21;Fazenda B', // id repetido
      'P2;-13,70;-56,20;Fazenda C', // mesma coordenada de P1, outro registro
    ].join('\n'));
    expect(issueCodes(v.records[1])).toContain('duplicate-id');
    expect(v.records[1].status).toBe('invalid');
    expect(issueCodes(v.records[2])).toContain('duplicate-coord');
    expect(v.records[2].status).toBe('valid');
    expect(v.warnings).toBe(1);

    const noId = validate('latitude;longitude\n-13,7;-56,2\n-13,7;-56,2\n');
    expect(issueCodes(noId.records[1])).toContain('duplicate-row');
    expect(noId.valid).toBe(1);

    // Unidades consumidoras diferentes no mesmo ponto (coluna não mapeada muda): alerta, não descarte.
    const sameSpot = validate('latitude;longitude;numcdc\n-13,7;-56,2;111\n-13,7;-56,2;222\n');
    expect(sameSpot.valid).toBe(2);
    expect(issueCodes(sameSpot.records[1])).toContain('duplicate-coord');
  });

  it('respeita o mapeamento manual de colunas com nomes não convencionais', () => {
    const v = validate('cod;Y_GRAUS;X_GRAUS\nA;-13,5;-56,1\n', { id: 0, lat: 1, lng: 2, client: null, equipment: null, property: null });
    expect(v.valid).toBe(1);
    expect(v.records[0]).toMatchObject({ id: 'A', lat: -13.5, lng: -56.1 });
  });

  it('nenhum registro é descartado em silêncio', () => {
    const v = validate('id;latitude;longitude\n1;-13,7;-56,2\n2;x;y\n');
    expect(v.records).toHaveLength(2);
    expect(v.total).toBe(v.valid + v.invalid);
  });
});

describe('referencial', () => {
  it('só processa referenciais geográficos declarados', () => {
    expect(isProcessableCrs('EPSG:4326')).toBe(true);
    expect(isProcessableCrs('EPSG:4674')).toBe(true);
    expect(isProcessableCrs('unknown')).toBe(false);
    expect(isProcessableCrs('projected')).toBe(false);
    expect(isProcessableCrs('')).toBe(false);
  });
});
