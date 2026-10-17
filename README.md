# Conecta Rural — Inteligência Geográfica

Aplicação somente front-end que transforma a lista de pontos de um desligamento programado em uma relação de unidades territoriais oficiais. O objetivo é preparar um aviso de rádio mais objetivo.

Há dois modos independentes, escolhidos no cabeçalho:

| | **Demonstração** | **Teste com dados reais** |
|---|---|---|
| Pontos | 100 pontos fictícios | CSV escolhido pelo operador (lido só no navegador) |
| Camada territorial | Geometrias ilustrativas | Malha oficial do IBGE recortada para o município piloto |
| Cruzamento | Associação predefinida (simulação) | Ponto no polígono real, com detecção de limites e ambiguidades |
| Desligamento | Datas fictícias | Formulário; vazio por padrão ("não informado") |
| Aviso | Nomes demonstrativos | Somente nomes com correspondência validada; senão, pendência explícita |

Trocar de modo limpa todos os resultados. Nenhuma mensagem é enviada em nenhum dos modos.

> **Situação atual:** o piloto é **Cataguases (MG)**, `CD_MUN` 3115300. A camada oficial de setores censitários do Censo 2022 (140 setores) está carregada com status *conferência pendente*. O cruzamento real funciona. A locução continua dependendo de uma correspondência de nomes validada. Veja [docs/CAMADA_TERRITORIAL.md](docs/CAMADA_TERRITORIAL.md).

## Requisitos

- Node.js 18 ou superior (recomendado: 20 LTS)
- npm 9 ou superior

## Como executar

```bash
npm install
npm run dev
```

O Vite abre o navegador em `http://localhost:5173`.

Testes automatizados:

```bash
npm test
```

Para gerar a versão de produção:

```bash
npm run build      # gera a pasta dist/
npm run preview    # serve a build localmente
```

Para publicar no Cloudflare Pages, com acesso protegido pelo Cloudflare Access:

```bash
npm run deploy     # wrangler pages deploy dist --project-name conecta-rural
```

O primeiro deploy exige `npx wrangler login` e a criação do projeto. A configuração do Access é feita no painel da Cloudflare. Passo a passo em [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).

Você precisa de internet para carregar duas coisas: o fundo cartográfico (tiles do OpenStreetMap) e a fonte IBM Plex Sans. Sem conexão, o mapa mostra um aviso, mas as camadas, os resultados e a comunicação continuam funcionando.

## Dependências

| Pacote | Uso |
|---|---|
| react, react-dom 18.3 | Interface (componentes funcionais e hooks) |
| leaflet 1.9 e react-leaflet 4.2 | Mapa interativo |
| lucide-react | Ícones |
| tailwindcss 3.4, postcss, autoprefixer | Estilização |
| vite 5 e @vitejs/plugin-react | Servidor de desenvolvimento e build |
| @turf/boolean-point-in-polygon 7.1 e @turf/helpers | Teste de ponto no polígono (Polygon, MultiPolygon, buracos, limites) |
| @turf/intersect, union, difference, area 7.1 | Recorte, união e área geodésica das sub-regiões |
| @geoman-io/leaflet-geoman-free 2.17 | Desenho e edição de vértices das sub-regiões (carregado sob demanda) |
| shpjs 6.1, fflate 0.8, @tmcw/togeojson 7.1, proj4 2.12 | Leitura de Shapefile (.zip), KMZ e KML; reprojeção (SIRGAS 2000, UTM) |
| geojson-vt 4.0, flatbush 4.4 | Tiles vetoriais locais e índice espacial das camadas grandes (Web Worker) |
| fake-indexeddb 6.0 (dev) | IndexedDB em memória para os testes |
| vitest 2.1 (dev) | Testes automatizados |
| wrangler 4.48 (dev) | Deploy no Cloudflare Pages (última versão compatível com Node 18) |

## Roteiro: modo Demonstração

1. A tela abre com o arquivo `desligamento_alimentador_CAT04.csv` **na fila**, ainda sem processamento.
2. Clique em **Processar Coordenadas**. A simulação leva cerca de 2 segundos e pode ser cancelada.
3. Depois do processamento, o sistema mostra:
   - os 100 pontos no mapa;
   - as 4 unidades demonstrativas (24 + 31 + 28 + 17);
   - os indicadores;
   - a comparação entre a comunicação tradicional e a comunicação por região.
