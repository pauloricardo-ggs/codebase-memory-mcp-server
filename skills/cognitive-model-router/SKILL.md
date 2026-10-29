---
name: cognitive-model-router
description: Dynamic, granular cognitive routing between Local GPU (Qwen 2.5 Coder 14B), Luna, Terra, and Sol tiers (GPT-6 / GPT-6.1 generation) maximizing local zero-cost offload, prompt caching, and fine-tuning reasoning effort based on benchmark requirements.
---

# Cognitive Model Router (Local GPU / Luna / Terra / Sol)

O **Cognitive Model Router** é a especificação e motor de decisão para alocação eficiente de inteligência artificial em fluxos de engenharia de software da organização. Ele implementa o princípio da **parcimônia cognitiva radical**:
1. **Tier Local Zero Custo**: Descarrega ~80% das tarefas cotidianas diretamente na GPU dedicada local (**NVIDIA RTX 5060 Ti** rodando **`qwen2.5-coder:14b-instruct-q4_0`** a ~95 tokens/s e ~48ms de latência), com **zero custo de tokens**.
2. **Qualidade Intacta**: Mantém a paridade técnica através de modelos de raciocínio avançado (**Terra** e **Sol**) apenas quando a complexidade de múltiplos arquivos ou risco sistêmico justifica.
3. **Prompt Caching de Alta Eficiência**: Aplica correspondência de prefixo estático (*Exact Prefix Match*) com até **95% de desconto** nas chamadas externas.
4. **Teto Rigoroso**: O modelo `gpt-6-astra` é **deliberadamente excluído** devido ao custo abusivo. O teto máximo absoluto é o **`gpt-6.1-sol`**.

---

## 1. Arquitetura dos Quatro Tiers

```
                    ┌──────────────────────────────────────────────┐
                    │            Cognitive Router Engine           │
                    │         (Instant Heuristics < 1ms)           │
                    │        (Fallback: Local Ollama JSON)         │
                    └───────┬──────────────┬──────────────┬────────┘
                            │              │              │
             ~80% do volume │  ~10% volume │  ~2% volume  │ (Teto Absoluto)
                            ▼              ▼              ▼
                     ┌─────────────┐┌─────────────┐┌─────────────┐
                     │  LOCAL GPU  ││    TERRA    ││     SOL     │
                     │ qwen-14b /  ││gpt-6.1-terra││ gpt-6.1-sol │
                     │ gpt-6-luna  ││             ││             │
                     │ none | low  ││ low | medium││medium | high│
                     └─────────────┘└─────────────┘└─────────────┘
```

### Tabela Comparativa de Tiers e Custos

| Tier | Provedor / Hardware | Modelo | Reasoning Effort | Custo Input (1M) | Custo Output (1M) | Contexto |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Local GPU** | **RTX 5060 Ti (Local)** | **`qwen2.5-coder:14b-instruct-q4_0`** | `none` \| `low` | **$0.00** *(Zero)* | **$0.00** *(Zero)* | 32k |
| **Luna** *(Fallback)* | OpenAI API | **`gpt-6-luna`** | `none` \| `low` | $0.10 *(Cache: $0.01)* | $0.50 | 1.05M |
| **Terra** | OpenAI API | **`gpt-6.1-terra`** | `low` \| `medium` | $1.00 *(Cache: $0.05)* | $5.00 | 1.05M |
| **Sol** *(Teto)* | OpenAI API | **`gpt-6.1-sol`** | `medium` \| `high` | $2.00 *(Cache: $0.10)* | $10.00 | 1.05M |

---

## 2. Matriz Granular de Roteamento

### 2.1 Tier Local GPU (`qwen2.5-coder:14b-instruct-q4_0`) — ~80% do Volume
O modelo local roda carregado na VRAM da GPU sem latência de inicialização de disco:
- **`reasoning_effort: "none"`** (Zero reflexão, resposta imediata):
  - Formatação e linting (Prettier, ESLint, organização de imports).
  - Documentação, README, docstrings, comentários inline e changelogs.
  - Comandos operacionais de terminal, builds, `git status`, bumps em `package.json`.
  - Edições pontuais mono-arquivo (renomeação de variáveis, ajuste de constantes, troca de URLs).
