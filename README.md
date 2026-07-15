# Codebase Memory MCP Server

Painel administrativo para organizar workspaces, clonar repositórios do GitHub e gerenciar indexações do `codebase-memory-mcp`.

## Funcionalidades

- criação e exclusão segura de workspaces;
- conexão persistente com GitHub por token fine-grained;
- listagem alfabética e busca de repositórios acessíveis;
- seleção múltipla e clone automático no workspace correto;
- sincronização por `git pull --ff-only`;
- indexação manual pelo Codebase Memory;
- acompanhamento de operações, progresso, logs e erros;
- persistência local dos workspaces e repositórios;
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

O primeiro boot não cria API keys nem ativa a validação, permitindo testar o
Playground da interface. O endpoint MCP fica temporariamente acessível para
quem alcança a rede local. Ao cadastrar a primeira chave individual, ative a
política `apiKey` em modo `strict`.

Os containers `admin` e `agentgateway` não publicam portas diretamente no host.
Somente o container `proxy` publica `8787` e `8788`; as portas internas `3000`
e `15000` não podem ser acessadas diretamente.

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
ADMIN_USERNAME=admin
```

`UI_PORT` controla tanto a porta publicada pelo proxy quanto a porta MCP
anunciada pelo AgentGateway no Playground. `AGENTGATEWAY_UI_PORT` controla a
porta pública da interface administrativa do gateway.

Antes de cada inicialização, o serviço one-shot `agentgateway-config` sincroniza
o valor numérico de `UI_PORT` em `data/agentgateway/config.yaml`. Isso é
necessário porque o runtime do AgentGateway expande variáveis de ambiente, mas
o Playground lê o YAML persistido diretamente. As demais alterações feitas
pela Admin UI são preservadas.

Na migração, uma política `apiKey` em modo `strict` com `keys: []` é removida,
pois ela impediria o uso inicial do
Playground sem oferecer uma credencial válida. Políticas que contenham chaves
são preservadas.

O serviço one-shot `agentgateway-ready` aguarda o listener MCP aceitar conexões
antes de liberar a inicialização do Nginx. Isso evita respostas `502` durante a
janela em que a Admin UI já está disponível, mas o listener MCP ainda está
subindo.

O instalador força a recriação dos containers depois dessa sincronização. Sem
isso, o Docker Compose pode manter um AgentGateway antigo em execução porque a
definição do serviço não mudou, mesmo que o arquivo persistido tenha recebido
uma nova porta.

Durante a instalação, o sistema também confirma que `/api/config` anuncia
`UI_PORT` e executa uma chamada MCP `initialize` completa através do Nginx. A
instalação falha com os logs do gateway caso qualquer uma dessas verificações
não passe. Uma resposta `401` é considerada saudável quando a autenticação já
estiver configurada, pois comprova que o endpoint foi alcançado e protegido.

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
- identificadores e caminhos são mantidos dentro da raiz permitida;
- comandos Git e Codebase Memory não são construídos por interpolação de shell;
- containers executam com o UID/GID não privilegiado da instalação.

Para múltiplos usuários, substitua o Basic Auth por SSO/OIDC e adicione auditoria individual. Para uma integração corporativa permanente com o GitHub, prefira uma GitHub App com permissões mínimas e tokens de curta duração.