4. Clique em uma região, na lista ou no mapa. O mapa aproxima, a região é destacada e os detalhes aparecem. A tecla **Esc** limpa o foco.
5. Use as caixas de seleção da lista para escolher as regiões citadas no aviso. Com o texto ainda não editado, o aviso se atualiza sozinho. Se você editou o texto, um alerta pede para clicar em **Gerar aviso**.
6. Use **Copiar texto** para copiar o aviso para a área de transferência.
7. Use **Aprovar aviso** para mudar o status local para "Aprovado para demonstração". Nada é enviado.
8. Use **Reiniciar demonstração** para voltar ao estado inicial.

No modo Demonstração, o upload de um CSV **apenas valida** o arquivo. A simulação continua usando os pontos demonstrativos, e a interface informa isso. Os CSVs de `exemplos/` são fictícios.

## Procedimento: teste com um CSV real autorizado

Pré-requisito: camada do piloto preparada e `PILOT_CONFIG.status` diferente de `'not-configured'` ([docs/CAMADA_TERRITORIAL.md](docs/CAMADA_TERRITORIAL.md)).

1. Use somente um CSV **autorizado** (de preferência anonimizado). Guarde-o **fora do projeto** ou em `dados/` ou `dados_reais/`, pastas ignoradas pelo git. Nunca coloque o arquivo em `public/`.
2. `npm run dev` → no cabeçalho, escolha **Teste com dados reais**.
3. Confira, no painel à direita, que a camada aparece como carregada, com o número de unidades.
4. Arraste o CSV. O sistema detecta o separador (`,`, `;` ou tabulação), o BOM e a codificação (UTF-8 ou Windows-1252), e mostra a prévia das 5 primeiras linhas.
5. Confira o **mapeamento das colunas**: latitude e longitude são obrigatórias; identificador, cliente, equipamento e propriedade são opcionais.
6. Declare o **referencial** confirmado com a engenharia. UTM ou referencial desconhecido bloqueiam o processamento.
7. Clique em **Validar registros** e leia as ocorrências: campos ausentes, valores não numéricos, fora de intervalo, possivelmente invertidos (nunca corrigidos automaticamente), fora do Brasil, ids repetidos e coordenadas repetidas.
8. Clique em **Processar Coordenadas**. Confira os KPIs, o mapa (pontos vermelhos = sem correspondência, laranja = ambíguos; filtros no controle de camadas) e a lista de unidades.
9. Abra **Auditoria**: confira a verificação de consistência, revise os registros e, se precisar, exporte o CSV de auditoria (sem coordenadas por padrão). O arquivo é gerado localmente.
10. Preencha o **desligamento** (data, horários, data do aviso).
11. No aviso, unidades sem correspondência validada aparecem como pendência e **bloqueiam a aprovação**. Registre a correspondência em `public/data/ibge/correspondencia_nomes.json` ou retire a unidade da seleção.
12. Registre os números em [docs/RELATORIO_VALIDACAO.md](docs/RELATORIO_VALIDACAO.md).

## Carta para as rádios e nomes de região

- O painel inferior gera a **carta padrão Energisa** (texto fixo em `RADIO_LETTER`, `src/config.js`). Ela é preenchida com o público ("Pessoal de…", que por padrão é o município do piloto e pode ser alterado no formulário), a data no formato `20 DEZEMBRO 2025`, os horários no formato `08:00h` e a lista de **ENDEREÇOS**, que traz somente **nomes** de região, sem códigos e sem repetição.
- **A carta é sempre gerada.** Ordem de escolha do nome de cada região:
  1. nome definido pelo operador;
  2. tabela de correspondência validada;
  3. **nome automático da área do IBGE**, montado com distrito e situação (ex.: "Zona rural de Sereno", "Sereno (área urbana)"; regra `fallbackLabel` em `PILOT_CONFIG`).

  Só se nada disso existir aparece `[NOMEAR REGIÃO nn]`, que bloqueia a aprovação.
