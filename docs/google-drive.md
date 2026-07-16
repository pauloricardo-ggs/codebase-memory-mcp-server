# Configurar o Google Drive para sincronização

Este guia prepara um projeto no Google Cloud e conecta pastas do Drive a Knowledge Bases pelo painel administrativo. A instalação não solicita credenciais: o arquivo JSON da Service Account é enviado posteriormente pelo navegador.

OAuth Client ID e API Key do Google Picker não são necessários para a sincronização automática. Eles pertencem ao seletor manual nativo do Open WebUI e são tratados separadamente na seção opcional deste guia.

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Pré-requisitos</summary>

- Uma conta Google com permissão para criar ou administrar um projeto no [Google Cloud Console](https://console.cloud.google.com/).
- Acesso ao painel administrativo da instalação.
- Permissão para compartilhar no Google Drive as pastas que serão sincronizadas.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criar o projeto e habilitar a API</summary>

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/).
2. Use o seletor no topo para criar ou escolher um projeto.
3. Abra **APIs e serviços → Biblioteca**.
4. Procure por **Google Drive API**, abra o resultado e clique em **Ativar**.

Para a sincronização automática, somente a Google Drive API é necessária. Ative a Google Picker API apenas se também for usar o seletor manual opcional.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criar a Service Account</summary>

1. No projeto, abra **IAM e administrador → Contas de serviço**.
2. Clique em **Criar conta de serviço**.
3. Informe um nome, por exemplo `openwebui-knowledge-sync`.
4. Não conceda papéis de IAM no projeto; o acesso aos documentos será dado diretamente no Drive.
5. Abra a conta criada e acesse **Chaves → Adicionar chave → Criar nova chave**.
6. Selecione **JSON** e guarde o arquivo baixado em um local protegido.

O worker enxerga somente arquivos e pastas acessíveis à Service Account. Não publique o JSON, não o envie para o Git e não conceda permissão de edição.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Executar o instalador</summary>

Execute normalmente:

```bash
./install.sh
```

O instalador não faz perguntas sobre Google Drive. Ele gera somente o token interno entre o painel e o worker, constrói o serviço `knowledge-sync` e o inicia junto aos demais containers.

Sem credencial, o worker responde ao painel, mas não consulta o Google nem executa agendamentos. Não é necessário reinstalar ou reiniciar containers depois de enviar ou substituir o JSON.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Enviar a Service Account pelo painel</summary>

1. Em qualquer computador com acesso ao servidor, abra `http://<servidor>:8787/admin/`.
2. Entre em **Bases e Drive**.
3. Clique em **Configurar Google Drive**.
4. Use **Arquivo da Service Account** para selecionar o JSON baixado do Google Cloud. Como alternativa avançada, abra **Ou cole o conteúdo do JSON**.
5. Confira o e-mail e o projeto mostrados na prévia e clique em **Salvar credencial**.
6. Clique em **Testar conexão**.
7. Copie o e-mail da Service Account exibido no painel.
8. No Google Drive, compartilhe cada pasta desejada com esse e-mail como **Leitor**.

O upload parte do navegador usado para acessar o painel; o servidor não precisa ter interface gráfica. O painel salva o arquivo em `data/secrets/knowledge-sync/google-drive-service-account.json`, com permissão `0600`. Somente esse subdiretório é montado, para leitura, no worker; os demais segredos do sistema ficam fora do alcance dele. A chave privada nunca é devolvida pela API nem exibida novamente.

A opção **Remover** apaga o arquivo do servidor e pausa os vínculos existentes, preservando os arquivos já enviados às bases.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Vincular pastas às Knowledge Bases</summary>

1. Crie as Knowledge Bases desejadas no Open WebUI.
2. Associe cada modelo somente à sua respectiva base.
3. Em **Bases e Drive**, localize a Knowledge Base e clique em **Vincular pastas**.
4. Selecione uma ou mais pastas acessíveis à Service Account.
5. Defina o intervalo, mantenha a rotina ativada e salve.
6. Use **Sincronizar agora** para antecipar a primeira execução e acompanhe o histórico.

Use **Pausar** para interromper novas verificações sem remover conteúdo. A ação **Desvincular** remove da Knowledge Base os arquivos enviados pelo worker e preserva os originais no Drive.

