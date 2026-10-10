import { describe, it, expect } from 'vitest';
import { spatialJoin, locatePoint } from '../spatialJoin.js';
import { validateLayer } from '../layer.js';
import { summarize, pointsForMap, auditRows } from '../summary.js';

/*
 * Geometrias de teste (NÃO são dados oficiais), em [lng, lat]:
 *
 *   A: quadrado lng −56..−55, lat −14..−13
 *   B: quadrado lng −55..−54, lat −14..−13   (limite comum com A em lng −55)
 *   M: MultiPolygon com duas partes:
 *        parte 1: lng −50..−48, lat −14..−12, com buraco lng −49.5..−48.5, lat −13.5..−12.5
 *        parte 2 (ilha): lng −46..−45, lat −14..−13
 *   S1 e S2: quadrados sobrepostos (testam sobreposição)
 */
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const feature = (id, geometry) => ({ type: 'Feature', properties: { CD_SETOR: id }, geometry });

const RAW = {
  type: 'FeatureCollection',
  features: [
    feature('A', { type: 'Polygon', coordinates: [square(-56, -14, -55, -13)] }),
    feature('B', { type: 'Polygon', coordinates: [square(-55, -14, -54, -13)] }),
    feature('M', {
      type: 'MultiPolygon',
      coordinates: [
        [square(-50, -14, -48, -12), square(-49.5, -13.5, -48.5, -12.5)],
        [square(-46, -14, -45, -13)],
      ],
    }),
  ],
};
const OVERLAP = {
  type: 'FeatureCollection',
  features: [
    feature('S1', { type: 'Polygon', coordinates: [square(-60, -14, -58, -12)] }),
    feature('S2', { type: 'Polygon', coordinates: [square(-59, -14, -57, -12)] }),
  ],
};
const FIELDS = { idField: 'CD_SETOR', codeField: 'CD_SETOR', nameField: null };
const layerOf = (raw) => {
  const v = validateLayer(raw, FIELDS);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.layer;
};
const LAYER = layerOf(RAW);

/** Monta um resultado de validação mínimo a partir de [id, lat, lng]. */
const validationOf = (pts) => ({
  total: pts.length,
  warnings: 0,
  records: pts.map(([id, lat, lng], i) => ({
    line: i + 2, id, lat, lng, client: null, equipment: null, property: null, status: 'valid', issues: [],
  })),
});

describe('locatePoint — regras de ponto no polígono', () => {
  it('1. ponto claramente dentro de um polígono é associado', () => {
    const r = locatePoint(-55.5, -13.5, LAYER.features);
    expect(r.status).toBe('matched');
    expect(r.unitId).toBe('A');
  });

  it('2. ponto fora de todos os polígonos fica sem correspondência (sem vizinho mais próximo)', () => {
    const r = locatePoint(-52, -13.5, LAYER.features);
    expect(r.status).toBe('unmatched');
    expect(r.unitId).toBeNull();
    expect(r.candidates).toEqual([]);
  });

  it('3a. ponto sobre o limite comum de duas unidades é ambíguo e lista as duas', () => {
    const r = locatePoint(-55, -13.5, LAYER.features);
    expect(r.status).toBe('ambiguous');
    expect(r.unitId).toBeNull();
    expect(r.candidates.sort()).toEqual(['A', 'B']);
  });

  it('3b. ponto sobre o limite externo de uma única unidade também é ambíguo', () => {
    const r = locatePoint(-56, -13.5, LAYER.features);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toEqual(['A']);
  });

  it('4. ponto dentro de duas geometrias sobrepostas é ambíguo, não duplicado', () => {
    const overlap = layerOf(OVERLAP);
    const r = locatePoint(-58.5, -13, overlap.features);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates.sort()).toEqual(['S1', 'S2']);

    const res = spatialJoin(validationOf([['p', -13, -58.5]]), overlap);
    expect(res.units).toEqual([]);
    expect(res.ambiguous).toBe(1);
  });

  it('5. MultiPolygon: ilha, buraco e limite do buraco', () => {
    expect(locatePoint(-49.8, -13.8, LAYER.features)).toMatchObject({ status: 'matched', unitId: 'M' }); // parte 1
    expect(locatePoint(-45.5, -13.5, LAYER.features)).toMatchObject({ status: 'matched', unitId: 'M' }); // ilha
    expect(locatePoint(-49, -13, LAYER.features).status).toBe('unmatched'); // dentro do buraco
    expect(locatePoint(-49.5, -13, LAYER.features).status).toBe('ambiguous'); // borda do buraco
  });
});

