# Camadas do mapa e sub-regiões

Disponível só no modo **Teste com dados reais**. A Demonstração continua com o controle de camadas simples e a área fictícia.

> **Sub-regiões da organização desligadas (18/10/2026).** As comunidades cobrem o uso: `FEATURES.orgSubregions = false` em `src/config.js`.
> - Somem a camada "Sub-regiões", o botão "Sub-regiões" (virou "Comunidades") e o "Criar sub-região aqui".
> - O código e os dados já gravados no navegador continuam; para voltar, troque para `true`.
> - As comunidades usam a mesma base (editor, IndexedDB, histórico) e não mudam.

Esta etapa é um **MVP somente front-end**, no mesmo padrão do cadastro de pontos prioritários: tudo roda e fica salvo **neste navegador**. A especificação original pede PostgreSQL + PostGIS, vector tiles servidos pelo backend e permissões por organização. O modelo de dados abaixo já segue essa especificação, para que a troca do armazenamento por uma API não mude a interface.

## Visão geral

| Peça | Onde fica | Arquivos |
|---|---|---|
| Hierarquia oficial do IBGE (UF → Intermediária → Imediata → Municípios) | `public/data/ibge/hierarquia_piloto.geojson` (versionado) | `scripts/preparar_hierarquia_ibge.mjs`, `src/lib/ibgeHierarchy.js` |
| Sub-regiões | IndexedDB do navegador | `src/lib/customRegions.js` (regras), `src/lib/customRegionRepository.js`, `src/lib/useCustomRegions.js` |
| Camadas de dados enviadas | IndexedDB do navegador | `src/lib/layers/*` |
| Estado das camadas por usuário | localStorage | `src/lib/layers/userLayerState.js` |
| Orquestração (painel, editor, diálogos) | — | `src/lib/useMapWorkspace.jsx` |

## Hierarquia do IBGE

- **Fonte:** Malha Municipal 2022 do IBGE (Shapefile por UF, SIRGAS 2000). É a mesma base dos setores censitários do Censo 2022 usados na camada piloto.
- **Conferência:** a união dos 140 setores de Cataguases coincide com o limite municipal oficial: 493,1 km² nos dois, com 1 m² de diferença. Por isso uma sub-região montada com setores não sofre recortes indevidos na borda.
- **Recorte gravado:** a área de concessão da Energisa Minas Rio (lista em `scripts/ibge/municipios_energisa_mr.txt`):
  - MG e RJ;
  - Intermediárias de Juiz de Fora (3106) e Petrópolis (3303);
  - as 11 Imediatas desses municípios;
  - os 67 municípios (65 de MG, mais Nova Friburgo e Sumidouro).
- **Precisão:** municípios e Imediata estão em geometria integral. UF e Intermediária receberam simplificação Douglas-Peucker de cerca de 5 m, muito abaixo da tolerância de 50 m.
- **Regerar** (baixa os ZIPs para `scripts/ibge/raw/hierarquia/`, que é ignorada pelo git):

  ```bash
  node scripts/preparar_hierarquia_ibge.mjs --lista scripts/ibge/municipios_energisa_mr.txt
  # só a Imediata do piloto: node scripts/preparar_hierarquia_ibge.mjs MG 3115300
  ```

  O script grava SHA-256, URLs e a conferência em `hierarquia_piloto.origem.json`.
- **Outro município piloto:** troque os argumentos. As Grandes Regiões e as demais UFs não foram carregadas (decisão desta etapa).

## Sub-regiões (`custom_regions`)

### Regras (`src/lib/customRegions.js`, testadas em `__tests__/customRegions.test.js`)

- Toda sub-região tem uma **região-mãe do IBGE** (`ibgeParentCode`). Ela pode estar aninhada em outra sub-região (`parentCustomRegionId`).
- **Contenção.** A área é sempre recortada pela região-mãe (interseção).
  - Se o que ficou fora passa de `CUSTOM_REGION_RULES.toleranceMeters` (padrão 50 m), o editor avisa quanto será recortado e até que distância da borda.
  - Abaixo da tolerância, o recorte é silencioso (imprecisão de desenho).