Cada vínculo é isolado pelo ID da Knowledge Base. Arquivos da Pasta A enviados para a Base A não entram na Base B. Dentro da base, o worker cria a estrutura `Google Drive (gerenciado)/<pasta>--<id>/` e registra somente os arquivos que ele próprio enviou. Exclusões no Drive removem apenas esses arquivos gerenciados; uploads manuais são preservados.

O fluxo é unidirecional: alterações feitas no Drive chegam ao Open WebUI. Alterar ou remover arquivos diretamente na área gerenciada da base não modifica o Drive e pode ser revertido na próxima sincronização.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Validar a sincronização</summary>

1. No painel, use **Testar conexão**.
2. Vincule uma pasta pequena a uma Knowledge Base de teste.
3. Clique em **Sincronizar agora** e abra **Histórico**.
4. Acesse a Knowledge Base no Open WebUI e confirme que os arquivos aparecem na área gerenciada.
5. Edite um arquivo no Drive, sincronize novamente e confirme a atualização.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Opcional: Picker manual nativo do Open WebUI</summary>

O Picker permite que usuários importem arquivos manualmente pelo menu de anexos. Ele é independente da sincronização e exige OAuth Client ID e API Key.

Na versão `v0.10.2`, o toggle é persistente, mas o Client ID e a API Key são lidos somente na inicialização. Eles não são aplicados em **Bases e Drive**, pois recriar containers pelo navegador exigiria expor controle privilegiado do Docker ao painel.

Se quiser habilitar esse recurso opcional:

1. Ative **Google Picker API** no mesmo projeto.
2. Configure a tela de consentimento em **Google Auth Platform** e adicione os escopos `drive.readonly` e `drive.file`.
3. Crie um OAuth Client do tipo **Web application** e cadastre a origem usada para acessar o Open WebUI.
4. Crie uma API Key restrita ao site e às APIs Google Drive e Google Picker.
5. Adicione a `data/secrets/openwebui.env`:

```dotenv
ENABLE_GOOGLE_DRIVE_INTEGRATION=true
GOOGLE_DRIVE_CLIENT_ID=seu-client-id.apps.googleusercontent.com
GOOGLE_DRIVE_API_KEY=sua-api-key
```

6. Recrie apenas o Open WebUI:

```bash
docker compose up -d --force-recreate open-webui
```

Não informe nem armazene o OAuth Client Secret; o Picker não o utiliza.

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Solução de problemas</summary>

| Sintoma | Verificação |
| --- | --- |
| JSON recusado | Confirme que foi baixado como chave JSON de uma Service Account e contém `type`, `client_email` e `private_key`. |
| Teste de conexão falha | Confirme que a Google Drive API está ativa no projeto e substitua uma chave revogada. |
| A pasta não aparece | Compartilhe-a como Leitor com o e-mail exibido no painel. Também é possível informar diretamente o folder ID. |
| Worker indisponível | Consulte `docker compose ps knowledge-sync` e `docker compose logs knowledge-sync`. Ele é iniciado automaticamente pela instalação. |
| Sincronização falha ao autenticar no Open WebUI | Execute novamente o instalador para recriar o worker com a credencial administrativa atual. |
| Origem vazia | O worker preserva os arquivos existentes quando uma origem previamente preenchida retorna vazia. Verifique permissões e disponibilidade do Drive. |
| Picker manual não aparece | Configure as variáveis da seção opcional e recrie o serviço `open-webui`. |

</details>

---

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Referências oficiais</summary>

- [Google Drive API](https://developers.google.com/workspace/drive/api/guides/about-sdk)
- [Criar e gerenciar Service Accounts](https://cloud.google.com/iam/docs/service-accounts-create)
- [Criar e excluir chaves de Service Account](https://cloud.google.com/iam/docs/keys-create-delete)
- [Compartilhar arquivos e pastas no Google Drive](https://support.google.com/drive/answer/2494822)
- [Integração Google Drive no Open WebUI](https://docs.openwebui.com/features/chat-conversations/rag/#google-drive-integration)
- [Configurar o Google Picker para uma aplicação web](https://developers.google.com/workspace/drive/picker/guides/web-picker)

</details>
