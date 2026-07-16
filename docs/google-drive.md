# Configurar o Google Drive para o Open WebUI

Este guia prepara um projeto no Google Cloud para que o Open WebUI permita selecionar e importar arquivos do Google Drive. A integração faz uma importação sob demanda; ela não mantém os arquivos sincronizados automaticamente.

Ao final, você terá os dois valores solicitados pelo `install.sh`:

- um OAuth Client ID terminado em `.apps.googleusercontent.com`;
- uma API Key do Google Picker, normalmente iniciada por `AIza`.

Não informe o OAuth Client Secret ao instalador. A integração do Open WebUI roda no navegador e utiliza somente o Client ID e a API Key.

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Pré-requisitos</summary>

- Uma conta Google com permissão para criar ou administrar um projeto no [Google Cloud Console](https://console.cloud.google.com/).
- A URL que os usuários realmente usam para acessar o Open WebUI.
- Para produção, uma URL HTTPS com domínio, como `https://chat.exemplo.com`.

O Google não aceita IP bruto como origem JavaScript, exceto endereços de `localhost`, e só permite HTTP para desenvolvimento local. Não use URLs internas como `http://open-webui:8080`. Se houver proxy reverso, utilize a URL pública vista pelo navegador.

Exemplos:

| Ambiente | URL usada na configuração |
| --- | --- |
| Produção | `https://chat.exemplo.com` |
| Desenvolvimento local | `http://localhost:3000` |

Considere a URL completa: protocolo, domínio e porta precisam corresponder. `https://chat.exemplo.com` e `http://chat.exemplo.com:3000` são origens diferentes.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criar ou selecionar um projeto</summary>

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Use o seletor de projetos no topo da página.
3. Se necessário, clique em **Novo projeto**, informe um nome e conclua a criação.
4. Confirme que o projeto correto permanece selecionado antes de continuar.

Use um projeto separado para desenvolvimento/teste e outro para produção quando a integração for destinada a usuários externos.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Habilitar as APIs</summary>

No projeto selecionado:

1. Abra **APIs e serviços → Biblioteca**.
2. Procure por **Google Drive API**, abra o resultado e clique em **Ativar**.
3. Volte à biblioteca, procure por **Google Picker API** e clique em **Ativar**.

As duas APIs devem estar ativas no mesmo projeto que fornecerá o OAuth Client ID e a API Key.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Configurar a tela de consentimento OAuth</summary>

1. Abra **Google Auth Platform → Branding**.
2. Caso seja a primeira configuração, clique em **Get started**.
3. Informe pelo menos:
   - nome do aplicativo, por exemplo `Open WebUI`;
   - e-mail de suporte;
   - e-mail de contato do desenvolvedor.
4. Salve a configuração.
5. Abra **Google Auth Platform → Audience** e escolha o público:
   - **Internal**: recomendado quando todos os usuários pertencem à mesma organização Google Workspace;
   - **External**: necessário para contas fora da organização.
6. Para um aplicativo **External** em modo **Testing**, adicione em **Test users** todos os e-mails que usarão o Google Drive no Open WebUI.
7. Abra **Google Auth Platform → Data Access**, clique em **Add or remove scopes** e adicione:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
```

A versão `v0.10.2` do Open WebUI solicita esses dois escopos. O `drive.readonly` permite visualizar e baixar arquivos do Drive e é classificado pelo Google como escopo restrito; o `drive.file` concede acesso por arquivo por meio do Picker.

Para testes limitados, mantenha o aplicativo em **Testing** e cadastre explicitamente os usuários. Nesse modo, as autorizações dos usuários de teste expiram após sete dias e precisam ser concedidas novamente. Para disponibilizar um aplicativo **External** em produção usando `drive.readonly`, avalie e conclua o processo de verificação exigido pelo Google. Aplicativos **Internal** são limitados às contas da organização e normalmente não precisam dessa verificação pública.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criar o OAuth Client ID</summary>

1. Abra **Google Auth Platform → Clients**.
2. Clique em **Create client**.
3. Em **Application type**, selecione **Web application**.
4. Informe um nome, por exemplo `Open WebUI Web`.
5. Em **Authorized JavaScript origins**, adicione a URL pública do Open WebUI, sem caminho:

```text
https://chat.exemplo.com
```

Se a porta fizer parte da URL pública, inclua-a:

```text
https://chat.exemplo.com:3000
```

6. Por compatibilidade com as instruções do Open WebUI, adicione a mesma URL em **Authorized redirect URIs**.
7. Clique em **Create**.
8. Copie o valor de **Client ID**. Esse é o valor que será informado ao instalador.

Não copie nem informe o **Client Secret**. Ele não é utilizado por essa integração.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criar e restringir a API Key</summary>

1. Abra **APIs e serviços → Credenciais**.
2. Clique em **Criar credenciais → Chave de API**.
3. Copie a chave criada e abra **Editar chave de API**.
4. Em **Restrições do aplicativo**, selecione **Sites** ou **Referenciadores HTTP**.
5. Adicione a origem e a origem com caminho curinga. Exemplo:

```text
https://chat.exemplo.com
https://chat.exemplo.com/*
```

Para desenvolvimento local:

```text
http://localhost:3000
http://localhost:3000/*
```

6. Em **Restrições de API**, selecione **Restringir chave**.
7. Permita somente:
   - Google Drive API;
   - Google Picker API.
8. Salve e aguarde alguns minutos para a configuração se propagar.

A API Key é utilizada pelo navegador para abrir o Picker. As restrições de site e de API são necessárias para evitar que ela seja reutilizada por outra aplicação.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Executar o instalador</summary>

Execute normalmente:

```bash
./install.sh
```

Quando o instalador perguntar:

```text
Deseja habilitar o Google Drive? [s/N]:
```

Responda `s` e informe:

1. o OAuth Client ID criado na etapa 4;
2. a API Key criada na etapa 5.

O instalador salva a configuração em `data/secrets/openwebui.env`, com permissão restrita, e disponibiliza ao container:

```dotenv
ENABLE_GOOGLE_DRIVE_INTEGRATION=true
GOOGLE_DRIVE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_DRIVE_API_KEY=sua-api-key
```

Não grave valores reais no Git, no README ou em arquivos de exemplo.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Validar no Open WebUI</summary>

1. Acesse a URL pública do Open WebUI.
2. Entre com a conta administrativa.
3. Abra **Admin Panel → Settings → Documents**.
4. Confirme que **Google Drive** está habilitado. Em uma reinstalação, uma configuração persistida anteriormente pelo Open WebUI pode precisar ser habilitada manualmente nesse painel.
5. Abra um chat e use o menu de anexos para selecionar **Google Drive**.
6. Autorize a conta Google e selecione um arquivo de teste.
7. Confirme que o arquivo é importado e processado pelo Open WebUI.

Para verificar somente a presença das variáveis, sem exibir as credenciais:

```bash
docker compose exec -T open-webui sh -c '
  test "$ENABLE_GOOGLE_DRIVE_INTEGRATION" = true &&
  test -n "$GOOGLE_DRIVE_CLIENT_ID" &&
  test -n "$GOOGLE_DRIVE_API_KEY" &&
  echo "Google Drive configurado"
'
```

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Solução de problemas</summary>

| Sintoma | Verificação |
| --- | --- |
| `origin_mismatch` | A origem cadastrada deve ter exatamente o mesmo protocolo, domínio e porta exibidos no navegador. Não inclua caminho em **Authorized JavaScript origins**. |
| `redirect_uri_mismatch` | Cadastre em **Authorized redirect URIs** a mesma URL pública usada pelo Open WebUI. |
| `access_denied` ou usuário não autorizado | Se o app estiver em **Testing**, adicione a conta em **Audience → Test users**. Se estiver **Internal**, use uma conta da organização. |
| Aviso de aplicativo não verificado | Confirme que o usuário é um test user ou conclua a verificação para uso externo em produção. O escopo `drive.readonly` é restrito. |
| Erro de API Key ou referenciador | Confirme as restrições de site, incluindo protocolo, porta e a entrada terminada em `/*`. |
| O Picker abre, mas o download falha | Confirme que a Google Drive API está ativa, que os dois escopos foram declarados e que o usuário possui acesso ao arquivo. |
| A opção Google Drive não aparece | Execute novamente o instalador, valide as variáveis com o comando acima e confira o toggle em **Admin Panel → Settings → Documents**. |

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Referências oficiais</summary>

- [Integração Google Drive no Open WebUI](https://docs.openwebui.com/features/chat-conversations/rag/#google-drive-integration)
- [Código do Picker utilizado pelo Open WebUI v0.10.2](https://github.com/open-webui/open-webui/blob/v0.10.2/src/lib/utils/google-drive-picker.ts)
- [Configurar o Google Picker para uma aplicação web](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Configurar OAuth 2.0 para aplicações web no navegador](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Escopos da Google Drive API](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Gerenciar e restringir API Keys](https://cloud.google.com/docs/authentication/api-keys)
- [Configurar o público do aplicativo OAuth](https://support.google.com/cloud/answer/15549945)

</details>
