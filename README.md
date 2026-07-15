# Codebase Memory MCP Server

Painel administrativo para organizar workspaces, clonar repositórios do GitHub e gerenciar indexações do `codebase-memory-mcp`.

## Funcionalidades

- criação e exclusão segura de workspaces;
- conexão persistente com GitHub por token fine-grained;
- listagem alfabética e busca de repositórios acessíveis;
- seleção múltipla e clone automático no workspace correto;
- sincronização por `git pull --ff-only`;
- sincronização automática por workspace, com cron configurável e fila global;
- indexação manual pelo Codebase Memory;
- acompanhamento de operações, progresso, logs e erros;
- persistência local dos workspaces e repositórios;
- usuários MCP com autorização individual por repositório;
- interface responsiva protegida por Nginx e autenticação.

O token do GitHub é validado antes de ser salvo em `data/secrets/github-credentials.json`. O diretório recebe permissão `700` e o arquivo `600`; ambos ficam fora do Git. O token não é salvo no `.env`, na URL do clone ou nos logs e permanece disponível depois de rebuilds, reinicializações e novas execuções do instalador.

## Pré-requisitos

- Debian, Ubuntu ou distribuição compatível com `apt-get`;
- usuário comum com acesso a `sudo`;
- acesso aos repositórios Git que serão indexados.

O instalador configura Docker, Docker Compose, Git e o Codebase Memory MCP. Ele não deve ser executado diretamente como `root`.

## Instalação

Clone este repositório no diretório em que os dados deverão permanecer:

```bash
git clone <URL-DESTE-REPOSITORIO>
cd codebase-memory-mcp-server
chmod +x install.sh
./install.sh
```

Durante a instalação, escolha o orçamento de memória:

- 4 GB (`4096` MB);
- 8 GB (`8192` MB);
- 16 GB (`16384` MB);
- 32 GB (`32768` MB);
- outro valor inteiro informado em MB.

As opções em GB são convertidas usando `1 GB = 1024 MB`, conforme o formato de `CBM_MEM_BUDGET_MB`.

Em uma reinstalação, deixar a nova senha vazia preserva a credencial existente. Não é necessário configurar domínio durante a instalação.

Ao final, abra:

```text
http://<IP-ou-dominio>:8787/admin/
```

A interface administrativa do AgentGateway usa a mesma credencial do painel e
fica disponível em:

```text
http://<IP-ou-dominio>:8788/mcp-panel/
```

O proxy mantém `/mcp-panel/` no navegador e traduz internamente esse prefixo
para `/ui/`, caminho exigido pela interface oficial do AgentGateway.

O endpoint MCP remoto fica disponível na rede local em:

```text
http://<IP-ou-dominio>:8787/mcp
```

`8787` é apenas o valor padrão. Quando `UI_PORT` for alterado no `.env`, os
clientes devem usar `http://<IP-ou-dominio>:<UI_PORT>/mcp`.

O primeiro boot gera uma credencial técnica em modo `strict` antes de o proxy
publicar o endpoint. Portanto, `/mcp` nunca fica acessível na rede local sem uma
API key válida. O token técnico é usado pela validação da instalação e pode ser
copiado no menu **Usuários MCP** para uso no Playground.

Os containers `admin` e `agentgateway` não publicam portas diretamente no host.
Somente o container `proxy` publica `8787` e `8788`; as portas internas `3000`
e `15000` não podem ser acessadas diretamente.

## Configuração do MCP nos agentes

Cada desenvolvedor deve receber uma API key individual pelo menu **Usuários
MCP**. Guarde o token somente na máquina do desenvolvedor.

Não grave o token no Git, na skill, no `AGENTS.md` nem diretamente em um arquivo
de configuração versionado.

### Codex

Adicione ao arquivo de usuário `~/.codex/config.toml`:

```toml
[mcp_servers.codebase_memory]
url = "http://192.168.64.3:8787/mcp"
bearer_token_env_var = "CODEBASE_MEMORY_MCP_TOKEN"
required = true
startup_timeout_sec = 20
tool_timeout_sec = 120
```

Substitua `192.168.64.3` pelo IP do servidor e `8787` pelo valor de `UI_PORT`.
`bearer_token_env_var` faz o cliente enviar o token como `Authorization: Bearer`
sem persistir o segredo no TOML. Com `required = true`, o Codex informa a falha
já na inicialização quando o servidor não está acessível; use `false` se o agente
também precisar funcionar fora da rede local sem o MCP.