describe('spatialJoin — agrupamento e contagem', () => {
  const pts = [
    ['a1', -13.5, -55.5], ['a2', -13.2, -55.8], ['a3', -13.9, -55.1], // A
    ['b1', -13.5, -54.5], // B
    ['m1', -13.5, -45.5], ['m2', -13.8, -49.8], // M (duas partes)
    ['out', -13.5, -52], // fora
    ['edge', -13.5, -55], // limite A|B
    ['hole', -13, -49], // buraco de M
  ];
  const res = spatialJoin(validationOf(pts), LAYER, { mapping: {} });

  it('9. conta pontos por unidade pelo identificador oficial', () => {
    const counts = Object.fromEntries(res.units.map((u) => [u.code, u.count]));
    expect(counts).toEqual({ A: 3, M: 2, B: 1 });
    expect(res.units.map((u) => u.code)).toEqual(['A', 'M', 'B']); // mais pontos primeiro
    expect(res.matched).toBe(6);
    expect(res.unmatched).toBe(2);
    expect(res.ambiguous).toBe(1);
  });

  it('soma por unidade = pontos associados unicamente', () => {
    expect(res.units.reduce((s, u) => s + u.count, 0)).toBe(res.matched);
    expect(res.checks.unitSumEqualsMatched).toBe(true);
    expect(res.checks.statusSumEqualsValid).toBe(true);
  });

  it('cada ponto é rastreável até a unidade', () => {
    const a = res.units.find((u) => u.code === 'A');
    expect(a.pointIds.sort()).toEqual(['a1', 'a2', 'a3']);
    expect(res.points.find((p) => p.key === 'edge').candidates.sort()).toEqual(['A', 'B']);
    expect(res.points.find((p) => p.key === 'out').line).toBe(8);
  });

  it('clientes, equipamentos e propriedades não são inventados sem coluna mapeada', () => {
    expect(res.unique).toEqual({ clients: null, equipments: null, properties: null });
  });

  it('13. lista, mapa e KPIs leem os mesmos números', () => {
    const allIds = res.units.map((u) => u.id);
    const s = summarize(res, allIds);
    expect(s.consistent).toBe(true);
    // KPI "unidades" = itens da lista lateral = polígonos destacados no mapa
    expect(s.unitCount).toBe(res.units.length);
    // KPI "pontos no aviso" = soma das contagens da lista selecionada
    expect(s.selectedPoints).toBe(res.matched);
    // pontos no mapa (todos os filtros) = pontos válidos
    expect(pointsForMap(res).length).toBe(s.valid);
    // pontos destacados por unidade no mapa = contagem da lista
    res.units.forEach((u) => {
      expect(pointsForMap(res).filter((p) => p.unitId === u.id).length).toBe(u.count);
    });
    // filtro "somente sem correspondência" = KPI de sem correspondência
    expect(pointsForMap(res, { matched: false, unmatched: true, ambiguous: false }).length).toBe(s.unmatched);
    // relatório de auditoria tem uma linha por ponto válido, sem coordenadas por padrão
    const rows = auditRows(res);
    expect(rows.length - 1).toBe(s.valid);
    expect(rows[0]).not.toContain('latitude');
  });

  it('recusa processar sem camada ou sem registros válidos', () => {
    expect(() => spatialJoin(validationOf(pts), { features: [] })).toThrow();
    expect(() => spatialJoin({ total: 1, records: [] }, LAYER)).toThrow();
  });
});

describe('validateLayer', () => {
  it('preserva atributos oficiais e usa o campo de id configurado', () => {
    const f = LAYER.features.find((x) => x.properties.id === 'A');
    expect(f.properties.official).toEqual({ CD_SETOR: 'A' });
    expect(f.properties.name).toBeNull(); // sem nameField, nenhum nome é criado
  });

  it('rejeita ids repetidos, camada projetada e estrutura inválida', () => {
    const dup = { type: 'FeatureCollection', features: [RAW.features[0], RAW.features[0]] };
    expect(validateLayer(dup, FIELDS).ok).toBe(false);
    const projected = {
      type: 'FeatureCollection',
      features: [feature('X', { type: 'Polygon', coordinates: [square(500000, 8400000, 510000, 8410000)] })],
    };
    expect(validateLayer(projected, FIELDS).ok).toBe(false);
    expect(validateLayer({ type: 'Feature' }, FIELDS).ok).toBe(false);
  });
});

describe('contexto oficial (ex.: distrito)', () => {
  it('é exibido na unidade, mas não vira nome do aviso', async () => {
    const { buildUnitNotice } = await import('../communicationUtils.js');
    const raw = {
      type: 'FeatureCollection',
      features: [{ ...feature('A', RAW.features[0].geometry), properties: { CD_SETOR: 'A', NM_DIST: 'Distrito X', SITUACAO: 'Rural' } }],
    };
    const v = validateLayer(raw, {
      ...FIELDS,
      contextFields: [{ field: 'NM_DIST', label: 'Distrito' }, { field: 'SITUACAO', label: 'Situação' }],
    });
    const res = spatialJoin(validationOf([['p', -13.5, -55.5]]), v.layer);
    expect(res.units[0].context).toEqual([{ label: 'Distrito', value: 'Distrito X' }, { label: 'Situação', value: 'Rural' }]);
    const notice = buildUnitNotice(res.units, null, { unitType: 'Setor censitário' });
    expect(notice.text).not.toContain('Distrito X');
    expect(notice.pendingCodes).toEqual(['A']);
  });
});