- **Regra de poucos clientes** (`ANNOUNCEMENT_RULES.minClientsForRegion`, padrão 3): região com **menos de 3 clientes** afetados é citada pelo **nome das propriedades** (coluna "propriedade" do CSV), não pela região, para a região inteira não esperar um desligamento que não é dela.
  - Contam-se clientes distintos quando a coluna de cliente está mapeada; senão, pontos.
  - Sem coluna de propriedade, ou com propriedade sem nome, a região também é citada e a carta mostra uma observação. Nenhum nome é inventado.
  - Nos detalhes de cada região, **"Como citar no aviso"** permite escolher Automático, Nome da região ou Nome das propriedades.
- **Nomear região:** na lista de regiões, use **Nomear** ou **Renomear**. São obrigatórios o nome conhecido pela comunidade e o responsável; a observação (como o nome foi confirmado) é opcional. A região passa a mostrar o selo "nome alterado", e os detalhes mostram quem alterou, quando e o **histórico** completo (definido, alterado, removido, importado). O histórico nunca é apagado.
- **Onde ficam salvos:** no navegador desta máquina (`localStorage`). Só os nomes de região são guardados, sem coordenadas ou dados de cliente. Use **Exportar** para gerar um JSON (backup, outra máquina ou `public/data/ibge/correspondencia_nomes.json`) e **Importar** para carregá-lo. Limpar os dados do navegador apaga os nomes não exportados.
- Nomes do operador têm prioridade sobre a tabela de correspondência do projeto.

## Pontos prioritários (cadastro manual e alertas)

Etapa **demonstrativa**: o armazenamento é local e não há controle de acesso; não use com dados reais de clientes. Detalhes em [docs/PONTOS_PRIORITARIOS.md](docs/PONTOS_PRIORITARIOS.md).

- No painel **"Alertas de pontos prioritários"** (coluna esquerda):
  - **Cadastrar ponto prioritário** abre o formulário.
  - **Cadastro (N)** abre a consulta: pesquisa por identificador, filtros de categoria e status, data de atualização, Editar, Desativar/Reativar, Ver no mapa e Excluir (este último só para registros que nunca geraram alerta).
- **Categorias:**
  - **A — Equipamento vital** (vermelho): registre só o mínimo necessário.
  - **B — Atividade produtiva crítica** (violeta): exige atividade e impacto.
- **Comparação automática** a cada processamento:
  - usa a distância calculada (Haversine) com tolerância configurável, padrão 30 m (`PRIORITY_MATCH`), que é um **parâmetro de teste**;
  - **confirmada** só com código da UC igual à coluna de cliente do CSV e ponto dentro da tolerância;
  - **possível** quando há só proximidade;
  - **exige revisão** em ambiguidades e divergências.
- **Alertas rastreáveis:**
  - status Pendente → Em análise → Encaminhado → Análise concluída, sempre com responsável;
  - a conclusão exige decisão;
  - o histórico nunca é apagado.
- **Aprovação:** enquanto houver alerta de **equipamento vital** sem análise concluída, a carta não pode ser aprovada e o desligamento não aparece como validado.
- **Mapa:** camada própria (liga/desliga sem perder resultados). Ao selecionar um alerta, o mapa centraliza e liga o cadastro aos pontos do CSV envolvidos.
- **Separação dos modos:** Demonstração e Teste real têm cadastros separados. A demonstração vem com registros **fictícios** ("Restaurar exemplos" recria esses registros).

## Camadas do mapa e sub-regiões (modo Teste com dados reais)

Detalhes, decisões e situação de cada critério de aceite em [docs/CAMADAS_E_SUBREGIOES.md](docs/CAMADAS_E_SUBREGIOES.md). Tudo roda e fica salvo **neste navegador**; ainda não há backend (PostgreSQL/PostGIS).

- **Painel de camadas** (canto superior esquerdo do mapa; no celular, botão "Camadas"):
  - mapa base: Ruas ou Satélite;
  - grupos: Operação, Sub-regiões, Limites IBGE (somente leitura) e os grupos da organização (ex.: `Energisa > Rede Elétrica`);
  - por camada: ligar/desligar, arrastar ou setas para reordenar, opacidade, zoom para a camada, legenda automática e filtro "só dentro da sub-região";
  - o estado volta igual ao recarregar (por usuário).