- **Sobreposição entre irmãs** (mesma organização, mesma região-mãe IBGE e mesma sub-região-mãe):
  - bloqueada por padrão;
  - o administrador pode permitir no painel "Sub-regiões" (a configuração fica salva por organização);
  - bordas coincidentes não contam: há um limiar de 50 m².
- **Nome:**
  - obrigatório;
  - único entre as irmãs, sem diferenciar maiúsculas, acentos e espaços.
- **Campos opcionais:** descrição, cor, código interno e tags.
- **Área e perímetro:** recalculados a cada criação ou edição, na esfera (metros reais).
- **Edição da sub-região-mãe:** não pode deixar de fora uma sub-região filha.
- **Exclusão:**
  - é lógica (`deletedAt`) e inclui as descendentes;
  - é possível restaurar;
  - o histórico (criada, editada, área editada, excluída, restaurada) nunca é apagado.

### Formas de criação

1. **Desenhar:** polígono livre ou retângulo (Leaflet-Geoman), com ajuste de vértices e encaixe (snapping) nas bordas da região-mãe e das camadas visíveis.
2. **Selecionar no mapa:**
   - em UF, Intermediária e Imediata, selecionam-se **municípios**;
   - dentro do município piloto, selecionam-se **setores censitários**, a unidade que a carta para as rádios já usa;
   - a geometria é a união das unidades escolhidas;
   - os códigos ficam em `municipalityCodes` ou `sectorCodes`.
3. **Importar:**
   - GeoJSON, KML/KMZ ou Shapefile (.zip com .prj);
   - todos os polígonos do arquivo são unidos e depois podem ser ajustados no mapa.

### Interface

- **Cartão de seleção:** clicar numa região do mapa abre o cartão.
  - Quando há mais de uma camada no ponto (sub-região, município, Imediata…), chips permitem escolher.
  - Ações: **Criar sub-região aqui**, Enquadrar, Filtrar camadas e Detalhes.
- **Editor:**
  - escurece o mapa fora da região-mãe e valida em tempo real: fora da região-mãe, recorte, sobreposição e nome repetido;
  - no computador, fica à direita;
  - no celular, é uma folha embaixo (no máximo 48% da altura) com os campos secundários recolhidos.
- **Painel "Sub-regiões"** (botão no cabeçalho do mapa):
  - árvore "Região IBGE › Sub-regiões" (com aninhamento) e busca por nome, código ou tag;
  - detalhes, renomear, editar área, criar dentro, duplicar, excluir e restaurar;
  - exportar GeoJSON e ver o histórico.
- **Duplicar:** abre o editor com a mesma área. Com a sobreposição bloqueada, é preciso ajustar a área antes de salvar.

## Sistema de camadas

### Tipos

| Tipo | Exemplos | Edição |
|---|---|---|
| Mapa base | Ruas (OpenStreetMap), Satélite (Esri World Imagery); um por vez | — |
| Operação | Pontos do CSV, pontos prioritários, setores censitários | visibilidade, opacidade, ordem |
| Limites IBGE | um por nível | somente leitura |
| Sub-regiões | as da organização | painel próprio |
| Dados | camadas enviadas pela organização | estilo, dados, versões, compartilhamento |
| Externas | WMS ou XYZ por URL (https) | estilo do provedor |

WFS e vector tiles por URL **não** estão disponíveis: exigem baixar dados de outro domínio, e a CSP (`connect-src 'self'`) bloqueia isso de propósito. Ficam para quando houver backend ou proxy.

### Painel de camadas

- **Árvore de grupos:** grupos criados pelo caminho informado no envio, ex.: `Energisa > Rede Elétrica`.
- **Por camada:**
  - ligar/desligar;
  - opacidade;
  - zoom para a camada;
  - legenda automática;
  - filtro "só dentro da sub-região";
  - "Configurar".