Em outros clientes compatíveis com Streamable HTTP, configure a mesma URL e o
cabeçalho:

```text
Authorization: Bearer <token-individual>
```

Prefira sempre o mecanismo do cliente que lê o valor de uma variável de ambiente
ou cofre de segredos. A sintaxe de interpolação varia entre clientes e não deve
ser presumida como compatível.

Depois de reiniciar o agente, valide a conexão pedindo que ele execute
`list_projects`. Para uma API key individual, o guardrail filtra a resposta e
retorna somente os projetos autorizados para aquele usuário. A credencial
**Sistema / Playground** continua vendo todos os projetos.

### Skill corporativa

A skill completa para investigar arquitetura, fluxos, dependências, bugs e
impacto de alterações está em
[`docs/skills/company-codebase-memory/`](docs/skills/company-codebase-memory/).
Ela também orienta o agente a selecionar o ID técnico retornado por
`list_projects`, verificar a cobertura do índice, confirmar conclusões no código
local e tratar corretamente erros de autenticação e autorização.

Para instalá-la globalmente no Codex a partir deste clone:

```bash
mkdir -p ~/.agents/skills/company-codebase-memory
cp -R docs/skills/company-codebase-memory/. ~/.agents/skills/company-codebase-memory/
```

Reinicie o Codex após instalar ou atualizar a skill. Ela pode ser acionada
explicitamente com `$company-codebase-memory` e também possui uma descrição
abrangente para uso automático em investigações de código.

## Primeiro uso

1. Clique em **Conectar GitHub**.
2. Informe um token fine-grained com acesso de leitura aos repositórios desejados.
3. Crie um workspace.
4. Abra o workspace e clique em **Adicionar repositórios**.
5. Pesquise, selecione os repositórios e confirme.
6. Acompanhe os clones na tela **Operações**.
7. Use **Indexar** quando o clone estiver pronto.
8. Clique em **Explorar** no repositório ou em **Explorar grafo** no menu para abrir a UI oficial em uma nova aba.

Para listar repositórios, o token precisa de leitura de metadados. Para repositórios privados, conceda também leitura de conteúdo. Prefira restringir o token a uma única organização e somente aos repositórios necessários.

## Estrutura local

O próprio clone é a raiz da instalação:

```text
codebase-memory-mcp-server/
├── app/                  # painel administrativo
│   ├── public/           # interface web
│   └── src/              # API e operações administrativas
├── cache/                # índices; ignorado pelo Git
├── data/                 # estado do painel; ignorado pelo Git
│   └── secrets/proxy/    # hash da senha do Nginx
├── nginx/                # configuração versionada do proxy
├── repositories/         # clones por workspace; ignorado pelo Git
├── .env                  # gerado; ignorado pelo Git
├── compose.yaml
├── install.sh
└── README.md
```

Exemplo depois de adicionar repositórios:

```text
repositories/
├── pagamentos/
│   ├── checkout-api/
│   └── billing-worker/
└── identidade/
    └── authentication-api/
```

Mover o clone depois da instalação exige executar novamente o `install.sh`, pois o `.env` utiliza caminhos absolutos para operações no host.

## Configuração gerada

O instalador cria um `.env` semelhante a:

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

`UI_PORT` controla tanto a porta publicada pelo proxy quanto a porta MCP
anunciada pelo AgentGateway no Playground. `AGENTGATEWAY_UI_PORT` controla a
porta pública da interface administrativa do gateway.

Cada workspace possui uma rotina de sincronização criada e ativada por padrão
com o cron `0 * * * *` (minuto zero de cada hora). A rotina executa somente
`git pull --ff-only`; o watcher do Codebase Memory é responsável por detectar
as mudanças e atualizar o índice. O cron e o fuso podem ser alterados, e a
rotina pode ser desativada ou executada imediatamente no detalhe do workspace.

`REPOSITORY_SYNC_CONCURRENCY` limita os pulls simultâneos na instalação inteira,
somando todos os workspaces e as sincronizações manuais. O valor padrão é `3`
e o intervalo aceito pelo backend é de `1` a `20`.

Antes de cada inicialização, o serviço one-shot `agentgateway-config` sincroniza
o valor numérico de `UI_PORT` em `data/agentgateway/config.yaml` e, no primeiro
boot, gera a credencial técnica protegida. Isso é necessário porque o runtime
do AgentGateway expande variáveis de ambiente, mas o Playground lê o YAML
persistido diretamente. As demais alterações feitas pela Admin UI são
preservadas.

