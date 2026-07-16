# Codebase Memory MCP Server

Servidor para disponibilizar repositórios de código a clientes MCP, com painel administrativo para clonar, sincronizar, indexar e controlar o acesso de cada desenvolvedor.

Depois de instalado, o ambiente oferece:

- painel para gerenciar workspaces e repositórios;
- indexação e exploração de código pelo Codebase Memory;
- endpoint MCP remoto protegido por token;
- token MCP automático por workspace, com acesso dinâmico aos seus repositórios;
- usuários MCP individuais com acesso limitado aos repositórios autorizados;
- sincronização manual ou agendada dos clones;
- interface visual para explorar os grafos indexados;
- Open WebUI, Ollama e Docling executados pelo Docker Compose.
- sincronização opcional entre pastas do Google Drive e Knowledge Bases.

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Como funciona</summary>

O administrador conecta uma conta do GitHub, organiza os repositórios em workspaces e inicia a primeira indexação. Cada workspace recebe automaticamente um token MCP que acompanha todos os repositórios atualmente contidos nele. Usuários MCP individuais continuam disponíveis para acessos mais específicos.

O cliente MCP se conecta ao endpoint HTTP do servidor usando um token de workspace ou individual:

```text
Cliente MCP
    │  Streamable HTTP + Bearer token
    ▼
http://<servidor>:8787/mcp
    │
    ▼
Codebase Memory → índices dos repositórios autorizados
```

O token limita tanto as ferramentas disponíveis quanto os projetos retornados por `list_projects`.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Requisitos do servidor</summary>

- Debian, Ubuntu ou distribuição compatível com `apt-get`;
- usuário comum com acesso a `sudo`;
- acesso de rede ao GitHub e aos clientes MCP;
- acesso de leitura aos repositórios que serão indexados.

O instalador configura Docker, Docker Compose, Git e o Codebase Memory MCP. Não execute o instalador diretamente como `root`.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Instalação no servidor</summary>

Clone o projeto no diretório em que os dados deverão permanecer:

```bash
git clone git@github.com:pauloricardo-ggs/codebase-memory-mcp-server.git
cd codebase-memory-mcp-server
chmod +x install.sh
./install.sh
```

Durante a instalação, informe:

- o limite de memória do Codebase Memory;
- o modelo Ollama que será baixado (`qwen3:14b` por padrão);
- o e-mail administrativo;
- uma senha administrativa com pelo menos 6 caracteres.
- se deseja habilitar o Google Drive e, em caso positivo, o OAuth Client ID, a API Key do Google Picker e o JSON de uma Service Account para sincronização automática.

Antes de habilitar o Google Drive, siga o guia [Configurar o Google Drive para o Open WebUI](docs/google-drive.md) para criar o projeto, ativar as APIs, configurar o consentimento OAuth e gerar as credenciais no Google Cloud Console.

O instalador cria o `.env`, prepara os diretórios persistentes, constrói os containers, baixa o modelo escolhido e o `bge-m3`, configura os exemplos do Open WebUI e valida o endpoint MCP. A conta do Open WebUI usa o nome `Admin` e o e-mail informado na instalação. Em uma reinstalação, deixe a nova senha vazia para manter a credencial atual. Se o e-mail ou a senha mudar, o instalador autentica com a credencial anterior, atualiza o administrador no banco do Open WebUI e preserva chats, documentos e Knowledge Bases.

Instalações novas usam o Codebase Memory MCP `v0.8.1`, baixado diretamente dessa release. O instalador preserva um binário já existente; para atualizar posteriormente por decisão administrativa, execute `~/.local/bin/codebase-memory-mcp update`.

Ao concluir, os serviços ficam disponíveis nos seguintes endereços:

| Serviço | Endereço padrão |
| --- | --- |
| Explorador de grafos | `http://<servidor>:8787/` |
| Painel administrativo | `http://<servidor>:8787/admin/` |
| Endpoint MCP | `http://<servidor>:8787/mcp` |
| Painel do MCP Gateway | `http://<servidor>:8788/mcp-panel/` |
| Open WebUI | `http://<servidor>:3000/` |

As interfaces web usam o e-mail e a senha definidos na instalação. O endpoint `/mcp` usa tokens MCP, não a senha administrativa.

Se `UI_PORT`, `AGENTGATEWAY_UI_PORT` ou `OPENWEBUI_PORT` forem alterados no `.env`, use as novas portas nos endereços acima.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Primeiro uso</summary>