- **Limites oficiais do IBGE:** MG, Intermediária de Juiz de Fora, Imediata de Cataguases e seus 10 municípios (Malha Municipal 2022, `scripts/preparar_hierarquia_ibge.mjs`).
- **Sub-regiões:** clique numa região do mapa, depois em **Criar sub-região aqui**, e escolha:
  - desenhar (polígono ou retângulo, com encaixe nas bordas);
  - selecionar municípios ou setores censitários;
  - importar um arquivo (GeoJSON, KML/KMZ, Shapefile).

  O que passa da borda é recortado, com aviso acima de 50 m. Nome repetido e sobreposição entre irmãs são bloqueados; um administrador pode liberar a sobreposição. As sub-regiões podem ser aninhadas. O botão **Sub-regiões** abre a árvore, com busca, renomear, editar área, duplicar, excluir/restaurar, exportar GeoJSON e histórico.
- **Adicionar camada:**
  - formatos: GeoJSON, KML/KMZ, Shapefile (.zip) ou CSV com coordenadas, além de WMS/XYZ por URL;
  - reprojeção para EPSG:4326 pelo `.prj` (ou escolha do usuário) e correção de geometrias, com relatório de rejeitadas;
  - pré-visualização antes de confirmar e processamento em segundo plano;
  - versões ao substituir ou anexar;
  - estilo por atributo (ex.: cor das linhas por tensão).
- **Camadas grandes:** viram tiles vetoriais num Web Worker. Um Shapefile fictício de 500 mil postes (`node scripts/gerar_rede_teste.mjs`) é importado em ~7 s e navegado sem travamentos.
- **Resumo:** ao selecionar uma sub-região, o cartão mostra o que as camadas ativas têm dentro dela (ex.: "Postes: 1.678 pontos · Linhas MT/BT: 19 km").

## Tema claro e escuro

- O seletor no cabeçalho (sol, lua e monitor) alterna entre **Claro**, **Escuro** e **Seguir o sistema** (padrão). A escolha fica salva neste navegador.
- As cores dos componentes são variáveis CSS (`src/theme.css`) usadas pelo Tailwind (`tailwind.config.js`). Para ajustar uma cor nos dois temas, edite só esse arquivo; os componentes não usam variantes `dark:`.
- No escuro, os tiles do OpenStreetMap são invertidos por filtro CSS, só na tela. As cores de polígonos e pontos do mapa ficam em `MAP_PALETTE` (`MapView.jsx`).

## Uso no celular

O endereço e o código são os mesmos. Abaixo de 1024 px de largura (celular, tablet ou janela estreita), a interface muda de organização; a partir de 1024 px, a versão de computador continua igual.

- **Barra inferior com 5 telas:**
  - **Dados:** modo, importação, desligamento e **Processar Coordenadas**, fixo na parte de baixo da tela.
  - **Regiões:** indicadores compactos e regiões em cartões grandes.
  - **Mapa:** em tela cheia.
  - **Aviso:** carta para as rádios com as ações.
  - **Alertas:** pontos prioritários.
- **Selos nas abas:** quantidade de regiões, alertas pendentes e ponto vermelho no Aviso quando há pendência.
- **Depois do processamento** a tela muda sozinha para **Regiões**, desde que haja ao menos uma região. Com erro ou sem regiões, permanece em **Dados** e mostra o motivo.
- **Regiões:**
  - tocar no cartão abre os detalhes em tela cheia: Voltar, **Ver no mapa**, Nomear/Renomear (modo real), Como citar no aviso e dados da unidade;
  - a caixa de seleção do cartão inclui ou retira a região do aviso.
- **Mapa:**
  - "Camadas" e "Legenda" abrem e fecham;
  - tocar numa região mostra um cartão com "Ver detalhes".
  - "Ver no mapa" (região ou alerta prioritário) troca para o Mapa já focado.
- **Aviso:**
  - o resumo do indicador de transformação fica sempre visível no topo;
  - a comunicação tradicional fica recolhida em "Comparar com a comunicação tradicional";
  - Gerar carta, Copiar texto e Aprovar carta ficam fixos acima da barra.
- **Menu do cabeçalho (☰):** modo, tema (claro, escuro ou seguir o sistema) e usuário, com o link **Sair** quando há Cloudflare Access.
- **Tela cheia:**
  - auditoria e cadastro de pontos prioritários ocupam a tela inteira, com o botão **Fechar** visível;
  - tabelas largas rolam dentro do próprio quadro.