- **Ordem:** reordene arrastando ou com as setas. O que está mais acima no painel fica mais acima no mapa.
- **Implementação:**
  - cada camada tem o próprio *pane* do Leaflet (z-index e opacidade);
  - pontos do CSV e setores dividem um pane, porque dois canvas interativos se bloqueariam;
  - a opacidade dessas duas camadas vai pelo estilo.
- **Estado por usuário:**
  - salvo no localStorage, por e-mail do Cloudflare Access ou "local";
  - inclui visível, opacidade, ordem, filtro, mapa base e grupos recolhidos;
  - volta igual ao recarregar.

### Envio de camadas

- **Formatos aceitos:**
  - GeoJSON;
  - KML/KMZ;
  - Shapefile (.zip);
  - CSV com longitude/latitude, ou E/N em UTM.
- **GeoPackage:** ainda não é aceito (exigiria SQLite no navegador). A mensagem orienta a exportar como Shapefile ou GeoJSON.
- **Referencial:**
  - tudo é reprojetado para EPSG:4326;
  - o CRS é lido do `.prj` (SIRGAS 2000, SIRGAS 2000 / UTM 18S–25S, WGS 84 / UTM, SAD69 / UTM 22S–24S, ou o próprio WKT);
  - sem `.prj` e com coordenadas em metros, o usuário escolhe;
  - para CSV, o referencial é sempre confirmado, como no restante do modo real.
- **Correção de geometrias** (equivalente simplificado do `ST_MakeValid`):
  - fecha anéis;
  - remove vértices repetidos;
  - corrige autointerseção pela união do polígono consigo mesmo;
  - rejeita o que não tem conserto, como geometria ausente, linha com 1 ponto ou coordenada fora da faixa depois da reprojeção.
- **Relatório de rejeitadas:** aparece na tela e pode ser baixado em CSV.
- **Pré-visualização antes de confirmar:**
  - contagem por tipo;
  - extensão no mapa, com uma amostra de 1.500 feições;
  - atributos detectados, com a escolha de quais manter;
  - estilo inicial, grupo e visibilidade.
- **Processamento:** acontece em um **Web Worker**, com barra de progresso, sem travar o mapa.
- **Atualização:** substituir ou anexar cria uma nova versão. As anteriores ficam no histórico; "Liberar espaço" apaga as feições de uma versão antiga e mantém o registro dela.
- **Estilo:**
  - único, por categorias (valores distintos) ou por classes numéricas (quantis), ex.: cor das linhas por `TENSAO`;
  - define o zoom mínimo e máximo;
  - a legenda segue o estilo.

### Desempenho com centenas de milhares de feições

GeoJSON bruto nunca vai para o mapa. No Worker:

- **Pontos:** índice espacial (Flatbush) em Web Mercator. Cada tile é uma consulta por caixa; abaixo do zoom 15, fica no máximo um ponto por pixel.
- **Linhas e polígonos:** geojson-vt, que corta e simplifica por zoom (é o equivalente local do `ST_AsMVT`).
- **Envio ao mapa:** os tiles vão em arrays tipados, transferidos sem cópia, e são desenhados em canvas agrupando as feições por estilo.
- **Leitura de .dbf:** feita por um leitor próprio (`src/lib/layers/dbf.js`). O do pacote `shpjs` levava 16 s para 500 mil registros.

Medido nesta máquina, com Edge headless, num Shapefile **fictício** de 500 mil postes em SIRGAS 2000 / UTM 23S (`scripts/gerar_rede_teste.mjs`):

| Etapa | Tempo |
|---|---|
| Leitura, reprojeção e pré-visualização | ~3,5 s |
| Gravação no IndexedDB e índice | ~3 s |
| Maior tarefa na thread da interface durante a importação | 111–199 ms |
| Tarefas acima de 50 ms ao navegar (zoom 10–14, panorâmicas) com os 500 mil postes e 5.680 linhas | 0 |
| Resumo dentro de um polígono (246 mil pontos) | ~150 ms |

Para gerar a rede fictícia (gravada em `dados/rede_teste/`, ignorada pelo git):

```bash
node scripts/gerar_rede_teste.mjs            # 500.000 postes + linhas MT/BT + subestações
```