1. Acesse `http://<servidor>:8787/admin/`.
2. Clique em **Conectar GitHub**.
3. Informe um token fine-grained do GitHub.
4. Crie um workspace.
5. Abra o workspace e selecione **Adicionar repositórios**.
6. Escolha os repositórios e aguarde o clone.
7. Acompanhe o andamento em **Operações**.
8. Use **Indexar** em cada repositório que estiver pronto.
9. Crie os acessos dos desenvolvedores em **Usuários MCP**.

O token do GitHub precisa de leitura de metadados. Para repositórios privados, conceda também leitura de conteúdo. Restrinja o token à organização e aos repositórios necessários.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Token MCP do workspace</summary>

Ao criar um workspace, o painel gera e registra uma credencial MCP própria. No detalhe do workspace é possível exibir, copiar, rotacionar, revogar ou reativar o token.

O acesso é calculado em cada chamada a partir dos repositórios atuais do workspace. Um repositório adicionado passa a ser permitido quando possuir um projeto indexado, e um repositório removido deixa de ser permitido imediatamente. O token é armazenado criptografado e nunca aparece nas listagens comuns da API.

Inclua `data/secrets/mcp-workspace-encryption-key` nos backups. Sem essa chave, tokens restaurados não poderão ser revelados.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Criando um usuário MCP individual</summary>

No painel administrativo:

1. abra **Usuários MCP**;
2. clique em **Novo usuário**;
3. informe nome e e-mail ou login;
4. selecione os repositórios permitidos;
5. crie o usuário e copie o token exibido.

O token individual é mostrado somente durante a criação, rotação ou reativação. Entregue-o ao desenvolvedor por um canal seguro.

Não grave tokens no Git, no `README`, em skills, em `AGENTS.md` ou diretamente em configurações versionadas. Prefira variáveis de ambiente ou um cofre de segredos.

Alterações de acesso individual passam a valer nas chamadas seguintes. Diferentemente do token automático do workspace, um usuário individual mantém uma seleção explícita de repositórios.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Open WebUI, Ollama e Docling</summary>

Os documentos são enviados normalmente pelo Open WebUI. O Open WebUI encaminha PDFs, documentos e imagens ao Docling, que executa OCR, preserva layout e extrai tabelas. Em seguida, o `bge-m3` no Ollama gera os embeddings usados pela Knowledge Base.

Na primeira instalação, o bootstrap idempotente cria:

- `Knowledge Base Sample`, vazia e pronta para uploads;
- `MCP Admin`, ativa, validada contra o endpoint local e autenticada pelo token Sistema/Playground;
- `Business Model Sample`, associado à Knowledge Base;
- `Code Model Sample`, conectado ao `MCP Admin`.

Os dois presets são exemplos, mas já recebem como modelo-base o modelo Ollama escolhido na instalação. O bootstrap valida a conexão MCP antes de salvá-la e associa a ferramenta ativa ao modelo de código.

O `MCP Admin` usa a credencial Sistema/Playground e, portanto, possui acesso total a todos os projetos e ferramentas do MCP. Restrinja no Open WebUI quem pode acessar o `Code Model Sample` e a ferramenta. Para acessos com escopo por workspace ou por desenvolvedor, continue usando os tokens específicos criados pelo painel.

A credencial administrativa e o `WEBUI_SECRET_KEY` ficam em `data/secrets/openwebui.env`, fora do Git. Os dados de Ollama, Docling e Open WebUI persistem em volumes Docker próprios.

Quando o Google Drive é habilitado no instalador, o mesmo arquivo secreto recebe `ENABLE_GOOGLE_DRIVE_INTEGRATION`, `GOOGLE_DRIVE_CLIENT_ID` e `GOOGLE_DRIVE_API_KEY`. O `env_file` do container disponibiliza essas variáveis ao Open WebUI para importação pelo Picker.

O instalador também ativa o container opcional `knowledge-sync`, guarda a Service Account em `data/secrets/google-drive-service-account.json` e habilita **Bases e Drive** no painel administrativo. Nessa seção, cada Knowledge Base pode ser vinculada a uma ou mais pastas, com intervalo, execução manual, pausa, status e histórico próprios. O worker envia somente as mudanças para a base vinculada; extração e embeddings continuam sendo executados pelo Open WebUI, Docling e Ollama.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Conectando um cliente MCP</summary>

O servidor usa o transporte MCP Streamable HTTP no endpoint:

```text
http://<servidor>:8787/mcp
```

Cada requisição deve enviar o token individual:

```http
Authorization: Bearer cbm_mcp_...
```

Use o recurso do próprio cliente para ler o token de uma variável de ambiente ou armazenamento seguro.

### Codex

Adicione o servidor ao arquivo de usuário `~/.codex/config.toml`:

```toml
[mcp_servers.codebase_memory]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
url = "http://192.168.64.3:8787/mcp"

[mcp_servers.codebase_memory.http_headers]
Authorization = "Bearer <SEU_TOKEN>>"
```

Substitua o IP e a porta pelos valores da sua instalação e reinicie o Codex.

### Skill

Este repositório inclui uma skill para orientar investigações pelo Codebase Memory em [`docs/skills/company-codebase-memory/`](docs/skills/company-codebase-memory/).

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Permissões MCP</summary>

Tokens individuais são destinados à análise de código. Eles podem consultar somente os repositórios selecionados pelo administrador e não recebem ferramentas administrativas de indexação ou exclusão.

A credencial **Sistema / Playground** é criada automaticamente para validações e administração. Ela tem acesso irrestrito e não deve ser distribuída como token de desenvolvedor.

No painel do gateway, abra **MCP → Tool Playground** e informe essa credencial no campo **Bearer token** quando precisar testar manualmente o servidor.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Sincronização e indexação</summary>

A primeira indexação é iniciada manualmente pelo botão **Indexar**.

Cada workspace possui uma sincronização automática, habilitada por padrão para executar no início de cada hora. A rotina usa `git pull --ff-only`; o watcher do Codebase Memory detecta as mudanças e atualiza o índice.

No detalhe do workspace é possível:

- alterar o cron e o fuso horário;
- desativar a sincronização automática;
- executar uma sincronização imediatamente.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Configuração</summary>

O instalador gera um `.env` semelhante a:

```dotenv
CBM_CACHE_DIR=/caminho/do/clone/cache
CBM_ALLOWED_ROOT=/caminho/do/clone/repositories
CBM_MEM_BUDGET_MB=8192
CBM_HOST_BIN=/home/usuario/.local/bin/codebase-memory-mcp
LOCAL_UID=1000
LOCAL_GID=1000
UI_PORT=8787
AGENTGATEWAY_UI_PORT=8788
OPENWEBUI_PORT=3000
WORKSPACE_TIMEZONE=America/Maceio
REPOSITORY_SYNC_CONCURRENCY=3
ADMIN_EMAIL=admin@local.invalid
ADMIN_USERNAME=admin@local.invalid
OLLAMA_CHAT_MODEL=qwen3:14b
```

As opções mais comuns são:

| Variável | Finalidade |
| --- | --- |
| `CBM_MEM_BUDGET_MB` | Limite de memória do Codebase Memory, em MB |
| `UI_PORT` | Porta do painel, explorador e endpoint MCP |
| `AGENTGATEWAY_UI_PORT` | Porta do painel do MCP Gateway |
| `OPENWEBUI_PORT` | Porta pública do Open WebUI |
| `WORKSPACE_TIMEZONE` | Fuso usado nos agendamentos |
| `REPOSITORY_SYNC_CONCURRENCY` | Quantidade de sincronizações simultâneas, entre 1 e 20 |
| `OLLAMA_CHAT_MODEL` | Modelo baixado pelo instalador; padrão `qwen3:14b` |
| `OLLAMA_VERSION` | Tag da imagem Docker do Ollama |
| `DOCLING_VERSION` | Tag da imagem Docker do Docling Serve |

Execute novamente `./install.sh` depois de alterar configurações que exijam a recriação do ambiente.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Estrutura de dados</summary>

```text
codebase-memory-mcp-server/
├── app/             # painel administrativo e controle de acesso
├── agentgateway/    # configuração do gateway MCP
├── nginx/           # proxy HTTP e autenticação das interfaces
├── openwebui/       # bootstrap declarativo da Knowledge Base e presets
├── cache/           # índices do Codebase Memory
├── data/            # estado e segredos da instalação
├── repositories/    # clones organizados por workspace
├── compose.yaml
├── install.sh
└── .env
```

Mantenha o clone no mesmo caminho depois da instalação, pois o `.env` contém caminhos absolutos. Se precisar movê-lo, execute novamente `./install.sh` no novo local.

</details>

--- 

<details>
<summary style="font-size: 1.5em; font-weight: bold;">Segurança</summary>

- use o token do workspace somente onde o acesso a todos os seus repositórios for adequado;
- use tokens individuais quando for necessário um escopo menor;
- conceda acesso somente aos repositórios necessários;
- mantenha `data/`, `.env` e os tokens fora do Git;
- não exponha o servidor diretamente à internet sem TLS e controles de rede;
- use SSO/OIDC e auditoria individual quando houver múltiplos administradores;
- prefira uma GitHub App ou token fine-grained com permissões mínimas.

Em produção, publique o serviço atrás da infraestrutura HTTPS da organização e restrinja o acesso à rede corporativa ou VPN.

</details>
