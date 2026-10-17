# Microrregiões

Para a Energisa, uma **microrregião** é a comunidade rural que a região conhece pelo nome, como "Palmeiras" em Leopoldina. Avisar por microrregião, em vez de fazenda por fazenda, encurta a carta para as rádios.

Disponível só no modo **Teste com dados reais**. Municípios carregados: Cataguases (42 microrregiões) e Leopoldina (76).

## O que o sistema faz

1. **Carga inicial.** Na primeira abertura do modo real, as microrregiões de `public/data/microrregioes/` entram como **sub-regiões da organização**, com a tag `microrregião` (ver [CAMADAS_E_SUBREGIOES.md](CAMADAS_E_SUBREGIOES.md)).
   - Valem as regras das sub-regiões: contenção no município, nome único e sem sobreposição. A área de sub-regiões que já existiam no município é descontada.
   - A carga roda uma vez por navegador. Uma microrregião excluída pelo usuário não volta.
   - Ajustes de área e de nome, e o histórico, ficam no painel "Sub-regiões".
2. **Localizar coordenada** (painel "Microrregiões", coluna da esquerda).
   - O usuário digita latitude e longitude, em dois campos ou como "-21,49 -42,55" num campo só.
   - O ponto é marcado no mapa e o painel mostra a microrregião e o município.
   - Fora de todas as microrregiões, o painel diz isso (provavelmente área urbana). **Nunca escolhe a mais próxima.**
3. **Regiões da carta.** Com "Microrregiões" selecionado (padrão), o cruzamento do CSV usa as microrregiões no lugar dos setores censitários.
   - A lista de regiões, o mapa e a carta passam a falar o nome da microrregião, ex.: "ENDEREÇOS: Palmeiras, Sereninho".
   - O público padrão da carta ("Pessoal de …") vira o(s) município(s) das microrregiões afetadas.
   - "Setores censitários" volta ao comportamento anterior. Para trocar depois de processar, é preciso começar uma nova importação.

Como as microrregiões cobrem só a zona rural, ponto em área urbana fica "sem correspondência".

## Arquivos

| Arquivo | Papel |
|---|---|
| `src/lib/microregions.js` | Regras puras: rascunhos a partir do GeoJSON, carga idempotente, camada de unidades para o cruzamento, localização de ponto e leitura de lat/long |
| `src/lib/__tests__/microregions.test.js` | Testes com os arquivos reais: carrega as 118 microrregiões sem sobreposição e confere Palmeiras (-21,49 / -42,55), o ponto urbano, a idempotência e o cruzamento |
| `src/components/MicroregionPanel.jsx` | Painel (regiões da carta e busca por coordenada) e marcador no mapa |
| `src/lib/useMapWorkspace.jsx` | Carga inicial (efeito "Microrregiões") e exportação de `microregions`, `municipalities` e `municipalityName` |
| `src/App.jsx` | `unitSource`, camada de unidades (`unitState`) e público padrão da carta |
| `src/config.js` | `MICROREGIONS`: arquivos e municípios |

## Adicionar outro município

1. Gere `microrregioes_<código IBGE>.geojson` com `exportar_microrregioes.py` e copie para `public/data/microrregioes/`.
2. Inclua o arquivo em `MICROREGIONS.files` (`src/config.js`).
3. O município precisa estar na hierarquia do IBGE (`public/data/ibge/hierarquia_piloto.geojson`). Hoje a hierarquia tem os 10 municípios da Região Imediata de Cataguases.
4. Na próxima abertura do modo real, só as microrregiões novas são carregadas.
