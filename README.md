# Codebase Memory MCP Server

Instalação centralizada do `codebase-memory-mcp` para indexar repositórios e disponibilizar esse conhecimento a clientes compatíveis com MCP.

## Pré-requisitos

- Debian, Ubuntu ou distribuição compatível com `apt-get`;
- usuário comum com acesso a `sudo`;
- acesso aos repositórios Git que serão indexados.

O instalador não deve ser executado como `root`.

## Instalação

Clone este repositório no diretório em que os dados do serviço deverão permanecer:

```bash
git clone git@github.com:pauloricardo-ggs/codebase-memory-mcp-server.git
cd codebase-memory-mcp-server
chmod +x install.sh
./install.sh
```

O `sudo` é utilizado somente para atualizar a lista de pacotes e instalar dependências. O executável, os repositórios e o cache pertencem ao usuário que executou o instalador.

## Estrutura

O próprio clone é a raiz da instalação:

```text
codebase-memory-mcp-server/
├── .env                 # gerado; ignorado pelo Git
├── .sample_env
├── cache/               # gerado; ignorado pelo Git
├── repositories/        # gerado; ignorado pelo Git
├── scripts/             # gerado; ignorado pelo Git
│   ├── cbm-shell.sh
│   └── load-env.sh
├── templates/           # templates versionados dos scripts auxiliares
├── install.sh
└── README.md
```

Essa organização mantém configuração local, índices e clones fora do versionamento, sem separar os dados em outro diretório do usuário.

## Configuração automática

O instalador gera o `.env` de acordo com a localização real do clone:

```dotenv
CBM_CACHE_DIR=/caminho/do/clone/cache
CBM_ALLOWED_ROOT=/caminho/do/clone/repositories
CBM_MEM_BUDGET_MB=8192
```

Não é necessário editar `.sample_env` nem criar o `.env` manualmente.

Também são aplicadas estas configurações:

```text
auto_index = false
auto_watch = true
```

### Por que `auto_index=false`?

`CBM_ALLOWED_ROOT` e `auto_index` têm responsabilidades diferentes:

- `CBM_ALLOWED_ROOT` restringe os caminhos aceitos para indexação;
- `auto_index` decide se o projeto detectado na inicialização de uma sessão MCP será indexado automaticamente.

Portanto, manter `auto_index=false` continua sendo adequado para uma instalação centralizada: a raiz permitida estabelece o limite de segurança e a primeira indexação permanece uma ação administrativa explícita. Repositórios já indexados podem continuar sendo atualizados pelo watcher com `auto_watch=true`.

## O que o instalador faz

1. valida o sistema operacional, o usuário e o acesso ao `sudo`;
2. instala e valida as dependências;
3. pergunta o budget de memória;
4. cria `repositories/`, `cache/` e `scripts/` dentro do clone;
5. gera o `.env` com caminhos absolutos e permissão `600`;
6. instala a versão com interface do `codebase-memory-mcp`, caso necessário;
7. configura `auto_index=false` e `auto_watch=true`;
8. gera os scripts auxiliares;
9. valida o executável, a configuração e os diretórios.

Etapas demoradas apresentam um indicador de progresso em terminais interativos. Se alguma delas falhar, sua saída é exibida para diagnóstico.

O instalador pode ser executado novamente. O budget será perguntado outra vez e o `.env` será regenerado para refletir a localização atual do clone.

## Uso administrativo

Abra um shell com o ambiente carregado:

```bash
./scripts/cbm-shell.sh
```

Ou carregue as variáveis no shell atual:

```bash
source ./scripts/load-env.sh
```

Verifique a instalação:

```bash
codebase-memory-mcp --version
codebase-memory-mcp config list
```

## Repositórios e primeira indexação

Clone cada repositório dentro de `repositories/`. Subdiretórios organizacionais podem ser usados, mas cada repositório indexado deve possuir sua própria raiz Git:

```text
repositories/
├── workspace-1/
│   ├── repo-1/
│   └── repo-2/
└── workspace-2/
    └── repo-3/
```

Faça a primeira indexação explicitamente, usando um caminho absoluto:

```bash
./scripts/cbm-shell.sh

codebase-memory-mcp cli index_repository \
  "{\"repo_path\":\"${CBM_ALLOWED_ROOT}/workspace-1/repo-1\"}"

codebase-memory-mcp cli list_projects
```

## AgentGateway

Ao configurar o AgentGateway, utilize o arquivo `.env` deste clone como `EnvironmentFile` e o executável em `$HOME/.local/bin/codebase-memory-mcp`. Use os caminhos absolutos mostrados ao final da instalação.

A exposição em rede deve incluir TLS, autenticação, autorização, limitação das ferramentas administrativas, logs, métricas e credenciais Git somente leitura.

## Segurança e versionamento

O `.gitignore` exclui:

- `.env` e seu arquivo temporário;
- `cache/`;
- `repositories/`;
- `scripts/` gerados.

O `.env` recebe permissão `600`, o cache recebe `700` e a raiz permitida nunca deve apontar para o diretório pessoal completo nem para `/`.
