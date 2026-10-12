# Deploy no Cloudflare Pages com Cloudflare Access

O Conecta Rural é um site estático (Vite). Ele é publicado no **Cloudflare Pages**, e quem pode abri-lo é controlado pelo **Cloudflare Access** (Zero Trust), configurado no painel da Cloudflare.

O app **não tem login próprio**. Não há senhas, tokens nem segredos no repositório.

## 1. Build

```bash
npm install
npm test
npm run build      # gera dist/
npm run preview    # opcional: confere a build em http://localhost:4173
```

A pasta `dist/` contém:

- `index.html` e `assets/`: a aplicação;
- `data/`: a camada do piloto e a correspondência de nomes, copiadas de `public/data/`;
- `_headers`: cabeçalhos de segurança aplicados pelo Pages, copiados de `public/_headers`.

Não há `_redirects`, porque o app não tem rotas no cliente: tudo acontece em `/`.

> Antes de publicar, confira que **nenhum CSV real** foi colocado em `public/`. Tudo que está em `public/` vai para o site.

## 2. Deploy

O `wrangler` 4.48.0 é uma devDependency de versão fixa. É a última versão compatível com Node 18; as seguintes exigem Node 20 ou 22.

Primeira vez, na máquina de quem publica:

```bash
npx wrangler login                     # abre o navegador para autorizar a conta Cloudflare
npx wrangler pages project create conecta-rural --production-branch master
```

Cada publicação:

```bash
npm run build
npm run deploy                         # wrangler pages deploy dist --project-name conecta-rural
```

- Ao publicar a partir da branch `master`, o wrangler cria um deploy de **produção** em `https://conecta-rural.pages.dev`.
- Ao publicar a partir de outras branches, ele cria **prévias** em `https://<hash>.conecta-rural.pages.dev` e `https://<branch>.conecta-rural.pages.dev`.
- Se o nome `conecta-rural` já existir no pages.dev, a Cloudflare acrescenta um sufixo (ex.: `conecta-rural-4xz.pages.dev`). Use o domínio real em todos os passos abaixo.
- Nenhuma credencial fica no projeto: o `wrangler login` guarda o token no perfil do usuário, fora do repositório.

## 3. Cloudflare Access (passos manuais no painel)

Painel: **Cloudflare One / Zero Trust**.

### 3.1 Método de login: One-time PIN

1. Vá em **Settings → Authentication → Login methods**.
2. Adicione **One-time PIN**, se ainda não estiver na lista.

### 3.2 Aplicação self-hosted

1. Vá em **Access → Applications → Add an application → Self-hosted**.
2. Preencha:
   - **Application name:** `Conecta Rural`.
   - **Session duration:** sugestão de `8 hours` (um turno de trabalho).
   - **Public hostnames:** adicione dois.
     - `conecta-rural.pages.dev` (produção);
     - `*.conecta-rural.pages.dev` (todas as prévias). Sem esse curinga, as URLs de prévia ficam **abertas**.
   - **Identity providers:** marque só **One-time PIN**. Se for a única opção, ative "Instant Auth" para pular a tela de escolha.

### 3.3 Política: no máximo 45 usuários

O ambiente é de testes e o acesso é limitado a **no máximo 45 pessoas**. O limite é imposto pelo próprio Access, por uma **lista nominal de e-mails**: só os endereços da lista recebem o código de login. Uma regra por domínio (`Emails ending in`) **não** serve, porque liberaria qualquer caixa `@energisa.com.br`.

1. Em **Access → Access groups → Add a group**:
   - **Name:** `Conecta Rural – testadores (máx. 45)`;
   - **Include → Emails:** um endereço por linha, **no máximo 45**. Também é possível usar **Include → Email list** com uma lista criada em **My Team → Lists** a partir de um CSV.
2. Na aplicação do passo 3.2, crie a política:
   - **Action:** Allow;
   - **Include:** o grupo `Conecta Rural – testadores (máx. 45)`;
   - **Require:** `Emails ending in` → `@energisa.com.br`. É uma trava extra: mesmo que alguém adicione por engano um e-mail de fora ao grupo, ele não entra.
3. Não adicione **nenhuma** outra regra Include (nada de `Everyone`, `Emails ending in` em Include, IP ranges, bypass ou Service Auth).
4. Salve a aplicação.

**Como manter o limite:**

- **Para entrar alguém novo, retire alguém antes.** O grupo nunca deve passar de 45 linhas. Confira a contagem a cada edição.
- **Restrinja quem pode editar o Zero Trust.** Em **Manage Account → Members**, deixe só 1 ou 2 administradores. Quem pode editar o grupo pode aumentar a lista.
- **Revogue sessões ao remover alguém.** Em **My Team → Users**, use **Revoke session** e **Remove seat**. Sem isso, a sessão aberta continua válida até expirar.
- **Audite.** Em **Logs → Access**, veja quem entrou. Em **Logs → Admin**, veja quem alterou o grupo ou a política.
- **Mantenha a lista fora do repositório.** São dados pessoais.

