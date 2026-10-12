# Relatório de validação: Conecta Rural, piloto com dados reais

## 1. Primeiro conjunto de dados da engenharia: PENDENTE

**Ainda não executado.** O município piloto (Cataguases-MG, `CD_MUN` 3115300) e a camada oficial já estão definidos. Falta um CSV real autorizado e a confirmação do referencial das coordenadas pela engenharia. Preencha os campos abaixo com os números da tela **Auditoria** e com o CSV exportado por ela. Não estime valores.

| Item | Valor |
|---|---|
| Data da execução | |
| Responsável | |
| Arquivo CSV (nome; não anexar) | |
| Referencial declarado | |
| Camada (`camada_piloto.origem.json`: URL, SHA-256, filtro) | |
| Registros importados | |
| Registros válidos / inválidos | |
| Registros com alerta de revisão | |
| Pontos associados | |
| Pontos sem correspondência | |
| Pontos ambíguos | |
| Unidades territoriais identificadas | |
| Soma por unidade = associados? | |
| Clientes / equipamentos / propriedades únicos | |
| Problemas encontrados | |
| Limitações do teste | |
| Conferência independente (QGIS ou campo) | |

## 1b. Primeiro teste com coordenadas reais: pontos públicos do CNEFE 2022 (Cataguases-MG)

**O que é e o que não é.** Os pontos são **endereços reais e públicos** de estabelecimentos agropecuários (fazendas e sítios) registrados pelo IBGE no Censo 2022. **Não são clientes, unidades consumidoras nem equipamentos da Energisa**, e a área de "desligamento" da seção 1b.2 é **hipotética**. O teste substitui o CSV da engenharia enquanto ele não estiver disponível.

**Fonte (verificado em 10/10/2026)**
- CNEFE 2022, `Arquivos_CNEFE/CSV/Municipio/31_MG/3115300_CATAGUASES.zip`, SHA-256 `0678b2545d2efa871313613a4a9ff392e87aa90a6236eee5e3aea1aa2070f7dd`. Contém 37.889 registros de endereço no município.
- Filtro: `COD_ESPECIE = 3` (Estabelecimento agropecuário, segundo o `Dicionario_CNEFE_Censo_2022.xls`), o que resulta em **721 pontos**. Desses, 720 têm `NV_GEO_COORD = 1` (coordenada original do Censo 2022), 1 tem `NV_GEO_COORD = 4` (face de quadra) e 699 têm quadra 0 (área não urbanizada).
- **Referencial: SIRGAS 2000 (EPSG:4674)**, conforme o membro `"crs"` do GeoJSON oficial do CNEFE para o município (`qg_810_endereco_Munic3115300.json`). Os dicionários CSV não informam o referencial.
- Privacidade: `DSC_ESTABELECIMENTO` (que em alguns registros traz nome de pessoa) e o logradouro **não** foram copiados. Os CSVs gerados estão em `dados/`, pasta ignorada pelo git.
- **Referência independente:** cada registro do CNEFE traz o `COD_SETOR` atribuído pelo IBGE, que foi comparado ponto a ponto com o setor calculado pelo Conecta Rural.
- Reprodução: `node scripts/gerar_teste_cnefe.mjs <CNEFE.csv> <saida.csv> [--centro lat,lng --raio-km N]` e `node scripts/validar_cruzamento.mjs <saida.csv> public/data/ibge/camada_piloto.geojson setor_ibge_cnefe`.

### 1b.1 Município inteiro: 721 estabelecimentos agropecuários

| Item | Resultado |
|---|---|
| Importados / válidos / inválidos | 721 / 721 / 0 |
| Alertas de revisão | 8 (coordenada repetida em registros diferentes) |
| Associados / sem correspondência / ambíguos | **721 / 0 / 0** |
| Unidades (setores) identificadas | 26 |
| Soma por unidade = associados | 721 = 721 |
| Tempo do cruzamento | 91 ms (script); interface sem atraso perceptível |
| **Correção geométrica do motor** | Uma implementação independente (ray casting em Python, sem Turf) chegou às mesmas atribuições em **721 de 721** pontos |
| **Concordância com o setor do IBGE (CNEFE)** | 642 de 721 (**89,0%**) |
| Divergências: código CNEFE inexistente na malha final | 54: `311530005000080` (52) e `311530005000103` (2). O motor colocou esses pontos em `…000138` (53) e `…000133` (1) |
| Concordância excluindo esses 54 | 642 de 667 (**96,3%**) |
| Divergências perto de limites | 25: 14 a menos de 20 m do limite do setor de referência, 1 a 43 m e 10 entre 64 m e 254 m, todas entre setores rurais vizinhos (sede, Sereno, Cataguarino, Glória) |

