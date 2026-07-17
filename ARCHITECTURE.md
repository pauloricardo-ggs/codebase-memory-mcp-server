# Arquitetura e operação técnica

Este documento descreve os serviços, fluxos de dados, persistência e decisões operacionais do ambiente.

## Visão dos serviços

```text
Clientes MCP
    │
    ▼
Nginx ──► AgentGateway ──► Codebase Memory MCP
   │              │
   │              └── controle de tokens e projetos permitidos
   ├──► painel administrativo
   └──► explorador de grafos

Google Drive ──► knowledge-sync ──► Open WebUI
                                         │
                              ┌──────────┴──────────┐
                              ▼                     ▼
                        Docling CPU           Ollama GPU/host
                    extração e OCR       chat e embeddings bge-m3
                              │                     │
                              └──────────┬──────────┘
                                         ▼
                            Knowledge Bases e RAG híbrido
```

| Serviço | Responsabilidade |
| --- | --- |
| `proxy` | Publica as interfaces e o endpoint MCP. |
| `agentgateway` | Encaminha chamadas MCP e aplica as credenciais configuradas. |
| `admin` | Gerencia workspaces, repositórios, usuários MCP e integração do Drive. |
| `graph-ui` | Executa a interface de exploração do Codebase Memory. |
| `open-webui` | Mantém chats, Knowledge Bases, arquivos, chunks e índice vetorial. |
| `docling` | Converte documentos, executa OCR adaptativo e extrai tabelas. |
| `ollama` | Executa o modelo de chat e o embedding `bge-m3`. |
| `knowledge-sync` | Detecta mudanças no Drive e envia apenas arquivos alterados. |

## Pipeline de documentos

1. Um arquivo é enviado manualmente ou detectado pelo `knowledge-sync`.
2. O Open WebUI encaminha o arquivo ao Docling.
3. O Docling preserva a estrutura textual, extrai tabelas e usa OCR quando necessário.
4. O Open WebUI divide o Markdown por página e em chunks.
5. O Ollama gera embeddings com `bge-m3`.
6. A consulta combina busca vetorial e lexical.
7. O reranker `BAAI/bge-reranker-v2-m3` ordena até 20 candidatos e mantém até 8 resultados.
8. Os melhores trechos, metadados e citações são enviados ao modelo de chat.

### OCR adaptativo

A configuração usa:

```json
{
  "do_ocr": true,
  "force_ocr": false,
  "ocr_engine": "tesseract",
  "ocr_lang": ["por", "eng"],
  "table_mode": "accurate"
}
```

O Docling aproveita texto nativo quando disponível e aplica OCR em páginas ou regiões que precisam dele. PDFs com uma camada textual defeituosa podem exigir reprocessamento manual com `force_ocr=true`.

### Imagens dentro dos documentos

O carregador Docling do Open WebUI usa `image_export_mode=placeholder` e indexa somente o Markdown devolvido. Portanto:

- texto visível em páginas escaneadas pode ser recuperado pelo OCR;
- tabelas são representadas como texto estruturado;
- a imagem binária não é incorporada pelo `bge-m3`;
- figuras não são retornadas automaticamente como thumbnails no chat.

Descrição semântica e retorno visual de figuras são evoluções separadas. Elas exigem um modelo visual, armazenamento das imagens, metadados de página/figura e suporte de renderização no chat. Não se deve inserir base64 nos chunks.

## Por que o Docling usa CPU

O ambiente de produção prioriza o Ollama em uma GPU NVIDIA dedicada. O Docling permanece em CPU para que OCR, layout e TableFormer não disputem VRAM com:

- modelo de chat e cache KV;
- embeddings `bge-m3`;
- possíveis modelos visuais futuros.

A imagem é `docling-serve-cpu`, fixada em uma versão explícita. O serviço usa um worker, compartilha modelos e mantém apenas um conversor no cache. `DOCLING_NUM_THREADS` controla o paralelismo de CPU.

Se um benchmark real mostrar que os lotes não terminam antes da próxima janela, pode-se criar um perfil CUDA separado. A decisão deve considerar também a latência do chat durante a ingestão.

## Docling stateless

O Docling não possui volume nem bind mount. Os modelos são parte da imagem e os resultados são devolvidos ao Open WebUI na mesma requisição. Ao recriar o container, somente arquivos temporários são perdidos.

Não monte um volume vazio sobre `/opt/app-root/src/.cache/docling/models`: ele ocultaria os modelos incorporados à imagem. Um volume de modelos só será necessário se uma futura imagem slim fizer download de artefatos em runtime.

## Agendamento e fila do Google Drive

Cada vínculo entre pastas e Knowledge Base possui:

- expressão cron de cinco campos;
- fuso IANA, como `America/Maceio`;
- estado ativo ou pausado;
- histórico e próxima execução.

O padrão é:

```cron
30 * * * *
```

O worker verifica agendas a cada 30 segundos, mas usa os slots do cron. Se estiver indisponível no instante exato, executa o último slot pendente ao voltar. Um slot persistido não é executado duas vezes.

Todas as Knowledge Bases compartilham uma fila com concorrência global `1`. Vínculos vencidos são processados sequencialmente para limitar CPU, RAM e pressão sobre o Open WebUI. A ação **Sincronizar agora** entra na mesma fila.

Estados antigos com `intervalMinutes` são migrados automaticamente. O intervalo legado de 60 minutos vira `30 * * * *`.

## Persistência e backup

| Dado | Local |
| --- | --- |
| Estado administrativo e segredos | `data/` |
| Estado e manifesto do Drive | `data/knowledge-sync/state.json` |
| Clones dos repositórios | `repositories/` |
| Índices do Codebase Memory | `cache/` |
| Chats, arquivos, chunks e vetores | volume `openwebui-data` |
| Modelos Ollama em Docker | volume `ollama-data` |
| Modelos Ollama no macOS host | `~/.ollama` |
| Modelos Docling | imagem Docker, sem volume |

O backup mínimo deve incluir `data/`, `cache/`, `repositories/` quando os clones precisarem ser preservados, e os volumes do Open WebUI e Ollama. A chave `data/secrets/mcp-workspace-encryption-key` é indispensável para revelar tokens restaurados.

## Segurança operacional

- Não exponha Ollama, Docling ou `knowledge-sync` diretamente à rede pública.
- Publique o proxy atrás de HTTPS, VPN ou rede corporativa.
- Use tokens MCP individuais quando o acesso não puder abranger todo o workspace.
- Restrinja a Service Account do Drive a leitura das pastas necessárias.
- Mantenha `data/`, `.env` e credenciais fora do Git.
- Monitore RAM, VRAM, tempo dos lotes e latência do chat antes de aumentar workers ou batches.

## Referências oficiais

- [Docling Serve: imagens de container](https://github.com/docling-project/docling-serve#container-images)
- [Docling Serve: configuração](https://github.com/docling-project/docling-serve/blob/main/docs/configuration.md)
- [Docling Serve: implantação](https://github.com/docling-project/docling-serve/blob/main/docs/deployment.md)
- [Open WebUI](https://docs.openwebui.com/)
