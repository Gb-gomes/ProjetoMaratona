/**
 * Configuração geral do protótipo.
 *
 * DEMO_AREA define a janela geográfica usada na demonstração. Ela é
 * configurável e NÃO representa os limites de nenhuma localidade real:
 * as geometrias desenhadas sobre ela são ilustrativas.
 */
export const DEMO_AREA = {
  west: -56.40,
  east: -55.92,
  south: -13.98,
  north: -13.66,
};

/** Margem extra (em graus) ao redor da área para limitar a navegação. */
export const DEMO_AREA_MARGIN = 0.18;

/** Fundo cartográfico (OpenStreetMap). */
export const TILE_LAYER = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 17,
};

/**
 * Metadados da camada territorial em uso.
 *
 * mode: 'demo'     → geometrias ilustrativas geradas para o protótipo.
 * mode: 'official' → camada oficial carregada de um GeoJSON verificado.
 *
 * Ao integrar a malha oficial do IBGE, troque este objeto (ou carregue-o
 * junto com o GeoJSON) mantendo a mesma estrutura. Exemplo:
 *
 *   {
 *     mode: 'official',
 *     title: 'Malha territorial oficial — IBGE',
 *     unitType: 'Setor censitário',
 *     source: 'IBGE — Malha de setores censitários (Censo 2022)',
 *     code: 'IBGE-SC-2022',
 *     note: 'Camada oficial carregada do arquivo <nome>.geojson',
 *   }
 */
export const TERRITORIAL_LAYER = {
  mode: 'demo',
  title: 'Camada territorial demonstrativa',
  unitType: 'Unidade territorial demonstrativa',
  source: 'Geometrias ilustrativas geradas para a demonstração (não oficiais)',
  code: 'DEMO-UT',
  note: 'Geometrias simuladas — substituíveis pela camada oficial do IBGE',
};

/** Duração simulada do processamento (ms) e etapas exibidas. */
export const PROCESSING_STEPS = [
  { id: 'read', label: 'Lendo registros do arquivo', at: 0 },
  { id: 'join', label: 'Validando pontos e cruzando dados geográficos', at: 650 },
  { id: 'group', label: 'Agrupando por unidade territorial', at: 1450 },
];
export const PROCESSING_DURATION_MS = 2000;

/** Custo mensal de rádio informado pela organização (contexto, não cálculo). */
export const RADIO_MONTHLY_COST_LABEL = 'aproximadamente R$ 300.000';

/* ------------------------------------------------------------------ */
/* Modo "Teste com dados reais"                                        */
/* ------------------------------------------------------------------ */

/**
 * Configuração do território piloto e da camada oficial.
 *
 * status:
 *  - 'not-configured'       → município ainda não definido / camada não obtida.
 *                             O processamento real fica bloqueado.
 *  - 'official-unvalidated' → camada oficial preparada (recorte do IBGE),
 *                             ainda sem conferência registrada.
 *  - 'official-validated'   → camada conferida (registrar quem e quando em docs/).
 *
 * Os nomes de campo abaixo foram conferidos no arquivo oficial
 * MG_setores_CD2022 (ver docs/CAMADA_TERRITORIAL.md).
 *
 * Passo a passo: docs/CAMADA_TERRITORIAL.md.
 */
export const PILOT_CONFIG = {
  status: 'official-unvalidated',
  territory: {
    name: 'Cataguases', // exatamente como em NM_MUN
    uf: 'MG',
    ibgeCode: '3115300', // CD_MUN conferido no arquivo oficial (não confundir com Santana de Cataguases, 3158409)
  },
  layer: {
    title: 'Malha de Setores Censitários — Censo 2022 — IBGE',
    unitType: 'Setor censitário',
    source: 'IBGE — Malhas de setores censitários e divisões intramunicipais, Censo 2022',
    sourceUrl: 'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/',
    referenceYear: 2022,
    obtainedOn: '2026-10-10', // data do download (ver camada_piloto.origem.json)
    // GeoJSON local (EPSG:4326) usado no cruzamento e no mapa.
    url: '/data/ibge/camada_piloto.geojson',
    fields: {
      idField: 'CD_SETOR', // identificador oficial único (a confirmar)
      codeField: 'CD_SETOR',
      // Setores censitários não têm nome próprio. Deixe null, ou aponte um
      // campo oficial (ex.: NM_DIST) somente se essa for a unidade desejada.
      nameField: null,
      // Atributos oficiais exibidos como CONTEXTO (lista, detalhes, auditoria).
      // Nunca entram no texto do aviso.
      contextFields: [
        { field: 'NM_DIST', label: 'Distrito' },
        { field: 'SITUACAO', label: 'Situação' },
      ],
    },
    // true somente se o nome oficial (nameField) puder ir para a locução.
    officialNameApproved: false,
  },
  // Correspondência validada código → nome para comunicação (opcional).
  // Ver public/data/ibge/correspondencia_nomes.exemplo.json.
  correspondenceUrl: '/data/ibge/correspondencia_nomes.json',
};

export const PILOT_STATUS_LABEL = {
  'not-configured': 'Camada oficial não configurada',
  'official-unvalidated': 'Camada oficial — conferência pendente',
  'official-validated': 'Camada oficial validada',
};

/** Etapas exibidas durante o processamento real (sem atraso artificial). */
export const REAL_PROCESSING_STEPS = [
  { id: 'read', label: 'Lendo registros válidos' },
  { id: 'join', label: 'Cruzando pontos com a camada oficial' },
  { id: 'group', label: 'Agrupando por unidade territorial' },
];

/** Margem (fração) ao redor da camada para limitar a navegação no mapa. */
export const LAYER_BOUNDS_PADDING = 0.25;

/* ------------------------------------------------------------------ */
/* Carta padrão para as rádios (modelo Energisa)                       */
/* ------------------------------------------------------------------ */

/**
 * Texto fixo da carta. Os campos variáveis são preenchidos pela aplicação:
 *   {PUBLICO}  → "Pessoal de …" (município ou público informado no formulário)
 *   {DATA}     → ex.: 20 DEZEMBRO 2025
 *   {INICIO}   → ex.: 08:00h
 *   {FIM}      → ex.: 14:00h
 * A lista de ENDEREÇOS recebe somente NOMES de região (nunca códigos).
 */
export const RADIO_LETTER = {
  title: 'AVISO DE DESLIGAMENTO PROGRAMADO ENERGISA',
  body: 'Você sabe o que é Desligamento Programado? É quando a Energisa precisa desligar a energia para fazer melhorias ou consertos na rede. Sempre que o desligamento programado acontece, nós te avisamos antes, como agora. Então, preste atenção: Pessoal de {PUBLICO}, no dia {DATA} de {INICIO} às {FIM}, vamos precisar desligar a energia da sua região. Não esqueça de tirar os aparelhos da tomada. Qualquer dúvida, entre em contato pelo site, Whatsapp ou app.',
  addressesLabel: 'ENDEREÇOS:',
  closing: [
    'A energia poderá ser restabelecida antes do horário previsto. Programação sujeita a alterações ou cancelamentos sem aviso prévio.',
    'Para mais comodidade, receba os comunicados de desligamento programado diretamente no seu celular. Cadastre seu número na Energisa para receber SMS ou baixe o aplicativo Energisa ON. Em caso de dúvida, entre em contato com a Energisa pelo facebook ou pelo site.',
  ],
};