**Interpretação:**
- O cruzamento está correto do ponto de vista geométrico (confirmado pela implementação independente).
- As divergências vêm de diferenças entre o dado do CNEFE e a malha. Os códigos do CNEFE terminam em "P", e dois deles não existem na malha final de 140 setores: **hipótese** de recodificação entre a versão preliminar e a final, ainda não confirmada em documento do IBGE.
- As divergências de dezenas a centenas de metros indicam que, em alguns endereços rurais, o setor de cadastro não coincide com a posição da coordenada.
- Para a operação, isso reforça a regra adotada: a associação segue a coordenada informada, e casos perto de limites merecem conferência.

### 1b.2 Desligamento hipotético: raio de 5 km da vila de Sereno

- Centro: −21,31484, −42,64757 (centro da caixa envolvente dos setores urbanos do distrito de Sereno na camada oficial).
- Arquivo: `dados/teste_cnefe_agro_desligamento_hipotetico_sereno_5km.csv`.
- Execução na interface (Edge headless), com referencial declarado SIRGAS 2000 e desligamento fictício em 20/10/2026, das 8h às 12h, com aviso em 15/10/2026.

| Item | Resultado |
|---|---|
| Importados / válidos / inválidos | 108 / 108 / 0 |
| Associados / sem correspondência / ambíguos | 108 / 0 / 0 |
| **Unidades identificadas** | **6**, para 108 estabelecimentos |
| Soma por unidade = associados | 108 = 108 |
| Concordância com o setor do IBGE | 104 de 108 (96,3%) |
| Antecedência calculada | 5 dias |
| Aviso | 6 pendências de denominação; aprovação bloqueada (comportamento esperado) |
| Erros no console / coordenadas em URLs externas | Nenhum / nenhuma |

| Setor (código oficial) | Distrito / situação (IBGE) | Pontos | Localidades do CNEFE presentes (pontos) |
|---|---|---|---|
| 311530015000003 | Sereno / Rural | 80 | SERENO (41), BELA VISTA (10), ITAPIRA (8), JOAQUIM VIEIRA (8), PALMARES (6), GLORIA (3), SERENINHO (2), PARADINHA (1) |
| 311530012000002 | Glória de Cataguases / Rural | 14 | GLORIA (14) |
| 311530005000137 | Cataguases / Rural | 7 | SAO DINIZ (4), PONTE ALTA (2), AREIA BRANCA (1) |
| 311530005000078 | Cataguases / Rural | 5 | ESTRADA SAO PEDRO (2), PALMARES (2), outra (1) |
| 311530015000002 | Sereno / Urbana | 1 | SERENO (1) |
| 311530015000004 | Sereno / Rural | 1 | SERENO (1) |

**Achado para a regra de comunicação:** um único setor (`…015000003`) reúne 8 localidades do Censo. Avisar "moradores de Sereno" deixaria de fora quem se identifica como de Bela Vista, Itapira ou Joaquim Vieira. A tabela de correspondência precisa definir, por setor, **quais nomes de localidade** serão citados. O campo `DSC_LOCALIDADE` do CNEFE é uma fonte oficial para propor esses nomes, que depois precisam de validação local.

### 1b.3 Problemas e limitações deste teste
- Os pontos não são clientes da Energisa; a distribuição real de unidades consumidoras pode ser diferente.
- A área de desligamento é hipotética (raio), não um alimentador real.
- A camada ainda está com status de conferência pendente.
- A hipótese sobre os códigos `…080` e `…103` do CNEFE não foi confirmada.

## 2. Teste técnico executado (NÃO é o piloto)

Este teste confere o funcionamento da cadeia completa com **geometria oficial real** e um **CSV sintético**. Não usa o município piloto nem dados de clientes. Os arquivos ficaram fora do projeto, e a configuração foi revertida para `not-configured` ao final.