O bootstrap cria ou recupera `data/secrets/mcp-system-token` antes de iniciar o
AgentGateway. Em upgrades, o backend administrativo também reconcilia essa
credencial com `apiKey.mode: strict` antes de ficar saudável. Como o Nginx
depende dessa verificação de saúde, o MCP só é publicado depois que a proteção
estiver aplicada. A política `strict` também é preservada se não houver outras
chaves.

O serviço one-shot `agentgateway-ready` aguarda o listener MCP aceitar conexões
antes de liberar a inicialização do Nginx. Isso evita respostas `502` durante a
janela em que a Admin UI já está disponível, mas o listener MCP ainda está
subindo.

O instalador força a recriação dos containers depois dessa sincronização. Sem
isso, o Docker Compose pode manter um AgentGateway antigo em execução porque a
definição do serviço não mudou, mesmo que o arquivo persistido tenha recebido
uma nova porta.

Durante a instalação, o sistema também confirma que `/api/config` anuncia
`UI_PORT`, verifica que uma chamada sem token recebe `401` e executa um
`initialize` completo com a credencial técnica através do Nginx. A instalação
falha com os logs do gateway caso qualquer uma dessas verificações não passe.

Para conferir manualmente a porta que o Playground está lendo:

```bash
docker compose exec -T proxy \
  wget -qO- http://agentgateway:15000/api/config
```

O campo `mcp.port` deve ser igual ao `UI_PORT` do `.env`. Se a interface ainda
mostrar outra porta, recrie o inicializador e o gateway:

```bash
docker compose up -d --force-recreate agentgateway-config agentgateway proxy
```

Os logs relevantes ficam disponíveis com:

```bash
docker compose logs --tail=200 agentgateway-config agentgateway proxy
```

## Usuários e tokens MCP

O menu **Usuários MCP** do painel administrativo gerencia chaves individuais
sem exigir edição manual do YAML. O modo `strict` já começa ativo com uma chave
**Sistema / Playground**. Tokens individuais são exibidos apenas no momento da
criação, rotação ou reativação e devem ser enviados no cliente como:

```text
Authorization: Bearer cbm_mcp_...
```

O painel permite revogar, rotacionar, reativar e excluir usuários. Revogar ou
rotacionar remove imediatamente a chave anterior da lista aceita pelo gateway.
Chaves adicionadas manualmente à configuração são preservadas, pois o painel
altera somente entradas marcadas com `managedBy: codebase-memory-admin`. Porém,
uma chave manual sem `metadata.userId` correspondente a um usuário ativo do
painel é recusada pelo guardrail; o fluxo suportado é criar a chave pelo menu
**Usuários MCP**.

Ao criar ou editar um usuário, os workspaces aparecem como seletores em massa,
mas o cadastro persiste os identificadores individuais dos repositórios
selecionados. Adicionar um repositório futuramente ao mesmo workspace não o
libera automaticamente. Alterar a seleção entra em vigor nas chamadas seguintes
sem exigir rotação do token.

O nome do GitHub exibido no painel, como `ma9internet/clapsapi-contrato`, é
somente um rótulo amigável. O painel consulta `list_projects` e relaciona o
`root_path` do índice ao caminho do clone para salvar o ID técnico realmente
usado pelo MCP, como `data-repositories-claps-clapsapi-contrato`. Essa
reconciliação ocorre na inicialização, ao abrir a seleção de acessos e
periodicamente (a cada cinco minutos); o ID também aparece como **ID MCP** na
interface.

Tokens individuais expõem somente as ferramentas de análise e cada chamada é
validada contra o argumento `project`. `list_projects` é filtrado para retornar
apenas projetos autorizados. Ferramentas administrativas (`index_repository`,
`delete_project`, `manage_adr` e `ingest_traces`) e `trace_path` no modo
`cross_service` exigem a credencial **Sistema / Playground**, que permanece
irrestrita.

A validação é executada por um serviço gRPC ExtMcp interno na porta `3001`,
configurado como `mcpGuardrails` em modo `failClosed`. Essa porta é visível
somente na rede do Compose e nunca é publicada no host. O guardrail consulta o
cadastro atual em `mcp-users.json`; se estiver indisponível ou não reconhecer o
usuário, o AgentGateway recusa a chamada.

