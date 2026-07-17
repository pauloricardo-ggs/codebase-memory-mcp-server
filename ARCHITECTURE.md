# Arquitetura e operação técnica

Este documento descreve os serviços, fluxos de dados, persistência e decisões operacionais do ambiente.

## Visão dos serviços

```text
Navegador ──► Nginx ──┬──► /          Open WebUI
                      ├──► /admin/    painel administrativo
                      └──► /grafana/  Grafana

Clientes MCP ──► Nginx /mcp ──► AgentGateway ──► Codebase Memory MCP
                                      │
                                      └── controle de tokens e projetos permitidos

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
| `proxy` | Único ponto de entrada; publica Open WebUI, painel, Grafana e MCP. |
| `agentgateway` | Encaminha chamadas MCP e aplica as credenciais configuradas. |
| `admin` | Gerencia workspaces, repositórios, usuários MCP e integração do Drive. |
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

Depois da primeira varredura completa, o worker persiste um token da Google Drive Changes API. Execuções seguintes consultam mudanças primeiro e encerram sem percorrer a árvore quando nenhuma alteração afeta pastas ou arquivos conhecidos. Alterações relevantes disparam uma reconciliação completa. Uma reconciliação de segurança também ocorre periodicamente, por padrão a cada 168 horas.

Falhas de download ou ingestão são isoladas por arquivo. O manifesto registra estado, erro, tentativa, sucesso e duração, permitindo repetir somente o documento afetado pelo painel. Erros 429 e 5xx do Drive e do Open WebUI usam retry com backoff exponencial.

Todas as Knowledge Bases compartilham uma fila com concorrência global `1`. Vínculos vencidos são processados sequencialmente para limitar CPU, RAM e pressão sobre o Open WebUI. A ação **Sincronizar agora** entra na mesma fila.

Estados antigos com `intervalMinutes` são migrados automaticamente. O intervalo legado de 60 minutos vira `30 * * * *`.

## Persistência e backup

| Dado | Local |
| --- | --- |
| Estado administrativo e segredos | `data/` |
| Histórico de operações do painel (7 dias) | `data/jobs.json` |
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
- Mantenha somente a porta do proxy publicada pelo Docker.
- Publique o proxy atrás de HTTPS, VPN ou rede corporativa.
- Use tokens MCP individuais quando o acesso não puder abranger todo o workspace.
- Restrinja a Service Account do Drive a leitura das pastas necessárias.
- Mantenha `data/`, `.env` e credenciais fora do Git.
- Monitore RAM, VRAM, tempo dos lotes e latência do chat antes de aumentar workers ou batches.

## Observabilidade

O `admin` expõe liveness em `/api/health/live`, readiness agregado em `/api/health/ready`, detalhes em `/api/health/detail` e métricas Prometheus em `/api/metrics`. O worker expõe `/health/live`, `/health/ready` e `/metrics` na rede interna.

O instalador habilita o profile Compose `monitoring`, que inicia Prometheus e Grafana junto com os demais serviços. Em instalações manuais, use:

```bash
docker compose --profile monitoring up -d prometheus grafana
```

Prometheus permanece exclusivamente na rede Docker e não possui rota no proxy. O Grafana é publicado em `/grafana/`, utiliza seu login próprio e tem o dashboard operacional incorporado na área **Observabilidade** do painel administrativo. O proxy restringe o embedding à mesma origem com `frame-ancestors 'self'`. Em produção, a infraestrutura externa deve terminar HTTPS e restringir a origem aos IPs corporativos.

As métricas não usam perguntas, nomes de arquivo ou usuário como labels. Logs operacionais são JSON e utilizam IDs de operação, sem conteúdo documental ou credenciais.

O Grafana provisiona automaticamente o datasource Prometheus e o dashboard versionado **Codebase Memory — Operação**. O dashboard provisionado não é editável; dashboards adicionais criados pelo usuário são preservados no volume `grafana-data`.

## Referências oficiais

- [Docling Serve: imagens de container](https://github.com/docling-project/docling-serve#container-images)
- [Docling Serve: configuração](https://github.com/docling-project/docling-serve/blob/main/docs/configuration.md)
- [Docling Serve: implantação](https://github.com/docling-project/docling-serve/blob/main/docs/deployment.md)
- [Open WebUI](https://docs.openwebui.com/)
