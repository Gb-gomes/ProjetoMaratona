# Camada territorial do piloto

## Situação atual

| Item | Situação |
|---|---|
| Município piloto | **Cataguases (MG)**, `CD_MUN` **3115300**, conferido no arquivo oficial. Não confundir com Santana de Cataguases (`3158409`), outro município que também aparece numa busca por nome. |
| Camada do piloto | `public/data/ibge/camada_piloto.geojson`: 140 setores, 0,68 MB, obtida em 10/10/2026. A origem está em `camada_piloto.origem.json`. |
| `PILOT_CONFIG.status` (`src/config.js`) | `'official-unvalidated'`: camada oficial carregada, **conferência visual independente ainda não registrada**. |
| Validação da camada | Verificações automáticas aprovadas (ver abaixo). Falta a conferência no QGIS. |

Os fatos marcados como **verificado** vêm de inspeção direta dos arquivos oficiais, feita em 10/10/2026.

## Piloto: Cataguases (MG)

**Arquivo de origem:** `MG_setores_CD2022.zip`, 96.003.091 bytes, SHA-256 `5e001cb4149fad84a8a7491aaec7b97dd6f80c5e01b797bdd0851ff8bc0ff18c`, com 51.387 setores na UF. CRS SIRGAS 2000 geográfico, codificação UTF-8. A estrutura de campos é idêntica à descrita abaixo.

**Recorte:** `CD_MUN = '3115300'`, que resulta em 140 setores, todos Polygon e 5 com buracos, com 25.216 vértices. Caixa envolvente: lat −21,46077 a −21,20327; lng −42,80178 a −42,50240.

**Como foi convertido:** o GDAL não estava disponível (o Docker Desktop estava parado). A conversão foi feita por um leitor de shapefile em Python, sem dependências. As coordenadas foram copiadas sem transformação, como o `ogr2ogr` faz de SIRGAS 2000 para EPSG:4326, arredondadas a 7 casas, com orientação RFC 7946 e sem simplificação. Quando houver GDAL, rode `scripts/preparar_camada_ibge.sh MG 3115300` e compare os resultados.

**Verificações (todas aprovadas):**
- 29 atributos oficiais preservados; `CD_SETOR` único.
- Anéis fechados, com 4 ou mais pontos, sem autointerseção e com buracos dentro do anel externo: 0 problemas. O verificador foi testado antes com um polígono inválido conhecido, que foi detectado.
- Sobreposição: 20.000 pontos sorteados na caixa envolvente, nenhum dentro de mais de um setor. O processamento levou 263 ms.
- `scripts/inspecionar_camada.mjs`: camada utilizável.

**Composição territorial (verificado):**

| Distrito (`NM_DIST`) | Setores rurais | Área rural | Setores urbanos | Área urbana |
|---|---|---|---|---|
| Cataguases (sede) | 7 | 172,2 km² | 121 | 37,7 km² |
| Sereno | 2 | 73,2 km² | 2 | 0,6 km² |
| Cataguarino | 1 | 62,2 km² | 1 | 0,5 km² |
| Glória de Cataguases | 1 | 59,2 km² | 1 | 0,2 km² |
| Aracati de Minas | 1 | 56,5 km² | 1 | 0,5 km² |
| Vista Alegre | 1 | 28,7 km² | 1 | 0,3 km² |

`NM_SUBDIST`, `NM_BAIRRO`, `NM_NU` e `NM_AGLOM` estão **vazios** em todos os 140 setores.

**Consequência para o aviso:** a zona rural (~452 km²) é coberta por apenas 13 setores grandes. Fora da sede, cada distrito tem 1 ou 2 setores rurais e a sua vila, então ali o setor é praticamente equivalente ao distrito, que **tem nome oficial**. Já os 7 setores rurais da sede cobrem 172 km² e não têm nenhum nome na malha; o nome do distrito ("Cataguases") designaria a cidade inteira. A aplicação mostra o distrito como **contexto** (`contextFields`), mas não o usa no aviso. Usar nomes de distrito na locução é uma regra de negócio que precisa ser decidida e registrada na tabela de correspondência.

## Fonte oficial

- **Produto:** Malhas de Setores Censitários e Divisões Intramunicipais, Censo 2022, IBGE.
- **Página:** https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/26565-malhas-de-setores-censitarios-divisoes-intramunicipais.html
- **Diretório:** https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/
- **Ano de referência:** 2022.

### Estrutura do diretório (verificado)