- **Importação:** no celular não há arrastar e soltar; use **Escolher arquivo CSV**.
- **Toque e leitura:**
  - áreas de toque de pelo menos 44 px;
  - campos com 16 px de fonte, para o iOS não aplicar zoom;
  - respeito às áreas seguras (notch e barra de gestos);
  - funciona em retrato e paisagem.
- **Estado preservado:** trocar de tela não perde nada. O estado continua no `App.jsx` e todas as telas ficam montadas. Fora da aba Mapa, o mapa fica invisível mas mantém o tamanho, para o Leaflet não se perder; ao reaparecer, recebe `invalidateSize()`.

## Privacidade

- O CSV é lido com `FileReader` e processado em memória. Não vai para `localStorage` nem é enviado a nenhum serviço. O `localStorage` guarda os nomes de região definidos pelo operador, o último nome de responsável digitado, a preferência de tema e o **cadastro de pontos prioritários** com seu histórico de alertas. Este cadastro é a única exceção que guarda coordenadas, porque a persistência foi pedida; é provisório, sem controle de acesso e não serve para dados reais (ver docs/PONTOS_PRIORITARIOS.md).
- Camadas enviadas (com versões) e sub-regiões ficam no **IndexedDB** deste navegador. Os arquivos são lidos e processados localmente, num Web Worker, e nunca são enviados. O estado das camadas (visível, opacidade, ordem, filtro, mapa base) fica no `localStorage`, sem coordenadas. Uma rede elétrica real é dado sensível de infraestrutura: use dados fictícios ou anonimizados enquanto não houver ambiente corporativo.
- O mapa base de satélite (Esri World Imagery) e as camadas WMS/XYZ são imagens, como os tiles do OpenStreetMap: não recebem coordenadas de pontos, mas o provedor vê qual área está na tela.
- `index.html` declara uma CSP com `connect-src 'self'`, que impede `fetch`/XHR para outros domínios. Os tiles do OpenStreetMap são imagens de fundo e não recebem as coordenadas dos pontos.
- Nenhuma coordenada é registrada no console. O histórico de alertas não guarda coordenadas do CSV.
- Dados do cadastro prioritário nunca entram na carta para as rádios nem na auditoria.
- O `.gitignore` bloqueia `dados/`, `dados_reais/`, `data/private/`, `*.real.csv`, `*.local.csv`, exportações de auditoria e os downloads brutos do IBGE.
- Não use dados reais de clientes em capturas de tela ou demonstrações públicas.

**Acesso pelo Cloudflare Access** (site publicado; ver [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md)):

- O app lê o e-mail do usuário em `/cdn-cgi/access/get-identity` (mesma origem, compatível com a CSP). O objeto de identidade fica **só em memória**: não vai para o console nem para `localStorage`/`sessionStorage`.
- Com identidade, o **e-mail autenticado** é usado como responsável e **fica gravado nos históricos** que já ficam no `localStorage`: nomes de região (definido, alterado, removido, importado), cadastro de pontos prioritários e revisão de alertas. Também aparece no JSON exportado de nomes de região. Neste caso, o e-mail não é salvo como "último responsável digitado".
- A aprovação da carta registra quem aprovou somente em memória; a informação some ao recarregar a página.
- O Cloudflare Access controla **quem abre o site**, mas **não** torna o cadastro de pontos prioritários adequado para dados reais: ele continua no `localStorage` de cada navegador, sem controle de acesso por registro, sem backup e sem compartilhamento entre usuários.
- A identidade exibida é uma **conveniência de front-end para auditoria**. Ela **não substitui autorização em backend**: quem usa o navegador pode alterar os dados locais.
- `public/_headers` acrescenta `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` e uma `Permissions-Policy` restritiva. A CSP do `index.html` não foi afrouxada.

## Estrutura