- **Data:** 10/10/2026
- **Camada:** malha de setores do Censo 2022, IBGE, arquivo `DF_setores_CD2022.zip` (SHA-256 `597896af…dc3211`), filtrada por `SITUACAO = 'Rural'`. Resultado: 393 setores, todos Polygon, 16 com buracos, 4,6 MB. Sem GDAL disponível, a conversão foi feita por um leitor de shapefile escrito para o teste. O CRS de origem é SIRGAS 2000 geográfico, sem reprojeção.
- **CSV sintético:** 64 registros com separador `;`, vírgula decimal e codificação Windows-1252. São 60 pontos pseudoaleatórios na caixa envolvente da camada, 1 ponto sobre um vértice compartilhado por dois setores, 1 linha com latitude e longitude trocadas, 1 linha com latitude vazia e 1 linha com id repetido.
- **Execução:** interface real (`npm run dev`) dirigida pelo Microsoft Edge em modo headless (puppeteer-core).

| Verificação | Resultado observado |
|---|---|
| Codificação detectada | Windows-1252 |
| Processar bloqueado sem referencial declarado | Sim |
| Importados / válidos / inválidos | 64 / 61 / 3 (invertida, vazia e id repetido, cada uma com motivo) |
| Associados / sem correspondência / ambíguos | 41 / 19 / 1 |
| Unidades identificadas | 32 |
| Soma por unidade = associados | 41 = 41 |
| Associados + sem correspondência + ambíguos = válidos | 61 = 61 |
| Pontos sem correspondência | Ficam na área urbana, que não pertence à camada rural carregada (esperado) |
| Ponto sobre vértice compartilhado | Ambíguo, com os dois setores como candidatos |
| Aviso com setores sem nome validado | Mostra "[denominação pendente…]" e a aprovação fica bloqueada |
| Data e horário digitados no formulário | Aparecem no aviso ("20 de outubro de 2026, das 8h às 12h") |
| Clientes únicos (coluna mapeada) / equipamentos (não mapeada) | 46 / "não identificável" |
| Troca para Demonstração | Nenhum dado do teste real permanece |
| Requisições externas | Somente tiles do OpenStreetMap (imagens) e Google Fonts. Nenhuma URL externa com coordenadas. |
| Erros no console do navegador | Nenhum |

**Defeito encontrado e corrigido durante o teste:** a camada ficava presa em "Carregando". O efeito de carregamento abortava a própria requisição ao mudar de estado. Corrigido em `src/App.jsx`.

## 2b. Teste técnico com a camada do piloto (Cataguases-MG): NÃO é teste com dados reais

- **Data:** 10/10/2026. A camada é `public/data/ibge/camada_piloto.geojson` (140 setores).
- **CSV sintético:** 64 registros (60 pontos pseudoaleatórios na caixa envolvente do município, 1 sobre um vértice compartilhado, 1 invertido, 1 vazio e 1 com id repetido), em Windows-1252, referencial declarado SIRGAS 2000.

| Verificação | Resultado observado |
|---|---|
| Importados / válidos / inválidos | 64 / 61 / 3 |
| Associados / sem correspondência / ambíguos | 37 / 23 / 1 (os sem correspondência caem nos cantos da caixa, fora do município) |
| Unidades identificadas | 16 |
| Soma por unidade = associados | 37 = 37 |
| Contexto exibido | Distrito e situação (ex.: "Aracati de Minas \| Rural"), sem entrar no aviso |
| Aviso | Pendências de denominação; aprovação bloqueada |
| Erros no console / coordenadas em URLs externas | Nenhum / nenhuma |

**Arquivo `exemplos/desligamento_alimentador_CAT04.csv`:** é fictício, com coordenadas em Mato Grosso. Com a camada de Cataguases, resultou em 100 válidos e **100 sem correspondência**, o comportamento correto. Ele não serve para testar o piloto.

## 2c. Pontos prioritários (cadastro manual e alertas): teste com dados FICTÍCIOS

Executado em 10/10/2026. **Não é teste com dados reais de clientes.**

### Testes automatizados

`src/lib/__tests__/priority.test.js` tem 21 testes, todos passando, e cobre os 15 cenários exigidos:

