# public/data/microrregioes

Microrregiões rurais (comunidades) com **área aproximada**. O app carrega estes arquivos como sub-regiões da organização na primeira abertura do modo "Teste com dados reais" (ver `src/lib/microregions.js` e `docs/MICRORREGIOES.md`).

| Arquivo | Município | Microrregiões |
|---|---|---|
| `microrregioes_3115300.geojson` | Cataguases-MG | 42 |
| `microrregioes_3138401.geojson` | Leopoldina-MG | 76 |

## Origem

Gerados por `scripts/comunidades/exportar_microrregioes.py`, no repositório de dados do time (MARATONA-TIVIT), em 17/10/2026. Só usam dados públicos:

- **Nome:** IBGE CNEFE 2022. É o campo de localidade dos endereços rurais do Censo. Palmeiras (Leopoldina) vem do nome das estradas (`--estradas PALMEIRAS`).
- **Área:** a zona rural, formada pelos setores rurais do IBGE 2022, é repartida entre os endereços. Cada pedaço recebe o nome dos endereços mais próximos. Por isso a área **não é limite oficial**: é um ponto de partida, ajustável no painel "Sub-regiões".

## Campos

| Campo | Conteúdo |
|---|---|
| `ID` | Código da microrregião. Vira o código interno `MR-<ID>` |
| `COMUNIDADE` | Nome exibido e falado na carta |
| `NOME_NA_FONTE` | Texto exato do Censo |
| `ENDERECOS_IBGE` | Quantos endereços usam o nome |
| `CONFIANCA` | `boa` ou `baixa`. Baixa = menos de 10 endereços; vira a tag "conferir" |
| `DISTRITOS`, `CENTRO_LAT`, `CENTRO_LON`, `EXTENSAO_KM`, `AREA_KM2`, `AREA_HA` | Apoio à conferência |
| `CONTORNO` | Como a área foi feita |

Os arquivos cobrem só a zona rural. Pontos em área urbana ficam "sem correspondência".
