# Comunidades: nomes de lugar abaixo do distrito do IBGE

A localização de um ponto é descrita em quatro níveis:

**UF (IBGE) › Município (IBGE) › Distrito (IBGE) › Comunidade (arquivo de comunidades)**

Exemplo: `Comunidade Joaquim Vieira · Distrito de Glória de Cataguases · Cataguases/MG`.

- Os limites do IBGE nunca mudam. As comunidades são uma camada adicional e editável.
- Funciona no modo **Teste com dados reais**.
- Como no restante desta etapa, os dados ficam no navegador (IndexedDB), sem backend. Ver [CAMADAS_E_SUBREGIOES.md](CAMADAS_E_SUBREGIOES.md).

## Arquivos

- **Área coberta:** os **67 municípios da área de concessão da Energisa Minas Rio** (65 de MG, mais Nova Friburgo e Sumidouro, no RJ).
  - A lista está em `scripts/ibge/municipios_energisa_mr.txt`. Ela vem da camada ARAT da BDGD da ANEEL (base 2025-12-31) e inclui todo município com pelo menos 1% da área dentro da ARAT. Os 67 estão 100% dentro.
  - Carmo (3301207) e Bom Jardim (3300506), no RJ, têm menos de 1% dentro e ficam de fora.
- **Comunidades:** `public/data/comunidades/microrregioes_<COD_IBGE_MUN>.geojson`, um por município, listados em `public/data/comunidades/index.json`.
  - São **1.982 comunidades**, 384 delas com confiança baixa. A contagem por município está no `index.json`.
  - Cataguases (42) e Leopoldina (76) são os arquivos originais.
  - Os outros 65 foram gerados por `scripts/comunidades/exportar_microrregioes.py`, no repositório de dados do time (MARATONA-TIVIT), com o mesmo método.
- **Hierarquia e distritos:** `public/data/ibge/hierarquia_piloto.geojson` e `distritos_piloto.geojson`, das malhas Municipal 2022 e de Distritos do Censo 2022 do IBGE.
  - Cobrem os 67 municípios, as 11 Imediatas e as 2 Intermediárias a que eles pertencem, MG e RJ, e 152 distritos.
  - Gerados por `node scripts/preparar_hierarquia_ibge.mjs --lista scripts/ibge/municipios_energisa_mr.txt`. Sem `--lista`, o script continua gerando só a Imediata do piloto (`MG 3115300`).
  - Simplificação dos distritos: 2 m.
  - O distrito-sede é o de código terminado em `05`.
  - O rótulo usa a UF do próprio município: "Nova Friburgo/RJ".
- **Primeira abertura do modo real:** a importação automática dos 67 arquivos leva cerca de 30 a 45 s.
  - Um aviso informa o início.
  - O processamento cede a vez à tela entre um município e outro, então o mapa continua utilizável.

## Importação (`src/lib/communities.js`)

Abra **Camadas › Comunidades › Configurar** ou **Sub-regiões › Comunidades (importar, nomes)**. Importar e editar comunidades é permitido só a administradores.

**Importação automática:**
- no primeiro uso do modo real, se o navegador não tem microrregiões de um município listado em `public/data/comunidades/index.json`, o arquivo do projeto é importado sozinho;
- passa pelas mesmas regras da importação manual: relatório em Sub-regiões › Comunidades e histórico com o responsável "sistema (arquivos do projeto)";
- cada município é importado automaticamente uma única vez (fica registrado nas configurações do navegador), então o que o operador excluir depois não volta sozinho;
- a importação manual continua disponível e preserva os nomes e contornos corrigidos.

1. **Validação:**
   - o arquivo deve ser uma FeatureCollection em WGS 84;
   - deve ter um único município, que precisa existir na base do IBGE carregada;
   - cada feição precisa de ID único no arquivo, nome e geometria Polygon ou MultiPolygon.
2. **Correção de geometrias:** fecha anéis, remove vértices repetidos e resolve autointerseções pela união do polígono consigo mesmo (equivalente ao `ST_MakeValid`).
3. **Gravação:** cada feição vira uma sub-região do conjunto `communities`, separado das sub-regiões da organização, para que uma regra não bloqueie a outra:

   | Especificação | Campo |
   |---|---|
   | `codigo_externo` | `externalCode` = `ID` |
   | `nome_original` | `originalName` = `COMUNIDADE` |
   | `nome_exibicao` | `name` (editável) |
   | `ibge_parent_code` | `ibgeParentCode` = `COD_IBGE_MUN` |
   | `creation_method` | `'imported'` |
   | `label_point` | `labelPoint` = (`CENTRO_LON`, `CENTRO_LAT`) |
   | `confianca` | `confidence` = `'boa'` \| `'baixa'` |
   | `metadata` | todas as propriedades do arquivo, sem perda |