| Cenário | Teste |
|---|---|
| 1. Cadastro válido | › 1 |
| 2. Coordenadas inválidas | › 2 |
| 3. Aviso de duplicidade | › 3 |
| 4. Edição, desativação e exclusão | › 4 |
| 5. Persistência após recarregar | › 5 |
| 6. Dentro da tolerância | › 6 |
| 7. Fora da tolerância | › 7 |
| 8. Coordenadas inválidas no CSV / referencial | › 8 |
| 9. Dois cadastros próximos do mesmo ponto | › 9 |
| 10. Um ponto perto de vários cadastros | › 10 |
| 11. CSV sem correspondências | › 11 |
| 12. Cadastro inativo | › 12 |
| 13. Demo × real separados | › 13 |
| 14. Mapa × painel consistentes | › 14 |
| 15. Pendência de vital sem falsa aprovação | › 15 |
| Reabertura quando a correspondência muda | reavaliação |

### Teste de interface (navegador Edge automatizado, perfil limpo)

**Demonstração** (6 registros fictícios):
- Resumo: 100 pontos analisados, 0 confirmados, 2 possíveis, 2 em revisão, 97 sem correspondência, 0 não comparados.
  - Alertas: DEMO-A-01 possível (7,2 m), DEMO-B-01 possível (12,8 m), DEMO-A-02 e DEMO-B-02 em revisão (ambos perto do ponto PT-071).
  - O cadastro inativo DEMO-A-03 e o distante DEMO-B-03 não geraram alerta.
- "Aprovar carta" ficou desabilitado e a linha do tempo mostrou "Revisão de pontos prioritários pendente".
- Abrir detalhes e copiar a carta não alterou o status.
- Depois de concluir os dois alertas A, a aprovação foi liberada.
- Latitude 95 foi rejeitada.
- Um novo registro a ~4 m de DEMO-A-01 gerou o aviso de duplicidade e foi salvo com "Salvar mesmo assim". Com ele:
  - DEMO-A-01 passou a "exige revisão" e a conclusão anterior foi reaberta;
  - a carta aprovada voltou para rascunho.
- Depois de recarregar a página, o cadastro continuou com 7 registros.

**Teste real** (`dados/teste_cnefe_sereno_com_cliente_e_propriedade_SINTETICOS.csv`, coordenadas CNEFE com clientes **sintéticos**; 3 registros fictícios):
- O cadastro do modo real começou vazio, separado da demonstração.
- Resumo: 108 analisados, 1 confirmado, 1 possível, 0 em revisão, 104 sem correspondência.
  - PP-0001 (A, código UC-TESTE-001, a 6,8 m): confirmado.
  - PP-0002 (B, sem código, a 8,5 m): possível.
  - PP-0003, distante: sem alerta.
- A carta não contém nenhum dado do cadastro.
- Com tolerância de 5 m, PP-0001 passou a "exige revisão" (código coincide, mas fora da tolerância) e PP-0002 saiu da lista.
- Desligar a camada de prioritários removeu os marcadores e manteve os alertas.
- Nenhum erro no console.

**Não verificado:** regra de tolerância com dados reais da engenharia, uso com o cadastro corporativo e controle de acesso (inexistente).

## 3. Testes automatizados

`npm test` (Vitest 2.1.8): **39 testes, 4 arquivos, todos passando** em 10/10/2026.

| Caso exigido | Teste |
|---|---|
| 1. Ponto dentro | `spatialJoin.test.js` › 1 |
| 2. Ponto fora (sem vizinho mais próximo) | › 2 |
| 3. Ponto sobre limite (comum e externo) | › 3a, 3b |
| 4. Ponto em mais de uma geometria | › 4 |
| 5. MultiPolygon (ilha, buraco, borda do buraco) | › 5 |
| 6. Coordenadas inválidas | `csv.test.js` › 6 |
| 7. CSV vazio / sem colunas | › 7a, 7b, 7c |
| 8. Duplicados | › 8 |
| 9. Contagem por unidade | `spatialJoin.test.js` › 9 |
| 10–12. Aviso com várias, uma e nenhuma unidade | `communication.test.js` › 10, 11, 12 |
| 13. Consistência lista × mapa × KPIs | `spatialJoin.test.js` › 13 |
| Regressão do modo demonstração (24+31+28+17) | `demo.test.js` |

As geometrias dos testes são pequenas e fictícias. Elas validam o algoritmo, não a camada oficial.
