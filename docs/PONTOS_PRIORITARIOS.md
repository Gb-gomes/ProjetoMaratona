# Pontos prioritários: cadastro manual e alertas

> **Status: etapa demonstrativa.** A funcionalidade depende de armazenamento local, de uma regra de correspondência ainda não validada e não tem controle de acesso. **Não está pronta para operação real** nem para receber dados reais de clientes.

## Para que serve

O Conecta Rural não tem acesso ao cadastro corporativo de clientes. Como solução intermediária, usuários autorizados cadastram à mão os **pontos prioritários**. A cada CSV processado, o sistema compara os pontos do desligamento com esse cadastro e gera **alertas** para a equipe responsável avaliar.

É uma ferramenta de **apoio à decisão**:
- não decide nada sozinha;
- não bloqueia, não reprograma desligamentos e não aciona equipes;
- não substitui os procedimentos oficiais da empresa.

**A ausência de correspondência não comprova que não há clientes prioritários afetados.**

## Categorias

| Categoria | Uso | Símbolo no mapa |
|---|---|---|
| **A — Equipamento vital** | Pessoa que depende de equipamento elétrico para a preservação da vida, conforme validação autorizada da empresa | quadrado vermelho "A" |
| **B — Atividade produtiva crítica** | A interrupção pode causar perdas de produção, danos a produtos ou animais, ou interromper processos essenciais. Exige descrever a **atividade** e o **impacto esperado** | losango violeta "B" |

- Na categoria A, guarde só o mínimo: uma descrição curta e, se houver, a referência da validação (ex.: protocolo).
- O formulário avisa quando o texto parece conter informação médica.

## Campos do registro

| Campo | Obrigatório | Observação |
|---|---|---|
| Identificador interno | sim | Sugerido (`PP-0001`…), único; não pode ser alterado depois |
| Identificação operacional | não | Evite dados pessoais desnecessários |
| Código da UC | não | É o único dado capaz de **confirmar** uma correspondência (comparado com a coluna de cliente do CSV) |
| Latitude / longitude | sim | Graus decimais WGS84/SIRGAS 2000; aceita vírgula decimal |
| Categoria | sim | A ou B |
| Descrição da situação | sim | Até 280 caracteres |
| Atividade e impacto | sim (só B) | |
| Referência da validação | não (só A) | |
| Observações | não | |
| Data do cadastro | sim | Não pode estar no futuro |
| Status | sim | Ativo ou inativo |
| Responsável | sim | Registrado no histórico de cada alteração |

## Validação

| Tipo | Regras |
|---|---|
| **Bloqueia** | Identificador ausente ou repetido; latitude fora de -90..90; longitude fora de -180..180; coordenada não numérica ou (0, 0); campos obrigatórios vazios; data futura |
| **Avisa e pede confirmação** ("Salvar mesmo assim") | Outro registro **ativo** a até 15 m (`duplicateWarningMeters`); mesmo código da UC em outro registro; coordenada fora do Brasil ou com latitude e longitude aparentemente invertidas; texto com aparência de dado médico |

Registros distintos no mesmo local **não são bloqueados**: podem ser unidades consumidoras diferentes.

## Comparação com o CSV

Parâmetros em `PRIORITY_MATCH` (`src/config.js`). São **parâmetros de teste**, não regras operacionais validadas.

| Parâmetro | Valor inicial | Uso |
|---|---|---|
| `toleranceMeters` | 30 m | Distância máxima. Pode ser ajustada no painel, valendo só para a sessão (máx. 500 m) |
| `sharedIdField` | `client` | Coluna do CSV comparada ao código da UC |

### Como cada ponto é analisado

- A distância é calculada pela fórmula de Haversine, nunca por igualdade de texto ou de números decimais.
- Só entram na comparação os registros **ativos** e os pontos do CSV com coordenadas válidas.

| Resultado | Quando |
|---|---|
| **Correspondência confirmada** | O código da UC coincide com a coluna de cliente do CSV **e** o ponto está dentro da tolerância |
| **Possível correspondência** | O ponto está dentro da tolerância, sem identificador que confirme. Proximidade sozinha nunca confirma a mesma unidade consumidora |
| **Exige revisão** | Um ponto do CSV dentro da tolerância de mais de um cadastro (ambiguidade); código coincidente, mas ponto fora da tolerância; ou ponto já confirmado por código para outro cadastro |
| **Sem correspondência identificada** | Pontos do CSV que não se associaram a nenhum cadastro |

### Quando a comparação não roda ou é sinalizada