4. **Área e perímetro:** recalculados (geodésicos). Os valores do arquivo ficam só nos metadados.
5. **Contenção no município**, com tolerância de 50 m. O que passa da borda é recortado; acima da tolerância, a comunidade aparece no relatório.
6. **Sobreposições entre vizinhas:** a área sobreposta fica com a comunidade de confiança "boa"; em empate, com a de menor área.
7. **Idempotência** pela chave (`COD_IBGE_MUN`, `ID`):
   - reimportar atualiza geometria e metadados;
   - **não** sobrescreve nome nem contorno editados no sistema, salvo com "Sobrescrever edições manuais";
   - cada atualização incrementa `importVersion` e guarda a geometria anterior no histórico;
   - uma comunidade excluída no sistema não é recriada, salvo com a mesma opção;
   - comunidades que sumiram do arquivo são mantidas e listadas.
8. **Relatório**, mostrado no fim:
   - importadas, atualizadas, sem alteração, ignoradas e inválidas;
   - avisos de contenção;
   - sobreposições resolvidas;
   - confiança baixa;
   - edições preservadas;
   - ausentes do arquivo.

**Medido nos arquivos atuais:**
- **Cataguases:** 62 sobreposições resolvidas e nenhuma comunidade além da tolerância de 50 m.
- **Leopoldina:** 139 sobreposições resolvidas.
- **Diferença com a especificação:** ela fala em "4 sobreposições" para Cataguases. A conta por interseção exata encontra 62, todas pequenas (de 0,01 a 249 m²). O critério usado aqui considera qualquer interseção acima de 0,01 m².

## Serviço coordenada → nome (`src/lib/placeNames.js`)

Um só serviço para todo o sistema: mapa, busca, cadastro de pontos prioritários, pontos do CSV, auditoria e carta para as rádios.

1. **Município:** ponto no polígono do município IBGE.
2. **Distrito:** ponto no polígono do distrito IBGE.
3. **Comunidade**, quando o município tem arquivo:
   - **uma comunidade contém o ponto:** usa essa comunidade;
   - **mais de uma:** prefere a de confiança "boa"; em empate, a de menor área;
   - **nenhuma, mas há comunidade a até 100 m:** usa a mais próxima, com `origem_nome = "comunidade_proxima"`;
   - **nenhuma por perto:** `Área urbana de <município>` no distrito-sede, ou `Sede do distrito de <nome>` nos demais. Nunca usa a comunidade mais distante.
4. **Município sem arquivo:** só nomes do IBGE.

Retorno:

```js
{
  municipio: { cod, nome, uf },
  distrito: { cod, nome, sede } | null,
  comunidade: { id, regionId, nome, confianca, aproximada } | null,
  origem_nome: 'comunidade' | 'comunidade_proxima' | 'ibge',
  local,   // nome curto
  rotulo,  // texto completo
}
```

**Rótulo no distrito-sede:** fica `Comunidade Goiabal · Distrito-sede (Cataguases) · Cataguases/MG`.

**Distrito do exemplo da especificação:** o ponto (-21.26855, -42.65160) cai, pela malha oficial, no distrito de **Glória de Cataguases**, e não em Sereno. O setor censitário do ponto confirma: 311530012000002. A comunidade Joaquim Vieira toca 4 distritos.

## Onde os nomes aparecem

- **Mapa:**
  - grupo **Comunidades** no painel de camadas, com uma camada por município;
  - contorno fino e tracejado quando a confiança é baixa;
  - rótulo no `label_point` a partir do zoom 11, com "≈" quando aproximada;
  - **passar o mouse** destaca a comunidade e mostra nome, distrito, município e confiança, com o motivo quando é aproximada;
  - **clicar** abre o cartão com o rótulo completo, as fontes e as ações.
- **Busca** no cabeçalho do mapa (no celular, botão "Buscar"): comunidades, distritos e municípios, sem diferenciar acentos e maiúsculas. Ex.: "sao diniz" encontra "São Diniz". Escolher um resultado enquadra o lugar.
- **Pontos prioritários:**
  - ao digitar a coordenada, o formulário mostra município, distrito e comunidade;
  - ao salvar, grava a localização do momento (`location`: comunidade_id, nome, distrito, município, origem e data).
- **Pontos do CSV:**
  - cada ponto recebe a localização;
  - ela aparece na dica do ponto no mapa e numa coluna da auditoria;
  - a exportação CSV ganha município, distrito, comunidade, confiança e origem.
