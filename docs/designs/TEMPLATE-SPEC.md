# Design Specification: [Nome da Feature / Alteração]

**Identificador**: `[TASK-ID-AQUI]`  
**Status**: `DRAFT` | `IN_REVIEW` | `APPROVED` | `IMPLEMENTED`  
**Autor (Elephant)**: `[Nome ou Agente]`  
**Data**: `[YYYY-MM-DD]`  
**Base Git Commit**: `[Hash do commit atual no git rev-parse HEAD]`  
**Tier Recomendado pelo Router**: `LOCAL` | `LUNA` | `TERRA` | `SOL`  

---

## 1. Objetivo e Escopo de Negócio
- **Problema**: Descreva claramente o problema atual ou a necessidade de negócio.
- **Resultado Esperado**: O que o sistema deve fazer após esta implementação.
- **Exclusões Explícitas**: O que **NÃO** faz parte desta tarefa (evita desvio de escopo).

---

## 2. Evidências Técnicas (Codebase Memory MCP)
*Registros colhidos pelo Elefante utilizando ferramentas de grafo antes de planejar.*

- **Projeto(s) MCP**: `claps` / `pagueon` / `claps-front` / `pagueon-front`
- **Símbolos e Arquivos Identificados**:
  - `NomeDaClasse.cs` / `nome-do-servico.ts`
  - Rotas de API afetadas: `POST /api/v1/...`
- **Fluxo de Chamadas (Trace Path)**:
  - `Controller` ➔ `Service` ➔ `Repository` ➔ `Database/External API`

---

## 3. Lista Rígida de Arquivos Afetados (Task Envelope Scope)
*Esta lista alimenta diretamente o `scripts/task-scope-guard.mjs`. NENHUM outro arquivo poderá ser alterado.*

| Caminho do Arquivo (Relativo à Raiz) | Papel (`role`) | Responsável / Dono | Descrição da Mudança |
| :--- | :--- | :--- | :--- |
| `caminho/para/arquivo1.cs` | `implementation` | `backend` | Adiciona validação de payload |
| `caminho/para/IContratoService.cs` | `contract` | `backend` | Adiciona assinatura do novo método |
| `caminho/para/arquivo1.test.cs` | `test` | `qa` | Cobre casos de sucesso e erro |

---

## 4. Detalhamento da Solução Técnica
- **Contratos e DTOs**: Assinatura das requisições e respostas.
- **Regras de Negócio**: Lógica específica passo a passo.
- **Persistência / Banco de Dados**: Alterações em entidades, índices ou migrações (se houver).

---

## 5. Casos de Borda (*Edge Cases*) e Tratamento de Erros
- [ ] O que acontece se o payload vier nulo ou com campos ausentes?
- [ ] Como o sistema reage se a API externa ou banco estiver fora do ar (timeout/retry)?
- [ ] Existe concorrência (ex: duas requisições simultâneas para o mesmo ID)?
- [ ] Como o rollback é tratado em caso de falha no meio do processo?

---

## 6. Riscos, Segurança e Conformidade
- **Segurança**: Validação de autorização/token JWT, injeção de parâmetros, exposição de dados sensíveis.
- **Conformidade Regulatória**: SUSEP / LGPD / Políticas de Cartão / Conciliação.
- **Risco de Quebra de Contrato**: Alteração compatível retroativamente (*backward-compatible*)?

---

## 7. Estratégia de Testes e Validação
- **Comandos de Teste**:
  - `dotnet test ...` ou `npm test ...`
- **Cobertura Mínima Exigida**: Testes unitários para lógica pura e testes de integração para o fluxo completo.

---

## 8. Critérios de Aceite Mensuráveis
- [ ] **Critério 1**: [Condição clara e testável]
- [ ] **Critério 2**: [Condição clara e testável]
- [ ] **Critério 3**: [Build e suíte de testes passando sem erros]

---

## 9. Registro de Revisão Adversarial (Goldfish Review Log)
*Preenchido automaticamente ou via `node scripts/egm-review.mjs` pelo revisor de zero-contexto.*

- **Veredito**: `PENDING` | `APPROVED` | `NEEDS_REVISION`
- **Revisor**: `Goldfish (Local GPU Qwen 2.5 Coder 14B)`
- **Data da Revisão**: `[Data]`
- **Pontos Críticos / Observações**:
  - [Notas do revisor de contexto zero]
