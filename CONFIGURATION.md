# Configuração e manutenção

## Arquivo `.env`

O instalador cria `.env` na raiz do projeto e preserva valores válidos durante reinstalações.

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
OLLAMA_VERSION=0.32.1
OLLAMA_CHAT_MODEL=gemma4:e2b
OLLAMA_RUNTIME=docker
OLLAMA_BASE_URL=http://ollama:11434
COMPOSE_PROFILES=ollama-docker
OLLAMA_GPU_MODE=all
OLLAMA_GPU_DEVICE_IDS=
DOCLING_VERSION=v1.26.0
DOCLING_CPU_THREADS=6
RAG_RERANKING_MODEL=BAAI/bge-reranker-v2-m3
RAG_RERANKING_BATCH_SIZE=4
RAG_TOP_K=20
RAG_TOP_K_RERANKER=8
```

| Variável | Finalidade |
| --- | --- |
| `CBM_MEM_BUDGET_MB` | Orçamento de memória do Codebase Memory. |
| `UI_PORT` | Painel, explorador e endpoint MCP. |
| `AGENTGATEWAY_UI_PORT` | Painel do AgentGateway. |
| `OPENWEBUI_PORT` | Porta pública do Open WebUI. |
| `WORKSPACE_TIMEZONE` | Fuso padrão dos agendamentos de repositórios e Drive. |
| `REPOSITORY_SYNC_CONCURRENCY` | Sincronizações Git simultâneas, entre 1 e 20. |
| `OLLAMA_CHAT_MODEL` | Modelo de chat baixado pelo instalador. |
| `OLLAMA_RUNTIME` | `docker` ou `host` no macOS. |
| `OLLAMA_GPU_MODE` | `cpu`, `all`, `selected` ou `metal`. |
| `OLLAMA_GPU_DEVICE_IDS` | UUIDs NVIDIA separados por vírgula. |
| `DOCLING_VERSION` | Tag estável da imagem `docling-serve-cpu`. |
| `DOCLING_CPU_THREADS` | Threads de CPU destinadas ao Docling. |
| `RAG_RERANKING_MODEL` | Cross-encoder multilíngue usado pelo Open WebUI. Vazio desativa o modelo. |
| `RAG_RERANKING_BATCH_SIZE` | Batch do reranker; valores menores reduzem picos de RAM. |
| `RAG_TOP_K` | Candidatos recuperados pela busca híbrida. |
| `RAG_TOP_K_RERANKER` | Resultados mantidos depois do reranking. |

Execute novamente `./install.sh` após alterações que exijam recriação dos serviços.

## GPU NVIDIA

No Linux, o instalador detecta GPUs com `nvidia-smi`, instala/configura o NVIDIA Container Toolkit quando necessário e gera `compose.gpu.yaml`. A GPU é reservada ao Ollama; o Docling permanece explicitamente em CPU.

Seleções usam UUID, não índice. Isso evita que mudanças na ordem das placas alterem a GPU escolhida.

Para validar:

```bash
docker compose exec -T ollama nvidia-smi
docker compose exec -T ollama ollama ps
```

## Reranking

O reranker local é carregado pelo Open WebUI em CPU. Na primeira inicialização ele pode baixar o modelo e demorar mais para ficar saudável.

Para desativar sem editar o compose:

```dotenv
RAG_RERANKING_MODEL=
```

Depois recrie o Open WebUI. Compare qualidade, RAM e latência antes de aumentar `RAG_TOP_K`, `RAG_TOP_K_RERANKER` ou o batch.

## Operação dos serviços

```bash
docker compose ps
docker compose logs --tail=200 docling open-webui knowledge-sync
docker compose restart docling
```

O healthcheck do Docling consulta `/health`. O Open WebUI só inicia depois que o Docling estiver saudável.

## Atualizações

- Fixe versões de Docling, Ollama e Open WebUI; não use `latest` em produção.
- Leia notas de release antes de alterar uma imagem.
- Faça backup do estado persistente.
- Recrie e valide os serviços.
- Reprocesse uma base de teste com PDF nativo, escaneado, tabelas e imagens.
- Trocar o modelo de embedding exige recriar os embeddings das Knowledge Bases.

## Estrutura do projeto

```text
codebase-memory-mcp-server/
├── app/                    # painel e BFF administrativo
├── agentgateway/           # gateway MCP
├── knowledge-sync/         # sincronização Drive → Knowledge Base
├── nginx/                  # proxy
├── openwebui/              # imagem derivada e bootstrap
├── skills/                 # skill distribuída com o projeto
├── cache/                  # índices locais
├── data/                   # estado e segredos
├── repositories/           # clones por workspace
├── compose.yaml
├── compose.gpu.yaml        # gerado quando necessário
├── install.sh
└── .env
```

Mantenha o clone no mesmo caminho depois da instalação, pois `.env` contém caminhos absolutos.