- **Relatórios:** a auditoria agrupa os pontos por comunidade e filtra os registros ao clicar.
- **Regiões identificadas (modo real; `src/lib/placeRegions.js`):**
  - o cruzamento continua sendo feito com os setores censitários: é ele que decide se o ponto está associado, sem correspondência ou ambíguo;
  - depois, a lista passa a ter **uma região por microrregião** com pontos afetados (ponto dentro dela ou a até 100 m, pela regra do serviço de nomes);
  - pontos fora de qualquer microrregião são agrupados pela área do IBGE ("Área urbana de Cataguases", "Sede do distrito de Sereno"), com o contorno dos setores onde estão;
  - em município sem arquivo de comunidades, a região continua sendo o setor censitário;
  - as contagens não mudam (a soma das regiões é igual ao total de associados), e cada ponto guarda o seu setor (dica no mapa, coluna `codigo_unidade` da auditoria; a coluna `regiao` traz a microrregião);
  - os detalhes da região mostram ID, confiança, distrito, município, setores e quantos pontos entraram pela regra dos 100 m;
  - se as comunidades mudarem depois do processamento, a lista é refeita: regiões novas entram no aviso, e as que o operador tirou continuam fora;
  - o modo Demonstração não muda.
- **Carta para as rádios:**
  - **ordem dos nomes:** primeiro o nome definido pelo operador ("Renomear"), depois a correspondência validada e, em seguida, o **nome da microrregião** ou da área do IBGE;
  - cada região vira uma linha de ENDEREÇOS, sem repetir;
  - a regra de "menos de 3 clientes → nome da propriedade" continua valendo.
- **Reavaliação:**
  - quando as comunidades mudam (importação, edição, divisão, união), a localização gravada dos pontos prioritários é recalculada;
  - um aviso informa quantos mudaram de comunidade;
  - cada mudança fica no histórico do registro.

## Nomes e acentuação

- O arquivo traz os nomes sem acento ("Sao Diniz", "Piloes").
- A tela sempre mostra o **nome de exibição**, que o administrador corrige sem mudar o ID:
  - um a um: **Sub-regiões › Comunidades › Renomear**;
  - em lote: com a planilha `COD_IBGE_MUN;ID;nome_exibicao`. "Baixar planilha com os nomes atuais" gera o modelo.
- O nome corrigido fica marcado como edição manual e é preservado nas reimportações.

## Edição (somente administradores)

- **Renomear** e **ajustar contorno:** usam o mesmo editor das sub-regiões, com as mesmas regras (contida no município e sem sobreposição com outra comunidade).
- **Dividir:** desenhe a parte que vira uma comunidade nova. A original fica com o restante; o ID novo é gerado a partir do nome.
- **Unir:** escolha uma vizinha. A primeira fica com a área das duas; a outra é excluída logicamente.
- **Histórico:** toda edição registra autor, data e a geometria anterior.

## Situação dos critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Importar `microrregioes_3115300.geojson` cria 42 comunidades em 3115300 com relatório | Atendido (teste automatizado e navegador) |
| 2 | (-21.39002, -42.75969) → Goiabal | Atendido |
| 3 | (-21.26855, -42.65160) → Joaquim Vieira | Atendido. O distrito é Glória de Cataguases (ver acima). |
| 4 | Centro da cidade → sem comunidade, "Área urbana de Cataguases" | Atendido |
| 5 | Lacuna pequena → comunidade mais próxima, `comunidade_proxima` | Atendido (teste automatizado) |
| 6 | Confiança baixa com contorno tracejado e indicador "aproximada" | Atendido |
| 7 | Reimportar não duplica nem apaga nomes corrigidos | Atendido |
| 8 | Mesmo ID em dois municípios (`VARGEM_LINDA`) → duas comunidades | Atendido (Cataguases e Leopoldina) |
| 9 | Município sem arquivo só com nomes do IBGE | Atendido (ex.: Argirita) |
| 10 | Busca "sao diniz" encontra "São Diniz" | Atendido |

## Limitações

- **Sem backend:** a importação e as edições ficam neste navegador. Outros usuários não veem as correções até existir um servidor; exporte a planilha de nomes para compartilhar.
- **Cadastros com localização:** neste projeto, só os pontos prioritários e os pontos do CSV. Os de propriedades, clientes e ocorrências passam a usar o mesmo serviço quando existirem.
- **Lacunas entre comunidades:** a regra dos 100 m vale também na borda da área urbana. Um ponto urbano a menos de 100 m de uma comunidade recebe o nome dela.
