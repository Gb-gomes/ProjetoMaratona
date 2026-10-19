# Importação de pontos: planilha, fazenda e coordenada

Como os pontos de um desligamento entram no sistema (modo **Teste com dados reais**) e como cada um chega a uma comunidade, sem ficar ponto solto.

## Formatos aceitos

| Arquivo | Lido? | Observação |
|---|---|---|
| CSV / TXT / TSV | sim | Separador detectado (vírgula, ponto e vírgula, tabulação); UTF-8 ou Windows-1252 |
| Excel `.xlsx` / `.xlsm` | sim | Todas as abas visíveis; a aba padrão é a que tem mais colunas reconhecidas. Com mais de uma aba, o painel deixa escolher |
| Excel `.xls` (97-2003), `.ods` | não | A mensagem pede para salvar como `.xlsx` ou CSV |

- A linha de cabeçalho **não precisa ser a primeira**: títulos e linhas vazias acima da tabela são ignorados (primeira linha, entre as 15 primeiras, com ao menos 60% das colunas preenchidas).
- O arquivo é lido **só no navegador** (`src/lib/spreadsheet.js`, com `fflate`); nada é enviado.

## Mapeamento das colunas

A sugestão automática reconhece nomes comuns, com ou sem acento, "da/do/de" e unidades ("Latitude (graus)", "Nº da UC", "Código do imóvel no CAR"). O operador confere antes de validar.

Cada linha precisa de **uma** das duas coisas:

1. **Latitude e longitude** (graus decimais); ou
2. **Algo que identifique a fazenda**: código CAR, código INCRA, ID do catálogo, nome da fazenda (com o município, se o nome se repete) ou transformador.

O referencial (WGS84/SIRGAS 2000) só é obrigatório quando há coordenadas vindas do arquivo. Pontos localizados pela fazenda ou digitados no sistema já estão em graus decimais.

## Ligação com a fazenda (`src/lib/farmIndex.js`)

Índice: `public/data/fazendas/indice_fazendas.json`, com 78 mil fazendas de 66 municípios da área. É gerado por `MARATONA-TIVIT/scripts/comunidades/exportar_indice_fazendas.py` a partir do catálogo (CAR, INCRA/SIGEF, IBGE/CNEFE, BDGD) e só é baixado quando a validação ou a busca precisam dele (~2,9 MB comprimido). Contém somente códigos públicos e nomes da fonte.

**Ordem de busca.** A primeira regra que identificar **uma** fazenda vence:

1. ID do catálogo;
2. código CAR, com ou sem pontos (inclui os cadastros repetidos do mesmo imóvel);
3. código INCRA (só os dígitos);
4. nome + município ("Fazenda", "Sítio" e acentos são opcionais);
5. transformador, só quando atende uma única fazenda e só se a linha não tiver coordenada.

**Resultado na linha:**

| Situação | Resultado |
|---|---|
| Sem coordenada, fazenda achada | Válida; o ponto é o da fazenda (`coordOrigin: 'fazenda'`). O nome da fazenda preenche a propriedade |
| Coordenada inválida (UTM, invertida…), fazenda achada | Válida com alerta `farm-replaced`; usa o ponto da fazenda |
| Com coordenada, fazenda achada | Válida; a fazenda **só confere**. Ponto a mais de 3 km da fazenda citada gera o alerta `farm-far` e vale a coordenada do arquivo |
| Mais de uma fazenda possível | Inválida (`farm-ambiguous`), com os candidatos. O operador informa o CAR, o município ou a coordenada |
| Fazenda não encontrada | Inválida (`farm-not-found`), com o que foi procurado |

Nenhuma linha some: toda linha termina **válida** (com ponto) ou **na lista de ocorrências com o motivo**.

## Pontos inseridos à mão

No painel, **Inserir ponto por coordenada** aceita "latitude, longitude" ou, sem coordenada, o código CAR. Também dá para usar a busca do mapa (ver abaixo).

- Os pontos entram na **mesma validação** do arquivo, como linhas `M1`, `M2`… (`src/lib/manualPoints.js`). Valem as mesmas regras de coordenada, duplicidade e fazenda.
- Funcionam sem arquivo: só com pontos manuais já dá para validar e processar.

## Busca por coordenada no mapa

O campo de busca do mapa aceita coordenada, além de nomes: `-21,3905, -42,5520`, `-21.3905 -42.5520`, `-21,3905; -42,5520`. Se os valores estiverem invertidos, o sistema corrige e avisa.

O resultado leva ao ponto e mostra:
- o **lugar**: comunidade, distrito e município;
- a **fazenda mais próxima** no catálogo (até 500 m).

Ações no balão:
- **Incluir no desligamento**: vira um ponto manual;
- **Cadastrar ponto prioritário aqui**: abre o cadastro com a latitude e a longitude preenchidas.

## Cruzamento: lugar em vez de setor censitário (`src/lib/placeJoin.js`)

Antes, o cruzamento passava primeiro pela malha de **setores censitários de Cataguases**. Um ponto em qualquer outro município da área ficava "sem correspondência", mesmo dentro de uma comunidade.

Agora o cruzamento usa a malha de **lugares**:
- **associado**: o ponto está num dos municípios carregados (os 67 da área);
- **sem correspondência**: o ponto está fora deles.

Depois, `placeRegions.groupByPlace` dá o nome, como antes:
- comunidade;
- "Área urbana de …";
- "Sede do distrito de …";
- município sem arquivo de comunidades.

Os setores censitários ficaram **opcionais**. Quando a malha está carregada e contém o ponto, ela fornece o contorno da área urbana no mapa e o código na auditoria. A carta e a lista de regiões não dependem mais deles.