### Integração sub-regiões × camadas

- **Resumo:** ao selecionar uma sub-região, o cartão e os detalhes mostram o resumo das camadas ativas dentro dela, ex.: "Postes: 1.678 pontos · Linhas MT/BT: 19 km". Pontos do CSV e prioritários também entram.
- **Cálculo:** comprimentos e áreas são geodésicos.
- **Filtro:** "Filtrar camadas" (cartão) ou o filtro nas opções de cada camada mostram só o que toca a sub-região. O filtro é recalculado se a sub-região mudar.

## Papéis e visibilidade

- **Papéis:**
  - `ROLES` em `src/config.js` mapeia o e-mail do Cloudflare Access ao papel `admin`, `editor` ou `viewer`;
  - o padrão é `admin`, porque sem backend todo usuário deste navegador já pode alterar os dados locais;
  - a interface esconde as ações que o papel não permite.
- **Visibilidade das camadas** (privada, organização, pública ou compartilhada com organizações específicas): a regra está em `canViewLayer`/`canEditLayer` (`layerModel.js`) e é testada.
- **Limitação:** sem servidor, só existe uma organização por navegador. A regra fica pronta para a API, mas **não isola nada entre organizações hoje**.
- **Camadas IBGE:** imutáveis para todos.

## Situação dos critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Criar sub-região pelos três métodos em qualquer nível IBGE | Atendido nos níveis carregados (MG, Intermediária, Imediata, municípios da Imediata). Seleção de municípios nos níveis acima do município; de setores no município piloto. |
| 2 | Desenho que ultrapassa a borda é recortado e avisado | Atendido (testado no navegador: 23,2 km² recortados, com aviso). |
| 3 | Nome duplicado e sobreposição bloqueados com mensagem | Atendido. |
| 4 | Shapefile UTM com 500 mil feições, reprojetado, em segundo plano, navegável | Atendido no navegador (ver tabela de desempenho). Depende da memória do computador; não há processamento no servidor. |
| 5 | Ligar, desligar, reordenar, opacidade, com estado após recarregar | Atendido (por usuário, neste navegador). |
| 6 | Estilo por atributo e legenda | Atendido (categorias e quantis). |
| 7 | Resumo das camadas ativas dentro da sub-região | Atendido. |
| 8 | Usuário de uma organização não vê camadas privadas de outra | **Não atendível sem backend.** A regra de visibilidade está implementada e testada, mas os dados ficam no navegador de cada usuário. |

## Privacidade e armazenamento

- Os arquivos enviados são lidos e processados **só no navegador**: nada é enviado a servidor.
- Camadas, versões e sub-regiões ficam no **IndexedDB deste navegador** (`conecta-rural-camadas`):
  - não aparecem em outro computador nem em outro perfil;
  - não têm controle de acesso;
  - são apagadas pela limpeza dos dados do site.
- Uma rede elétrica real é dado sensível de infraestrutura: use dados fictícios ou anonimizados até existir um ambiente corporativo.
- Os mapas base são imagens (OpenStreetMap, Esri) e não recebem coordenadas de pontos. Como em qualquer mapa online, o provedor vê qual área está na tela.

## Próximos passos (backend)

1. **Tabelas:** `ibge_regions`, `custom_regions`, `layers`, `layer_features` (com GiST e particionamento), `layer_groups`, `layer_shares`, `layer_uploads` e `user_layer_state`, com os mesmos campos dos registros atuais, em snake_case.
2. **Repositórios:** trocar `createLocalRegionRepository` e o `layerStore` por chamadas à API. Os contratos já são assíncronos.
3. **Importação no servidor:** GDAL/ogr2ogr (inclui GeoPackage), `ST_MakeValid`, `ST_Transform` e tiles por `ST_AsMVT` ou PMTiles (tippecanoe) para redes de milhões de feições.
4. **Autorização:** validar o token do Cloudflare Access no backend e aplicar papéis e visibilidade nas consultas. Só então o critério 8 passa a valer.
5. **Liberar a CSP** para o domínio da API (e, se desejado, WFS/MVT).