### 3.4 (Opcional) Prévias pelo próprio Pages

Em **Workers & Pages → conecta-rural → Settings → General → Access policy**, existe a opção **Enable access policy**. Ela protege só as prévias e cria uma política própria, que pode liberar mais gente que o grupo dos 45. A aplicação do passo 3.2 já cobre produção e prévias (`*.conecta-rural.pages.dev`), então **deixe essa opção desligada**. Se ela já estiver ligada, edite a política criada para usar o mesmo grupo.

### 3.5 Verificação

1. Em uma janela anônima, abra `https://conecta-rural.pages.dev`. Deve aparecer a tela do Cloudflare Access pedindo o e-mail.
2. Teste com um e-mail `@energisa.com.br` que **não** está no grupo: o código não chega e o acesso é negado.
3. Teste com um e-mail do grupo: o código chega por e-mail, e depois do login o cabeçalho mostra o e-mail e o link **Sair**.
4. Abra também uma URL de prévia (`https://<hash>.conecta-rural.pages.dev`). Ela também deve pedir login.
5. Confira os cabeçalhos (DevTools → Network → documento) e procure: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` e `Permissions-Policy`.

## 4. Como o app usa a identidade

- Ao abrir, o app consulta `/cdn-cgi/access/get-identity`. O endpoint é da própria origem, então a CSP `connect-src 'self'` é respeitada. O código está em `src/lib/accessIdentity.js`.
- Se a consulta funcionar:
  - o cabeçalho mostra o e-mail e o link **Sair** (`/cdn-cgi/access/logout`);
  - os campos "Responsável" ficam somente leitura com o e-mail. Isso vale para nomear e renomear região, para o cadastro de pontos prioritários e para a revisão de alertas;
  - a aprovação da carta registra quem aprovou.
- Se falhar (desenvolvimento local, 404, HTML, erro de rede, timeout de 5 s), o app funciona como antes, com o campo de texto livre.
- A identidade fica **só em memória**: não vai para o console nem para `localStorage`. O e-mail aparece apenas como "responsável" nos históricos que já eram salvos no navegador (nomes de região e pontos prioritários). Veja Privacidade no README.
- Se a sessão do Access expirar com a página aberta, a próxima consulta falha e o app volta ao campo de texto. Recarregar a página leva de volta ao login.

## 5. Cabeçalhos de segurança (`public/_headers`)

| Cabeçalho | Valor | Motivo |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Impede o navegador de "adivinhar" tipos de arquivo |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Não envia caminho nem parâmetros para outros sites |
| `X-Frame-Options` | `DENY` | Impede embutir o site em iframes (navegadores antigos) |
| `Content-Security-Policy` | `frame-ancestors 'none'` | Equivalente moderno do anterior; não funciona em `<meta>` |
| `Permissions-Policy` | câmera, microfone, geolocalização, pagamento, USB etc. negados | O app não usa nenhum desses recursos |

A CSP principal (`connect-src 'self' …; form-action 'none'`) continua no `<meta>` do `index.html`. O navegador aplica as duas políticas juntas; o cabeçalho só acrescenta restrições. A área de transferência (botão "Copiar texto") não é bloqueada.

## 6. Limitações

- **O Access controla quem abre o site, não o que ele guarda.** Os nomes de região e o cadastro de pontos prioritários continuam no `localStorage` de cada navegador: não são compartilhados entre usuários, não têm backup e não têm controle de acesso por registro. O cadastro de pontos prioritários continua **inadequado para dados reais**.
- **A identidade exibida é uma conveniência de front-end para auditoria.** Ela não substitui autorização em backend: quem tem acesso ao navegador pode alterar o `localStorage` ou o histórico local. Para registros com valor de auditoria, é preciso um backend que valide o token do Access (`Cf-Access-Jwt-Assertion`).
- **O limite de 45 usuários depende da lista do grupo.** O Access não tem uma configuração de "no máximo N usuários" por aplicação. O teto é a própria lista nominal, então quem administra o Zero Trust pode aumentá-la. Por isso, restrinja os administradores e acompanhe os logs de administração (passo 3.3). O limite é de 45 **pessoas**: uma pessoa da lista pode entrar de mais de um dispositivo.
- O One-time PIN depende da entrega do e-mail. Se houver um provedor corporativo (Entra ID/Azure AD, Google Workspace), ele pode substituir o PIN.
- `wrangler` está fixado na 4.48.0 por compatibilidade com Node 18. Com Node 22 disponível, dá para atualizar.
- O deploy é manual (`npm run deploy`). Não há integração Git/CI configurada.