| Pasta | Conteúdo |
|---|---|
| `setores/shp/UF/` | `<UF>_setores_CD2022.zip`, um arquivo por UF, com data de 12/11/2024. Tamanhos: DF 2,3 MB, MT 25 MB, MG 92 MB. |
| `setores/gpkg/UF/<UF>/` | `<UF>_setores_CD2022.gpkg`. Exemplo: MT, 42 MB. |
| `setores/gpkg/BR/` | `BR_setores_CD2022.gpkg`, 1,4 GB. **Não usar no navegador.** |
| `setores/kml/` | Versão em KML. |
| `distritos/`, `subdistritos/`, `bairros/` | Malhas próprias desses níveis, em `shp` e `gpkg`, por UF e BR. |

### Atributos da malha de setores (verificado no arquivo do DF)

Arquivo `DF_setores_CD2022.zip`, SHA-256 `597896afd849107a2a7eaefbff6c807b3524dd1054e24d0959abbbe341dc3211`. Contém `.shp`, `.dbf`, `.shx`, `.prj` e `.cpg`.

- **Sistema de referência (`.prj`):** `GCS_SIRGAS_2000`, coordenadas geográficas em graus, equivalente ao EPSG:4674. Não há projeção.
- **Codificação (`.cpg`):** UTF-8. Conferido nos bytes: "Brasília" aparece como `42 72 61 73 c3 ad 6c 69 61`.

| Campo | Tipo | Significado | Uso no Conecta Rural |
|---|---|---|---|
| `CD_SETOR` | texto (15) | Código do setor censitário. É único (5.418 de 5.418 no DF). | **Identificador oficial** (`idField` e `codeField`) |
| `SITUACAO` | texto | `Urbana` ou `Rural` | Filtro opcional |
| `CD_SIT`, `CD_TIPO` | texto (1) | Códigos de situação e tipo do setor | Preservados |
| `AREA_KM2` | real | Área do setor | Preservado |
| `CD_MUN` / `NM_MUN` | texto (7) / texto | Município | **Recorte do piloto** (`CD_MUN`) |
| `CD_DIST` / `NM_DIST` | texto | Distrito | Preservado. Unidade diferente do setor. |
| `CD_SUBDIST` / `NM_SUBDIST` | texto | Subdistrito | Preservado |
| `CD_BAIRRO` / `NM_BAIRRO` | texto | Bairro, quando houver | Preservado |
| `CD_NU` / `NM_NU` | texto | Núcleo urbano | Preservado |
| `CD_FCU` / `NM_FCU` | texto | Favela ou comunidade urbana | Preservado |
| `CD_AGLOM` / `NM_AGLOM` | texto | Aglomerado rural | Preservado |
| `CD_REGIAO`, `CD_UF`, `CD_RGINT`, `CD_RGI`, `CD_CONCURB` (e os `NM_` correspondentes) | texto | Hierarquias regionais | Preservados |

Antes de configurar o piloto, confirme esses campos no arquivo da UF do piloto. O script de preparação grava a saída do `ogrinfo` em `scripts/ibge/raw/ogrinfo_<UF>.txt`.

## Unidade territorial escolhida: setor censitário

**Por que o setor:** é a menor unidade da malha oficial com limites contínuos e código único. Isso permite agrupar pontos sem perder rastreabilidade. Os níveis acima (distrito, subdistrito) ficam disponíveis como atributos de cada setor.

**Diferença entre setor censitário e comunidade rural.** São coisas diferentes:

- O **setor censitário** é uma unidade operacional de coleta do Censo. Seus limites seguem critérios estatísticos, como o número de domicílios, e **não tem nome próprio**: o atributo de identificação é só o código `CD_SETOR`.
- Uma **comunidade ou localidade rural** é um nome reconhecido pelos moradores. Ela pode ocupar parte de um setor, vários setores ou cruzar limites de setores e distritos.
- O **distrito** (`NM_DIST`) e o **subdistrito** (`NM_SUBDIST`) têm nome oficial, mas costumam ser grandes demais para um aviso de desligamento.
- `NM_AGLOM` (aglomerado rural) e `NM_NU` (núcleo urbano) só aparecem em parte dos setores. **Dado verificado:** no teste com os setores rurais do DF, 284 de 393 setores (72%) não têm `NM_AGLOM`.

**Consequência na aplicação.** Por padrão (`nameField: null`), o aviso nunca usa nome de setor. Uma unidade só ganha nome falado por um destes caminhos:
1. uma **tabela de correspondência validada** (`public/data/ibge/correspondencia_nomes.json`), que liga o código oficial ao nome usado na comunicação e registra quem validou e quando; ou
2. a configuração explícita `nameField` + `officialNameApproved: true`. Use isso apenas se a camada escolhida tiver nome próprio adequado à locução, por exemplo uma malha de distritos.

Sem um desses caminhos, o texto mostra `[denominação pendente de validação — setor censitário <código>]` e a aprovação fica bloqueada.

## Procedimento de preparação

### Opção A: script (recomendada)

