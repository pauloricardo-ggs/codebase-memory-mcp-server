# Codebase Memory MCP Server

Servidor para disponibilizar repositórios de código a clientes MCP, com painel administrativo para clonar, sincronizar, indexar e controlar o acesso de cada desenvolvedor.

Depois de instalado, o ambiente oferece:

- painel para gerenciar workspaces e repositórios;
- indexação e exploração de código pelo Codebase Memory;
- endpoint MCP remoto protegido por token;
- usuários MCP com acesso limitado aos repositórios autorizados;
- sincronização manual ou agendada dos clones;
- interface visual para explorar os grafos indexados.

## Como funciona

O administrador conecta uma conta do GitHub, organiza os repositórios em workspaces e inicia a primeira indexação. Em seguida, cria um usuário MCP para cada desenvolvedor e escolhe quais repositórios ele poderá consultar.

O cliente MCP se conecta ao endpoint HTTP do servidor usando o token individual:

```text
Cliente MCP
    │  Streamable HTTP + Bearer token
    ▼
http://<servidor>:8787/mcp
    │
    ▼
Codebase Memory → índices dos repositórios autorizados
```

O token individual limita tanto as ferramentas disponíveis quanto os projetos retornados por `list_projects`.

## Requisitos do servidor

- Debian, Ubuntu ou distribuição compatível com `apt-get`;
- usuário comum com acesso a `sudo`;
- acesso de rede ao GitHub e aos clientes MCP;
- acesso de leitura aos repositórios que serão indexados.

O instalador configura Docker, Docker Compose, Git e o Codebase Memory MCP. Não execute o instalador diretamente como `root`.

## Instalação no servidor

Clone o projeto no diretório em que os dados deverão permanecer:

```bash
git clone git@github.com:pauloricardo-ggs/codebase-memory-mcp-server.git
cd codebase-memory-mcp-server
chmod +x install.sh
./install.sh
```

Durante a instalação, informe:

- o limite de memória do Codebase Memory;
- o usuário administrativo;
- uma senha administrativa com pelo menos 12 caracteres.

O instalador cria o `.env`, prepara os diretórios persistentes, constrói os containers e valida o endpoint MCP. Em uma reinstalação, deixe a nova senha vazia para manter a credencial atual.

Ao concluir, os serviços ficam disponíveis nos seguintes endereços:

| Serviço | Endereço padrão |
| --- | --- |
| Explorador de grafos | `http://<servidor>:8787/` |
| Painel administrativo | `http://<servidor>:8787/admin/` |
| Endpoint MCP | `http://<servidor>:8787/mcp` |
| Painel do MCP Gateway | `http://<servidor>:8788/mcp-panel/` |

As interfaces web usam o usuário e a senha definidos na instalação. O endpoint `/mcp` usa tokens MCP, não a senha administrativa.

Se `UI_PORT` ou `AGENTGATEWAY_UI_PORT` forem alterados no `.env`, use as novas portas nos endereços acima.

## Primeiro uso

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

## Criando um usuário MCP

No painel administrativo:

1. abra **Usuários MCP**;
2. clique em **Novo usuário**;
3. informe nome e e-mail ou login;
4. selecione os repositórios permitidos;
5. crie o usuário e copie o token exibido.

O token individual é mostrado somente durante a criação, rotação ou reativação. Entregue-o ao desenvolvedor por um canal seguro.

Não grave tokens no Git, no `README`, em skills, em `AGENTS.md` ou diretamente em configurações versionadas. Prefira variáveis de ambiente ou um cofre de segredos.

Alterações de acesso passam a valer nas chamadas seguintes. Adicionar um novo repositório ao workspace não o libera automaticamente para usuários existentes.

## Conectando um cliente MCP

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

## Permissões MCP

Tokens individuais são destinados à análise de código. Eles podem consultar somente os repositórios selecionados pelo administrador e não recebem ferramentas administrativas de indexação ou exclusão.

A credencial **Sistema / Playground** é criada automaticamente para validações e administração. Ela tem acesso irrestrito e não deve ser distribuída como token de desenvolvedor.

No painel do gateway, abra **MCP → Tool Playground** e informe essa credencial no campo **Bearer token** quando precisar testar manualmente o servidor.

## Sincronização e indexação

A primeira indexação é iniciada manualmente pelo botão **Indexar**.

Cada workspace possui uma sincronização automática, habilitada por padrão para executar no início de cada hora. A rotina usa `git pull --ff-only`; o watcher do Codebase Memory detecta as mudanças e atualiza o índice.

No detalhe do workspace é possível:

- alterar o cron e o fuso horário;
- desativar a sincronização automática;
- executar uma sincronização imediatamente.

## Configuração

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
WORKSPACE_TIMEZONE=America/Maceio
REPOSITORY_SYNC_CONCURRENCY=3
ADMIN_USERNAME=admin
```

As opções mais comuns são:

| Variável | Finalidade |
| --- | --- |
| `CBM_MEM_BUDGET_MB` | Limite de memória do Codebase Memory, em MB |
| `UI_PORT` | Porta do painel, explorador e endpoint MCP |
| `AGENTGATEWAY_UI_PORT` | Porta do painel do MCP Gateway |
| `WORKSPACE_TIMEZONE` | Fuso usado nos agendamentos |
| `REPOSITORY_SYNC_CONCURRENCY` | Quantidade de sincronizações simultâneas, entre 1 e 20 |

Execute novamente `./install.sh` depois de alterar configurações que exijam a recriação do ambiente.

## Estrutura de dados

```text
codebase-memory-mcp-server/
├── app/             # painel administrativo e controle de acesso
├── agentgateway/    # configuração do gateway MCP
├── nginx/           # proxy HTTP e autenticação das interfaces
├── cache/           # índices do Codebase Memory
├── data/            # estado e segredos da instalação
├── repositories/    # clones organizados por workspace
├── compose.yaml
├── install.sh
└── .env
```

Mantenha o clone no mesmo caminho depois da instalação, pois o `.env` contém caminhos absolutos. Se precisar movê-lo, execute novamente `./install.sh` no novo local.

## Segurança

- use um token MCP individual para cada desenvolvedor;
- conceda acesso somente aos repositórios necessários;
- mantenha `data/`, `.env` e os tokens fora do Git;
- não exponha o servidor diretamente à internet sem TLS e controles de rede;
- use SSO/OIDC e auditoria individual quando houver múltiplos administradores;
- prefira uma GitHub App ou token fine-grained com permissões mínimas.

Em produção, publique o serviço atrás da infraestrutura HTTPS da organização e restrinja o acesso à rede corporativa ou VPN.