- **Não é executada** se o referencial do CSV não for EPSG:4326/4674 ou se a tolerância for inválida.
- **É sinalizada**, mas não bloqueada:
  - registros do CSV com coordenadas inválidas, que não são comparados e aparecem como "Não comparados";
  - CSV sem coluna de identificador, caso em que nada pode ser confirmado;
  - cadastros com coordenadas inválidas.

## Alertas e revisão

- O painel **"Alertas de pontos prioritários"** mostra:
  - o resumo: pontos analisados, confirmados, possíveis, em revisão, sem correspondência e não comparados;
  - a lista de alertas, com categoria A primeiro.
- Ao selecionar um alerta:
  - o mapa centraliza e liga o cadastro aos pontos do CSV envolvidos;
  - abrem-se os detalhes: situação, desligamento, origem, evidência, ação recomendada e, sob demanda, os dados do cadastro.
- Ações explícitas, sempre com responsável:

| Ação | Exige também |
|---|---|
| Marcar em análise | — |
| Registrar encaminhamento | Área de destino |
| Concluir análise | Decisão operacional |
| Reabrir | Observação |
| Adicionar observação | Texto da observação |

- Abrir detalhes ou copiar a carta **não** muda o status.
- Se a correspondência de um alerta concluído mudar (por exemplo, quando surge uma ambiguidade com um novo cadastro), a conclusão é **reaberta automaticamente** e o motivo fica registrado no histórico.
- Enquanto houver alerta de **categoria A** sem análise concluída:
  - o painel e a carta mostram "Revisão pendente";
  - o botão **Aprovar carta** fica desabilitado;
  - uma carta já aprovada volta para rascunho;
  - a linha do tempo mostra "Revisão de pontos prioritários pendente".

  É um controle de fluxo da aplicação: não substitui os procedimentos oficiais.
- **Histórico:**
  - Cada alerta é identificado pelo desligamento analisado (arquivo, ordem e data, congelados no processamento) e pelo registro.
  - O histórico guarda referências (identificador do registro, linha ou identificador do ponto do CSV, distância), **nunca coordenadas do CSV**.
  - Registros que já geraram alerta **não podem ser excluídos**, só desativados.

## Persistência (provisória)

O projeto não tem backend. O cadastro e o histórico de alertas ficam no `localStorage` **deste navegador**:

| Modo | Chave |
|---|---|
| Demonstração | `conecta-rural:pontos-prioritarios:v1:demo:*`, com registros **fictícios** recriados por "Restaurar exemplos" |
| Teste real | `conecta-rural:pontos-prioritarios:v1:real:<código IBGE>:*` |

Nada é compartilhado entre os dois modos.

Limitações:
- não é um cadastro corporativo: não aparece em outro computador, navegador ou perfil;
- pode ser apagado pela limpeza de dados do navegador;
- não tem autenticação, controle de acesso, criptografia nem trilha de auditoria confiável (o "responsável" é digitado livremente);
- **não é um ambiente seguro para dados reais de clientes**, principalmente os de categoria A.

**Exceção à regra geral do projeto:** a regra geral é não guardar coordenadas no navegador. Esta funcionalidade guarda as coordenadas dos **cadastros prioritários**, porque a persistência foi pedida explicitamente. As coordenadas do CSV continuam só em memória.

### Trocar por uma API

A interface só usa o hook `usePriorityRegistry` (`src/lib/usePriorityRegistry.js`). Ele usa um repositório com contrato assíncrono, definido em `src/lib/priorityRepository.js`:

```
loadRecords() → Promise<Record[]>      saveRecords(records) → Promise<void>
loadAlerts()  → Promise<AlertStore>    saveAlerts(store)    → Promise<void>
```

Para um backend corporativo:
1. Crie `createApiPriorityRepository` com o mesmo contrato.
2. Troque a criação do repositório no hook. Os componentes não mudam.
3. Com backend, prefira operações por registro (criar, alterar, desativar, registrar ação) em vez de gravar a lista inteira.
4. Leve as regras de validação e de transição para o servidor.

## Privacidade

- Nenhum dado do cadastro entra na **carta para as rádios** nem na auditoria CSV. O teste de interface confirmou que a carta não contém identificadores, códigos de UC nem descrições.
- Os dados do cadastro aparecem só no painel lateral e nos detalhes do alerta, e a seção "Mostrar detalhes do cadastro" fica fechada por padrão.
- O tooltip do mapa mostra só o identificador interno, a categoria e a situação da análise.
- Nada é enviado a serviços externos (CSP `connect-src 'self'`) e nada é escrito no console.
- Os testes automatizados usam apenas dados fictícios.