- **`reasoning_effort: "low"`** (Prevenção de edge cases):
  - Bugfixes cirúrgicos mono-arquivo envolvendo lógica condicional (`null/undefined` check, limites de array).
  - Criação de testes unitários isolados com mocks simples para funções puras.
- **Fallback Automático para Luna (`gpt-6-luna`)**:
  - Ativado se o contexto de entrada exceder 32.768 tokens ou se a flag `--force-cloud` for passada.

### 2.2 Tier Terra (`gpt-6.1-terra`) — ~10% do Volume
- **`reasoning_effort: "low"`**:
  - **Code Review de Pull Requests**: Validação detalhada de diffs contra regras de negócio e estilo sem regravação de código. Economiza 70% de tokens de saída.
- **`reasoning_effort: "medium"`** *(Ponto de Ouro no Benchmark SWE-bench)*:
  - Implementação de novas funcionalidades distribuídas entre múltiplos arquivos (Controller + Service + Repositório + DTOs).
  - Refatoração estrutural moderada e desacoplamento de classes.
  - Suítes de testes de integração e E2E multi-componente.
  - Depuração de problemas de negócio inter-módulos.

### 2.3 Tier Sol (`gpt-6.1-sol`) — ~2% do Volume (Teto Máximo)
- **`reasoning_effort: "medium"`**:
  - Redesenho de arquitetura de mensageria assíncrona, microsserviços, CQRS, padronização de SDKs.
- **`reasoning_effort: "high"`** (Análise formal profunda):
  - **Concorrência e Paralelismo**: Deadlocks, race conditions, contenção de mutexes, locks distribuídos e transações paralelas.
  - **Cibersegurança e Criptografia**: Mitigação de vulnerabilidades (CVEs, SQL Injection, bypass de autenticação JWT/OAuth, infraestrutura Zero-Trust e conformidade regulatória SUSEP/LGPD).
  - **Migrações Destrutivas**: Alterações irreversíveis de schema de banco de dados em tabelas de alto volume ou dados financeiros, com risco iminente de perda de dados.
  - **Quebra de Contratos Públicos**: Mudanças de breaking changes em APIs públicas de parceiros e sistemas legados.

---

## 3. Diretriz de Prompt Caching (Até 95% de Desconto na Nuvem)

Quando a requisição for para Terra ou Sol (ou fallback Luna), o prompt **deve** seguir a ordenação estrita de blocos estáveis no início para acionar o cache da OpenAI:

```
┌────────────────────────────────────────────────────────┐
│ 1. BLOCO ESTÁTICO (Nunca muda - 100% Cache Hit)         │
│    - System instructions e personas                     │
│    - Declarações de ferramentas MCP e contratos JSON   │
│    - Regras gerais de arquitetura da empresa           │
├────────────────────────────────────────────────────────┤
│ 2. BLOCO SEMI-ESTÁTICO (Raras mudanças - 90% Cache Hit) │
│    - Código-fonte de arquivos de contexto estáveis      │
│    - Schemas de banco e tabelas de referência          │
├────────────────────────────────────────────────────────┤
│ 3. BLOCO DINÂMICO (Volátil - Sem Cache - No Final)     │
│    - Pedido/query do usuário                           │
│    - Diffs do momento, IDs transitórios e erros        │
└────────────────────────────────────────────────────────┘
```

> [!WARNING]
> Nunca posicione timestamps, variáveis de data corrente ou identificadores aleatórios no topo do prompt de sistema. Qualquer alteração no primeiro byte invalida o cache do prefixo.

---

## 4. Como Executar o Roteador

O script está disponível no repositório em [`router.mjs`](file:///home/ma9/codebase-memory-mcp-server/skills/cognitive-model-router/router.mjs).

```bash
# Roteamento padrão (prioriza GPU local quando adequado)
node skills/cognitive-model-router/router.mjs "Ajustar tipagem do retorno na função formatCurrency"

# Forçar modelo na nuvem (bypassa GPU local)
node skills/cognitive-model-router/router.mjs --force-cloud "Ajustar tipagem do retorno"

# Roteamento para feature multi-arquivo (vai para Terra com medium reasoning)
node skills/cognitive-model-router/router.mjs "Implementar feature multi-file de conciliação financeira"

# Roteamento para concorrência crítica (vai para Sol com high reasoning)
node skills/cognitive-model-router/router.mjs "Investigar deadlock em transações concorrentes de pagamento"
```
