# public/data/ibge

Camada territorial OFICIAL usada pelo modo "Teste com dados reais".

| Arquivo | Origem | Versionar? |
|---|---|---|
| `camada_piloto.geojson` | Recorte do município piloto, gerado por `scripts/preparar_camada_ibge.sh` | Sim, se a política do projeto permitir (dado público do IBGE) |
| `camada_piloto.origem.json` | Registro de URL, SHA-256, data e filtro, gerado pelo script | Sim |
| `correspondencia_nomes.json` | Tabela VALIDADA código oficial → nome para locução | Sim, após validação |
| `correspondencia_nomes.exemplo.json` | Modelo de formato, com códigos fictícios | Sim |

**Nunca** coloque aqui CSVs da engenharia ou qualquer dado de cliente: tudo o que está
em `public/` é servido para qualquer pessoa que acesse a aplicação.

Situação atual: camada de Cataguases-MG (`CD_MUN` 3115300, 140 setores) gerada em 10/10/2026, com conferência visual pendente.
Veja `docs/CAMADA_TERRITORIAL.md`.
