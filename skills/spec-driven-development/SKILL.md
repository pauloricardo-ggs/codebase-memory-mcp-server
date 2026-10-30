---
name: spec-driven-development
description: Spec-Driven Development 2.0 (Elephant-Goldfish Model / EGM). Enforce persistent architectural design specifications, zero-context adversarial reviews via local GPU, prompt caching optimization, and task scope guards before any code is generated.
---

# Spec-Driven Development 2.0 (Elephant-Goldfish Model — EGM)

O **Spec-Driven Development (SDD 2.0)** substitui o "Plan Mode" tradicional por um fluxo estruturado e à prova de viés cognitivo.

> [!IMPORTANT]
> **Por que o Plan Mode não basta?**
> No Plan Mode convencional, a mesma sessão de IA que gera a ideia a avalia e a executa. Ela carrega seus próprios pontos cegos e alucinações de contexto. O plano evapora assim que a conversa cresce.
> **Com o EGM**: O planejamento gera uma especificação versionada em Markdown (`docs/designs/*.md`), que é criticada impiedosamente por um revisor de **zero contexto** antes de qualquer código ser escrito.

---

## 1. Os Três Papéis do Ciclo EGM

```
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│     1. O ELEFANTE       │      │   2. O PEIXE DOURADO    │      │    3. IMPLEMENTADOR     │
│   (Contexto Profundo)   │─────▶│     (Zero Contexto)     │─────▶│     (Escopo Rígido)     │
│   MCP Codebase Memory   │      │  GPU Local (Custo $0)   │      │   gpt-6.1-terra (med)   │
│   "Nenhum código aqui"  │      │  "Crítica Adversarial"  │      │   + Task Scope Guard    │
└─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

### 1.1 O Elefante (Architect & Historian)
- **Objetivo**: Conduzir o brainstorming técnico e gerar o documento de especificação.
- **Regra de Ouro**: **Nenhuma linha de código de produção é escrita nesta fase.**
- **Ferramental**: Utiliza as ferramentas do **MCP Codebase Memory**:
  - `get_architecture` para visualizar camadas e limites de projeto.
  - `search_graph` e `trace_path` para mapear dependências reais entre chamadores e chamados.
  - `get_code_snippet` para confirmar assinaturas de métodos existentes.
- **Entrega**: Grava a especificação em [`docs/designs/<feature-name>.md`](file:///home/ma9/codebase-memory-mcp-server/docs/designs/) baseada no template oficial [`docs/designs/TEMPLATE-SPEC.md`](file:///home/ma9/codebase-memory-mcp-server/docs/designs/TEMPLATE-SPEC.md).

### 1.2 O Peixinho Dourado / Goldfish (Adversarial Multi-Lens Swarm)
- **Objetivo**: Ler **apenas** a especificação Markdown, sem nenhuma memória da conversa de brainstorming.
- **Por que zero contexto?**: Sem a conversa prévia, o Goldfish não foi "convencido" das premissas implícitas do desenvolvedor. Ele avalia se a especificação é compreensível e completa por si só.
- **Execução**: Roda na GPU dedicada local (**RTX 5060 Ti**) no modelo **`qwen2.5-coder:14b-instruct-q4_0`** com **custo $0.00 de tokens**.
- **Comando (Enxame Multi-Lente EGM 2.0)**:
  ```bash
  # Executa o enxame de 4 lentes em paralelo (Edge Cases, Contratos, Segurança SUSEP e Escopo)
  node scripts/egm-review.mjs --spec docs/designs/<feature-name>.md --swarm
  ```
- **As Quatro Lentes do Enxame**:
  1. *Lente 1 (Edge Cases & Concorrência - Peso 30%)*: Deadlocks, race conditions, timeouts, limites de lista.
  2. *Lente 2 (Contratos & gRPC - Peso 25%)*: Quebra de compatibilidade de APIs e schemas.
  3. *Lente 3 (Segurança & SUSEP/LGPD - Peso 25%)*: Falhas de autorização, trilhas de auditoria, conformidade.
  4. *Lente 4 (Escopo Rígido & Viabilidade - Peso 20%)*: Validação dos arquivos do envelope e testabilidade.
- **Saída**: Pontuação de consenso ponderada (0 a 100) e veredito (`APPROVED`, `NEEDS_REVISION` ou `REJECTED`). Se reprovado, o Elefante ajusta a especificação antes de prosseguir.

### 1.3 O Implementador (Execution & Scope Guard)
- **Objetivo**: Escrever o código estritamente dentro dos arquivos e regras aprovadas na spec.
- **Tier do Router**: Roteado pelo [`skills/cognitive-model-router/router.mjs`](file:///home/ma9/codebase-memory-mcp-server/skills/cognitive-model-router/router.mjs) (geralmente **`gpt-6.1-terra`** com `reasoning_effort: "medium"` para código multi-arquivo).
- **Prompt Caching Otimizado**: A especificação aprovada entra como o primeiro bloco de contexto estável, recebendo **95% de desconto** no custo de entrada ($0.05 por 1M de tokens).
- **Proteção Rígida de Escopo**:
  1. O Goldfish exporta o envelope de escopo:
     ```bash
     node scripts/egm-review.mjs --spec docs/designs/<feature-name>.md --export-envelope task-envelope.json
     ```
  2. Antes da edição, o snapshot é registrado:
     ```bash
     node scripts/task-scope-guard.mjs snapshot --task-id <id> --envelope task-envelope.json
     ```
  3. Após a implementação, os arquivos modificados são auditados:
     ```bash
     node scripts/task-scope-guard.mjs verify --task-id <id> --envelope task-envelope.json
     ```
  Se o agente tiver alterado qualquer arquivo fora do envelope aprovado na spec, o commit é bloqueado.

---

## 2. Passo a Passo do Fluxo Operacional

```bash
# Passo 1: O Elefante cria a spec a partir do template
cp docs/designs/TEMPLATE-SPEC.md docs/designs/minha-feature.md
# (Edição da spec com auxílio das ferramentas do MCP Codebase Memory)

# Passo 2: O Enxame Goldfish revisa com zero contexto na GPU local (sem gastar tokens de nuvem)
node scripts/egm-review.mjs --spec docs/designs/minha-feature.md --swarm --export-envelope envelope.json

# Passo 3: Se aprovado (score >= 85), tira o snapshot de escopo
node scripts/task-scope-guard.mjs snapshot --task-id minha-feature --envelope envelope.json

# Passo 4: Executa a implementação via cognitive router (Terra / Sol / Local)

# Passo 5: Roda os Quality Gates do Uncle Bob (CRAP < 10 e DRY < 0.82)
python3 tools/quality_gates/verify_quality.py caminho/do/modulo

# Passo 6: Verifica integridade de escopo e suíte de testes
node scripts/task-scope-guard.mjs verify --task-id minha-feature --envelope envelope.json
npm test --if-present || dotnet test
```

---

## 3. Benefícios Consolidados

1. **Zero Retrabalho**: Ambigüidades e edge cases são eliminados na fase de texto antes de virarem bugs distribuídos no código.
2. **Custo Mínimo**:
   - A fase crítica (Goldfish) roda 100% gratuita na GPU local.
   - A fase de implementação aproveita o Prompt Caching com a spec imutável no topo.
3. **Imunidade a Alucinação**: O Elefante consulta o grafo real de código via MCP, e o Scope Guard impede contaminação em outros arquivos do repositório.