```
src/
├── App.jsx                     Estado central, modos e layout
├── config.js                   Área demo, tiles, PILOT_CONFIG (território, camada, campos), carta para as rádios
├── theme.css                   Cores dos temas claro e escuro (variáveis CSS)
├── components/
│   ├── Header.jsx              Cabeçalho e seletor de modo (no celular: cabeçalho compacto com menu)
│   ├── MobileNav.jsx           Barra de abas inferior do celular (Dados, Regiões, Mapa, Aviso, Alertas)
│   ├── RegionDetailScreen.jsx  Detalhes da região em tela cheia (celular)
│   ├── CsvUpload.jsx           Importação do modo Demonstração
│   ├── RealImportPanel.jsx     Importação real: prévia, mapeamento, referencial, validação
│   ├── OutageInfo.jsx          Desligamento (demonstração)
│   ├── OutageForm.jsx          Desligamento (formulário do modo real)
│   ├── Timeline.jsx            Linha do tempo operacional
│   ├── KpiCards.jsx            Indicadores derivados do resultado
│   ├── MapView.jsx             Mapa, polígonos, pontos por status, câmera e estados
│   ├── LayerControl.jsx        Camadas e filtros de pontos
│   ├── MapLegend.jsx           Legenda
│   ├── RegionPanel.jsx         Lista de unidades, seleção e detalhes
│   ├── CommunicationPanel.jsx  Comparação, indicador e ações do aviso
│   ├── AuditDialog.jsx         Auditoria: resumo, consistência, rastreio, exportação
│   ├── PriorityAlertsPanel.jsx Alertas de pontos prioritários: resumo, lista e revisão
│   ├── PriorityRegistry.jsx    Painel lateral do cadastro (consulta e formulário)
│   ├── layers/                 Painel de camadas, envio (arquivo/URL), configuração (estilo, versões, compartilhamento), legenda
│   ├── map/                    Panes por camada, tiles das camadas de dados, limites IBGE, sub-regiões, cliques, editor (Geoman)
│   ├── subregions/             Editor, cartão de seleção, painel de gestão e resumo das camadas na sub-região
│   └── StatusBadge.jsx, Toasts.jsx
├── hooks/useIsMobile.js        Detecta o layout de celular (abaixo de 1024 px); só apresentação
├── data/                       Dados FICTÍCIOS do modo Demonstração (inclui demoPriority.js)
└── lib/
    ├── csv.js                  Leitura (separador, BOM, codificação), mapeamento, validação
    ├── layer.js                Carga e validação da camada GeoJSON e da correspondência de nomes
    ├── spatialJoin.js          Cruzamento real (ponto no polígono) e agrupamento
    ├── mockSpatialJoin.js      Simulação do modo Demonstração
    ├── summary.js              Indicadores e linhas de auditoria (fonte única)
    ├── outage.js               Formulário do desligamento → dados exibidos
    ├── communicationUtils.js   Carta para as rádios e textos dos avisos
    ├── announcement.js         Regra de citação: região × propriedades (menos de 3 clientes)
    ├── regionNames.js          Nomes de região do operador: histórico, armazenamento, exportação/importação
    ├── theme.js                Preferência de tema (claro, escuro, sistema)
    ├── priorityRecords.js      Pontos prioritários: estrutura, validação, histórico
    ├── priorityRepository.js   Persistência provisória (localStorage) com contrato trocável por API
    ├── usePriorityRegistry.js  Hook usado pela interface (cadastro + alertas)
    ├── priorityMatch.js        Comparação CSV × cadastro (Haversine + tolerância + identificador)
    ├── priorityAlerts.js       Fluxo de revisão, histórico e bloqueio de validação
    ├── accessIdentity.js       Identidade do Cloudflare Access (somente em memória; null fora do Access)
    ├── useAccessIdentity.js    Hook da identidade para a interface
    ├── geo.js                  Utilitários geométricos
    ├── geoOps.js               Recorte, união, diferença, área/perímetro geodésicos, ponto no polígono rápido
    ├── ibgeHierarchy.js        Hierarquia oficial do IBGE (região-mãe das sub-regiões)
    ├── customRegions.js        Sub-regiões: contenção, sobreposição, nome, histórico, exclusão lógica, exportação
    ├── customRegionRepository.js, useCustomRegions.js   Persistência (IndexedDB) com contrato trocável por API
    ├── useMapWorkspace.jsx     Orquestra camadas, sub-regiões, editor, filtros e resumos no modo real
    ├── layers/                 Modelo de camadas, CRS, importação, .dbf, motor de tiles (Web Worker), IndexedDB, estado por usuário
    └── __tests__/              Testes automatizados
public/data/ibge/               Camada oficial do piloto (a ser gerada) e correspondência de nomes
public/_headers                 Cabeçalhos de segurança do Cloudflare Pages
scripts/
├── preparar_camada_ibge.sh     Download, recorte e conversão da malha do IBGE (GDAL)
├── inspecionar_camada.mjs      Validação e inventário de atributos de um GeoJSON
├── preparar_hierarquia_ibge.mjs  UF, Intermediária, Imediata e municípios do piloto (Malha Municipal 2022)
├── gerar_rede_teste.mjs        Rede elétrica FICTÍCIA (500 mil postes, linhas MT/BT) em SIRGAS 2000 / UTM 23S
├── gerar_teste_cnefe.mjs       CSV de teste com pontos públicos do CNEFE 2022 (não são clientes)
└── validar_cruzamento.mjs      Pipeline da aplicação em linha de comando + comparação com setor de referência
docs/
├── CAMADA_TERRITORIAL.md       Fonte, campos, unidade escolhida, procedimento, limitações
├── CAMADAS_E_SUBREGIOES.md     Sistema de camadas, sub-regiões, desempenho, critérios de aceite e próximos passos
├── DEPLOY_CLOUDFLARE.md        Build, deploy no Pages, configuração do Cloudflare Access, limitações
├── PONTOS_PRIORITARIOS.md      Cadastro manual, regra de comparação, alertas, persistência e limites
└── RELATORIO_VALIDACAO.md      Relatório do teste técnico e modelo para o primeiro teste real
```

