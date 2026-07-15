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
- interface responsiva acessível somente pelo host local.

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

Todas as interações acontecem no início: primeiro a seleção de memória e depois, se necessário, a senha do `sudo`. A credencial do `sudo` é mantida ativa durante a execução e a instalação de pacotes usa modo não interativo, evitando que o processo pare aguardando uma resposta depois de iniciar as etapas demoradas.

Ao final, abra:

```text
http://127.0.0.1:8787
```

Por segurança, o Compose publica o painel somente em `127.0.0.1`. Para acesso remoto, utilize uma VPN ou um proxy reverso com TLS e autenticação; não altere o bind para `0.0.0.0` sem adicionar esses controles.

## Primeiro uso

1. Clique em **Conectar GitHub**.
2. Informe um token fine-grained com acesso de leitura aos repositórios desejados.
3. Crie um workspace.
4. Abra o workspace e clique em **Adicionar repositórios**.
5. Pesquise, selecione os repositórios e confirme.
6. Acompanhe os clones na tela **Operações**.
7. Use **Indexar** quando o clone estiver pronto.

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
```

`LOCAL_UID` e `LOCAL_GID` fazem o container gravar arquivos com o mesmo proprietário do usuário que executou a instalação.

## Indexação

O instalador mantém:

```text
auto_index = false
auto_watch = true
```

`CBM_ALLOWED_ROOT` restringe os caminhos aceitos, enquanto `auto_index=false` mantém a primeira indexação como uma ação administrativa explícita. O botão **Indexar** executa essa ação pelo backend do painel.

## Operação do painel

Verifique os containers:

```bash
docker compose ps
```

Consulte os logs:

```bash
docker compose logs -f admin
```

Reinicie o painel:

```bash
docker compose restart admin
```

Atualize a imagem depois de alterar o código:

```bash
docker compose up -d --build
```

Pare o painel sem excluir dados:

```bash
docker compose down
```

## Comportamento das exclusões

- Um workspace só pode ser excluído quando não possui repositórios gerenciados.
- Uma pasta de workspace com arquivos desconhecidos não é apagada automaticamente.
- Excluir um repositório remove seu clone local depois de uma confirmação na interface.
- Operações concorrentes no mesmo repositório são bloqueadas.
- `cache/`, `data/` e `repositories/` não são removidos por `docker compose down`.

## Desenvolvimento

Os testes do backend não possuem dependências externas:

```bash
cd app
npm test
```

Valide o Compose:

```bash
docker compose config
```

## Segurança

Esta primeira versão é um painel administrativo de host único:

- escuta somente em `127.0.0.1`;
- persiste o token somente em `data/secrets/`, com acesso restrito ao usuário da instalação;
- valida identificadores e mantém caminhos dentro da raiz permitida;
- não utiliza shell para construir comandos Git ou Codebase Memory;
- executa o container com UID/GID não privilegiados;
- limita as montagens aos diretórios necessários e ao binário somente leitura.

Antes de disponibilizar o painel em rede, adicione autenticação, autorização, TLS, auditoria e proteção contra tentativas repetidas. Para uma integração corporativa permanente com o GitHub, a evolução recomendada é substituir o PAT por uma GitHub App com permissões mínimas e tokens de curta duração.
