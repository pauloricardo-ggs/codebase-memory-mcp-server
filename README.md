# Codebase Memory MCP Server

Ambiente autogerenciado para disponibilizar repositórios a clientes MCP, explorar grafos de código e manter Knowledge Bases corporativas com Open WebUI, Ollama, Docling e Google Drive.

## Recursos

- painel para workspaces, repositórios, indexação e sincronização Git;
- endpoint MCP remoto protegido por tokens de workspace ou usuário;
- controle de acesso por repositório;
- interface de exploração dos grafos indexados;
- Open WebUI com chat e RAG híbrido;
- embeddings multilíngues com `bge-m3` e reranking;
- extração de documentos, OCR adaptativo e tabelas com Docling em CPU;
- sincronização incremental Drive → Knowledge Base por cron;
- Ollama em Docker no Linux ou nativo no macOS.

## Requisitos

- Debian, Ubuntu ou distribuição compatível com `apt-get`; ou macOS 14+;
- usuário comum com acesso a `sudo`;
- Docker e Docker Compose, instalados automaticamente quando necessário;
- acesso de leitura aos repositórios GitHub;
- GPU NVIDIA opcional para o Ollama no Linux.

Não execute o instalador diretamente como `root`.

## Instalação

```bash
git clone git@github.com:pauloricardo-ggs/codebase-memory-mcp-server.git
cd codebase-memory-mcp-server
chmod +x install.sh
./install.sh
```

O instalador solicita:

- orçamento de memória do Codebase Memory;
- runtime e modelo do Ollama;
- aceleração NVIDIA, quando disponível;
- e-mail e senha administrativos.

Ele cria `.env`, prepara diretórios e segredos, constrói os serviços, baixa o modelo de chat e o `bge-m3`, configura presets do Open WebUI e valida o endpoint MCP. Reinstalações preservam dados e configurações válidas.

O Google Drive é configurado depois da instalação, pelo painel. Consulte [Configurar Google Drive](GOOGLE-DRIVE-CONFIG.md).

## Endereços padrão

| Serviço | Endereço |
| --- | --- |
| Explorador de grafos | `http://<servidor>:8787/` |
| Painel administrativo | `http://<servidor>:8787/admin/` |
| Endpoint MCP | `http://<servidor>:8787/mcp` |
| Painel do AgentGateway | `http://<servidor>:8788/mcp-panel/` |
| Open WebUI | `http://<servidor>:3000/` |

As interfaces usam as credenciais administrativas. `/mcp` usa um token MCP.

## Primeiro uso

1. Acesse o painel administrativo.
2. Conecte um token fine-grained do GitHub.
3. Crie um workspace e adicione repositórios.
4. Aguarde os clones e inicie a primeira indexação.
5. Crie acessos MCP por workspace ou por desenvolvedor.
6. No Open WebUI, envie documentos ou configure pastas do Drive.

O token GitHub precisa de leitura de metadados e, para repositórios privados, leitura de conteúdo. Restrinja-o à organização e aos repositórios necessários.

## Conectar um cliente MCP

O endpoint usa Streamable HTTP e Bearer token:

```text
http://<servidor>:8787/mcp
```

Exemplo para Codex em `~/.codex/config.toml`:

```toml
[mcp_servers.codebase_memory]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 120
url = "http://<servidor>:8787/mcp"

[mcp_servers.codebase_memory.http_headers]
Authorization = "Bearer <SEU_TOKEN>"
```

Guarde tokens em variáveis de ambiente ou armazenamento seguro. Não os versione.

## Como os documentos são processados

```text
Upload ou Google Drive
        ↓
Open WebUI → Docling CPU → Markdown estruturado
        ↓
Ollama/bge-m3 → busca híbrida → reranker → chat
```

O Docling usa OCR somente onde necessário (`do_ocr=true`, `force_ocr=false`), mantém tabelas em modo preciso e não possui volume próprio. Seus modelos vêm na imagem; documentos, chunks e vetores persistem no Open WebUI.

A sincronização do Drive usa cron por Knowledge Base. O padrão `30 * * * *` verifica mudanças no minuto 30 de cada hora. Bases vencidas entram em uma fila sequencial para limitar o consumo de recursos.

## Documentação

- [Arquitetura e operação técnica](ARCHITECTURE.md)
- [Configuração e manutenção](CONFIGURATION.md)
- [Configurar Google Drive](GOOGLE-DRIVE-CONFIG.md)
- [Skill Company Codebase Memory](skills/company-codebase-memory/)

## Segurança

- não exponha o ambiente diretamente à internet sem HTTPS e controles de rede;
- restrinja as portas do Ollama quando ele rodar no host macOS;
- use tokens individuais para escopos menores que um workspace;
- mantenha `data/`, `.env`, chaves e tokens fora do Git;
- restrinja a Service Account do Drive a leitura das pastas necessárias;
- preserve `data/secrets/mcp-workspace-encryption-key` nos backups.

Em produção, publique o proxy atrás da infraestrutura HTTPS da organização e restrinja o acesso à VPN ou rede corporativa.