## Como a simulação (modo Demonstração) funciona

- `data/mockData.js` gera, com semente fixa, uma grade irregular de 12 unidades **ilustrativas**. Essas geometrias não são fronteiras oficiais.
- Os 100 pontos ficam sempre nas mesmas posições, dentro de quatro unidades nomeadas (24 + 31 + 28 + 17).
- `mockSpatialJoin()` usa a associação **predefinida** de cada ponto (`demoUnitId`). Não é um cruzamento real. Ela devolve o mesmo formato de resultado do modo real, marcado com `source: 'demo'`.

## Limitações conhecidas

- Não há backend. O cruzamento real roda no navegador e foi pensado para um município e uma quantidade controlada de pontos.
- A camada de Cataguases foi convertida sem GDAL; falta a conferência visual independente no QGIS.
- O setor censitário não tem nome próprio. Sem nome definido, a carta usa o nome automático da área do IBGE (distrito + situação), que pode ser amplo; por exemplo, setores rurais vizinhos podem receber o mesmo nome "Zona rural de Sereno". Nomear as regiões resolve isso.
- Coordenadas UTM não são convertidas.
- Pontos prioritários: cadastro só no navegador local, sem autenticação nem controle de acesso. A tolerância de 30 m não foi validada operacionalmente, e sem coluna de cliente/UC no CSV nenhuma correspondência é confirmada. A ausência de alerta não comprova que não há cliente prioritário afetado.
- Não há versão simplificada da camada só para exibição.
- No modo Demonstração, a camada "Rede elétrica" continua desabilitada. No modo real, a rede pode ser enviada em "Adicionar camada".
- Camadas e sub-regiões: sem backend, ficam só neste navegador, e não há isolamento real entre organizações. A regra de visibilidade existe, mas só passa a valer com servidor. GeoPackage, WFS e vector tiles por URL ainda não são aceitos. O tamanho máximo de camada depende da memória do computador. Ver [docs/CAMADAS_E_SUBREGIOES.md](docs/CAMADAS_E_SUBREGIOES.md).
- O indicador de transformação compara apenas a quantidade de itens do aviso. Ele não estima economia financeira.
- Controle de acesso: só o Cloudflare Access, na frente do site. Não há backend, então não há autorização por perfil nem validação do token do Access. O e-mail exibido e gravado nos históricos vem do front-end e serve de rastro, não de prova. Sem o Access (ex.: `npm run dev`), o responsável continua sendo digitado livremente.
- Ambiente de testes limitado a **no máximo 45 usuários**, por uma lista nominal de e-mails num grupo do Cloudflare Access (com exigência de `@energisa.com.br`). O limite vale enquanto a lista tiver no máximo 45 nomes e só administradores autorizados puderem editá-la (ver [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md), passo 3.3).