Repositórios ainda não indexados podem ser selecionados, mas só aceitam chamadas
quando a indexação registrar seu identificador `project`. Cadastros criados antes
da introdução da ACL são migrados com zero repositórios permitidos e precisam ser
editados uma vez pelo administrador.

O token **Sistema / Playground** pode ser revelado ou rotacionado por um
administrador. Para usar a UI oficial, abra **MCP → Tool Playground**, expanda
**Authorization header** e cole o valor em **Bearer token**. O AgentGateway
1.3.1 não carrega automaticamente chaves MCP configuradas no YAML; o painel não
injeta o segredo no navegador para evitar transformar a UI em um bypass de
autenticação.

Os dados administrativos ficam em
`data/secrets/mcp-users.json`, com permissão `0600`, contendo apenas o prefixo e
o hash de cada token individual. A credencial técnica fica em
`data/secrets/mcp-system-token`, também com permissão `0600`. O valor completo
de cada chave aceita ainda precisa existir em
`data/agentgateway/config.yaml`, pois o AgentGateway 1.3.1 valida API keys por
comparação direta. A configuração e esses diretórios devem permanecer
acessíveis somente ao usuário da instalação.

`LOCAL_UID` e `LOCAL_GID` fazem o container gravar arquivos com o mesmo proprietário do usuário que executou a instalação.

## Indexação

O instalador mantém:

```text
auto_index = false
auto_watch = true
```

`CBM_ALLOWED_ROOT` restringe os caminhos aceitos, enquanto `auto_index=false` mantém a primeira indexação como uma ação administrativa explícita. O botão **Indexar** executa essa ação pelo backend do painel.

## UI oficial do Codebase Memory

O Compose mantém um processo `graph-ui` ativo, mas ele não publica a porta `9749`. O serviço compartilha o namespace de rede do Nginx e fica disponível na raiz do mesmo endereço:

```text
http://<IP-ou-dominio>:8787/
```

O painel administrativo fica isolado no prefixo:

```text
http://<IP-ou-dominio>:8787/admin/
```

Seus endpoints usam `/admin/api/`. A UI oficial permanece na raiz para que os caminhos absolutos `/assets/`, `/rpc` e `/api/` funcionem sem reescritas frágeis. O mesmo `.htpasswd` protege todo o endereço, portanto o navegador normalmente solicita as credenciais apenas uma vez.

Depois de uma nova indexação, o painel salva o identificador `project` retornado pelo Codebase Memory. O botão **Explorar** abre diretamente o grafo desse projeto. Índices criados antes dessa versão abrem a lista geral de projetos até serem reindexados.

O TLS continuará sendo responsabilidade da infraestrutura externa da AWS. Quando o ALB estiver configurado, a UI e o painel poderão usar o mesmo domínio HTTPS sem alterações no backend, respectivamente em `/` e `/admin/`.

## Comportamento das exclusões

- Um workspace só pode ser excluído quando não possui repositórios gerenciados.
- Uma pasta de workspace com arquivos desconhecidos não é apagada automaticamente.
- Excluir um repositório remove seu clone local depois de uma confirmação na interface.
- Operações concorrentes no mesmo repositório são bloqueadas.
- `cache/`, `data/` e `repositories/` não são removidos por `docker compose down`.

## Segurança

O acesso ao painel possui as seguintes proteções:

- o backend não publica portas no host e só recebe tráfego da rede interna do Compose;
- somente o Nginx publica a porta `8787`;
- autenticação HTTP Basic com senha armazenada como hash APR1;
- rate limiting por endereço IP;
- headers contra framing, MIME sniffing e vazamento de referrer;
- `.htpasswd` armazenado em `data/secrets/proxy/`;
- token do GitHub armazenado separadamente em `data/secrets/`, com acesso restrito;
- cadastro MCP armazena somente prefixo e hash dos tokens fora da configuração do gateway;
- token técnico do MCP armazenado em `data/secrets/mcp-system-token` com permissão restrita;
- identificadores e caminhos são mantidos dentro da raiz permitida;
- comandos Git e Codebase Memory não são construídos por interpolação de shell;
- containers executam com o UID/GID não privilegiado da instalação.

Para múltiplos usuários, substitua o Basic Auth por SSO/OIDC e adicione auditoria individual. Para uma integração corporativa permanente com o GitHub, prefira uma GitHub App com permissões mínimas e tokens de curta duração.
