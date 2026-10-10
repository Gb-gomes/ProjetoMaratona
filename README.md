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
| vitest 2.1 (dev) | Testes automatizados |

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

## Tema claro e escuro

- O seletor no cabeçalho (sol, lua e monitor) alterna entre **Claro**, **Escuro** e **Seguir o sistema** (padrão). A escolha fica salva neste navegador.
- As cores dos componentes são variáveis CSS (`src/theme.css`) usadas pelo Tailwind (`tailwind.config.js`). Para ajustar uma cor nos dois temas, edite só esse arquivo; os componentes não usam variantes `dark:`.
- No escuro, os tiles do OpenStreetMap são invertidos por filtro CSS, só na tela. As cores de polígonos e pontos do mapa ficam em `MAP_PALETTE` (`MapView.jsx`).

## Privacidade

- O CSV é lido com `FileReader` e processado em memória. Não vai para `localStorage` nem é enviado a nenhum serviço. O `localStorage` guarda apenas os nomes de região definidos pelo operador, o último nome de responsável digitado e a preferência de tema.
- `index.html` declara uma CSP com `connect-src 'self'`, que impede `fetch`/XHR para outros domínios. Os tiles do OpenStreetMap são imagens de fundo e não recebem as coordenadas dos pontos.
- Nenhuma coordenada é registrada no console.
- O `.gitignore` bloqueia `dados/`, `dados_reais/`, `data/private/`, `*.real.csv`, `*.local.csv`, exportações de auditoria e os downloads brutos do IBGE.
- Não use dados reais de clientes em capturas de tela ou demonstrações públicas.

## Estrutura

```
src/
├── App.jsx                     Estado central, modos e layout
├── config.js                   Área demo, tiles, PILOT_CONFIG (território, camada, campos), carta para as rádios
├── theme.css                   Cores dos temas claro e escuro (variáveis CSS)
├── components/
│   ├── Header.jsx              Cabeçalho e seletor de modo
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
│   └── StatusBadge.jsx, Toasts.jsx
├── data/                       Dados FICTÍCIOS do modo Demonstração
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
    ├── geo.js                  Utilitários geométricos
    └── __tests__/              Testes automatizados
public/data/ibge/               Camada oficial do piloto (a ser gerada) e correspondência de nomes
scripts/
├── preparar_camada_ibge.sh     Download, recorte e conversão da malha do IBGE (GDAL)
├── inspecionar_camada.mjs      Validação e inventário de atributos de um GeoJSON
├── gerar_teste_cnefe.mjs       CSV de teste com pontos públicos do CNEFE 2022 (não são clientes)
└── validar_cruzamento.mjs      Pipeline da aplicação em linha de comando + comparação com setor de referência
docs/
├── CAMADA_TERRITORIAL.md       Fonte, campos, unidade escolhida, procedimento, limitações
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
- Não há versão simplificada da camada só para exibição.
- A camada "Rede elétrica" está desabilitada por falta de dados.
- O indicador de transformação compara apenas a quantidade de itens do aviso. Ele não estima economia financeira.