Requisitos: Git Bash ou terminal Linux/macOS, `curl`, Node 18+ e **GDAL**. O GDAL pode vir do QGIS/OSGeo4W, que inclui o `ogr2ogr`, ou do Docker Desktop em execução, que usa a imagem `ghcr.io/osgeo/gdal`.

```bash
# na raiz do projeto
scripts/preparar_camada_ibge.sh <UF> <CD_MUN de 7 dígitos>
```

O script:
1. baixa `<UF>_setores_CD2022.zip` para `scripts/ibge/raw/`, pasta ignorada pelo git;
2. registra a URL, o SHA-256 e a data em `public/data/ibge/camada_piloto.origem.json`;
3. grava a saída do `ogrinfo` (campos e CRS);
4. filtra `CD_MUN = '<código>'` **por atributo**, sem recortar geometrias por desenho, e converte com:
   `ogr2ogr -t_srs EPSG:4326 -makevalid -lco RFC7946=YES -lco COORDINATE_PRECISION=7`;
5. valida o resultado com `node scripts/inspecionar_camada.mjs`.

**Nenhuma simplificação é aplicada.** A camada usada no cruzamento tem as geometrias oficiais, com 7 casas decimais (cerca de 1 cm).

### Opção B: QGIS (manual)

1. Abra o `.zip` ou o `.gpkg` da UF.
2. Use *Selecionar por expressão* `"CD_MUN" = '<código>'` e depois *Exportar → Salvar feições selecionadas como…*, no formato GeoJSON, com SRC EPSG:4326 e precisão de coordenadas 7.
3. Salve como `public/data/ibge/camada_piloto.geojson` e rode `node scripts/inspecionar_camada.mjs public/data/ibge/camada_piloto.geojson CD_SETOR`.

### Depois da preparação

Atualize `PILOT_CONFIG` em `src/config.js`:

```js
status: 'official-unvalidated',
territory: { name: '<NM_MUN>', uf: '<UF>', ibgeCode: '<CD_MUN>' },
layer: { ..., obtainedOn: 'AAAA-MM-DD' },
```

Confira a camada no QGIS sobre uma referência independente. Registre aqui quem conferiu e quando, e só então mude para `'official-validated'`.

## Sistema de referência

- Malha IBGE: SIRGAS 2000 geográfico (EPSG:4674), verificado.
- Camada na aplicação: EPSG:4326 (WGS84), exigido pelo GeoJSON RFC 7946 e pelo Leaflet. A diferença entre SIRGAS 2000 e WGS84 é de centímetros e não altera a associação ponto–setor na escala do piloto.
- CSV da engenharia: **o operador precisa declarar o referencial** antes de processar. Só são aceitos graus decimais WGS84 ou SIRGAS 2000. Coordenadas UTM ou de referencial desconhecido são recusadas, não convertidas.

## Regras do cruzamento (`src/lib/spatialJoin.js`)

| Situação | Resultado | Entra na contagem? |
|---|---|---|
| Interior de exatamente uma unidade | **Associado** | Sim |
| Fora de todas as unidades | **Sem correspondência territorial** (nunca vai para a unidade mais próxima) | Não |
| Sobre um limite, inclusive o limite externo da camada ou a borda de um buraco | **Ambíguo**, com as unidades candidatas | Não. Exige revisão. |
| Dentro de duas ou mais unidades sobrepostas | **Ambíguo** | Não |

Polygon, MultiPolygon e anéis internos são tratados pelo `@turf/boolean-point-in-polygon` 7.1. A cobertura está nos testes automatizados.

## Desempenho

- Município pequeno ou médio: espera-se de algumas dezenas a poucas centenas de setores. Como referência, o teste técnico usou 393 setores rurais do DF em um GeoJSON de 4,6 MB e o carregamento e o cruzamento foram imediatos no navegador.
- Se o GeoJSON passar de cerca de 15 MB, o `inspecionar_camada.mjs` avisa. Nesse caso, avalie uma versão **apenas de exibição** simplificada (por exemplo, `mapshaper -simplify 10% keep-shapes`), mantendo a camada completa no cruzamento. Isso ainda não está implementado.
- Volumes muito maiores (UF inteira ou dezenas de milhares de pontos) justificam processamento espacial dedicado, como PostGIS com `ST_Contains`. Essa é uma etapa futura e exige alinhamento antes de criar backend.

## Limitações conhecidas

- A camada foi convertida sem GDAL (verificações acima). Falta a conferência visual independente no QGIS.
- O setor censitário não tem nome. A locução depende de uma correspondência validada que ainda não existe. Em Cataguases, os 7 setores rurais da sede não têm nenhum nome na malha.
- A malha é de 2022. Limites podem ter mudado depois disso.
- Pontos sobre limites são raros com coordenadas reais, mas, quando ocorrem, exigem decisão humana.
- O status "validada" é uma declaração manual na configuração. A aplicação não verifica isso sozinha.
