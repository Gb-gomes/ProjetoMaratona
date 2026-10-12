/**
 * PONTOS PRIORITÁRIOS FICTÍCIOS — somente para o modo Demonstração.
 *
 * Posicionados a poucos metros de pontos demonstrativos para exibir cada
 * situação do fluxo (possível correspondência, ambiguidade, sem alerta,
 * cadastro inativo). Não representam pessoas nem unidades consumidoras reais.
 */
import { DEMO_POINTS } from './mockData.js';

const M_PER_DEG = 111320;
/** Desloca um ponto demonstrativo em metros (norte, leste). */
function offset(point, north, east) {
  const lat = point.lat + north / M_PER_DEG;
  const lng = point.lng + east / (M_PER_DEG * Math.cos((point.lat * Math.PI) / 180));
  return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
}

const AT = '2026-10-01T12:00:00.000Z';
const base = (id, extra) => ({
  id,
  label: '',
  ucCode: '',
  activity: '',
  impact: '',
  validationRef: '',
  notes: 'Registro fictício da demonstração.',
  registeredOn: '2026-10-01',
  status: 'active',
  fictitious: true,
  createdAt: AT,
  createdBy: 'demonstração',
  updatedAt: AT,
  updatedBy: 'demonstração',
  history: [{ action: 'criado', by: 'demonstração', at: AT }],
  ...extra,
});

export function buildDemoPriorityRecords() {
  return [
    base('DEMO-A-01', {
      ...offset(DEMO_POINTS[5], 6, 4), category: 'A', label: 'Cliente fictício A1',
      situation: 'Equipamento vital informado (fictício).', validationRef: 'DEMO-VAL-001',
    }),
    base('DEMO-B-01', {
      ...offset(DEMO_POINTS[40], -10, 8), category: 'B', label: 'Granja fictícia',
      situation: 'Aviário com ventilação elétrica (fictício).', activity: 'Avicultura de corte', impact: 'Risco aos animais se a ventilação parar por mais de 1 hora.',
    }),
    base('DEMO-A-02', {
      ...offset(DEMO_POINTS[70], 12, 0), category: 'A', label: 'Cliente fictício A2',
      situation: 'Equipamento vital informado (fictício).',
    }),
    base('DEMO-B-02', {
      ...offset(DEMO_POINTS[70], -14, 5), category: 'B', label: 'Laticínio fictício',
      situation: 'Resfriamento de leite (fictício).', activity: 'Resfriamento de leite', impact: 'Perda do leite armazenado.',
    }),
    base('DEMO-B-03', {
      ...offset(DEMO_POINTS[90], 300, 0), category: 'B', label: 'Irrigação fictícia',
      situation: 'Bomba de irrigação (fictício).', activity: 'Irrigação', impact: 'Atraso na irrigação.',
    }),
    base('DEMO-A-03', {
      ...offset(DEMO_POINTS[20], 3, -3), category: 'A', label: 'Cliente fictício A3 (inativo)',
      situation: 'Cadastro encerrado (fictício).', status: 'inactive',
      history: [{ action: 'criado', by: 'demonstração', at: AT }, { action: 'desativado', by: 'demonstração', at: AT }],
    }),
  ];
}
