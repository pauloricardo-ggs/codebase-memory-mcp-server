---
name: ub-mode
description: >
  Uncle Bob Mode (Clean Code & Deterministic Quality Gates). Enforce strict TDD,
  CRAP score < 10, AST duplication < 0.82, and mutation testing using local Python quality tools.
  Use when the user runs /ub-mode or asks for Uncle Bob clean code discipline.
---

# ub-mode: Clean Code & Quality Gates (Uncle Bob Standard)

O `ub-mode` impõe rigor de engenharia de software e qualidade matemática no código produzido por agentes de IA ou desenvolvedores. Cada alteração segue rigorosamente três etapas:

1. **First, Make it Work** (Faça Funcionar com TDD e Parcimônia)
2. **Then, Make it Right** (Faça Direito com Quality Gates Determinísticos)
3. **Follow Practice** (Disciplina Operacional e Rituais)

---

## 1. First, Make it Work

### Laziness Protocol & Subtração
* **Uma decisão vive em um único lugar**: Evite replicação de regras ou constantes espalhadas.
* **Subtraia antes de adicionar**: Remova complexidade desnecessária antes de introduzir novas camadas.
* **Envie o menor diff possível**: Resolva cirurgicamente a necessidade sem inflar o código.

### TDD Estrito
* **Escreva o teste antes do código**: Veja o teste falhar pelo motivo esperado.
* **Faça a menor mudança para fazê-lo passar**: Não adicione funcionalidades não exigidas pelo teste.
* **Se um teste passaria mesmo que a função retornasse nulo ou vazio, descarte-o**.

### Modelagem do Domínio & Tratamento de Erros
* Torne estados ilegais impossíveis na própria tipagem das classes antes de escrever a lógica.
* **Causa-raiz**: Uma trava com `if (x != null)` que apenas esconde um crash **não é um fix**; trate a origem do dado.

---

## 2. Then, Make it Right (Quality Gates Locais)

Após o código funcionar e passar nos testes, ele é submetido à validação determinística pelas ferramentas locais em `tools/quality_gates/`:

### 2.1 Crapper (CRAP Score < 10.0)
Mede a complexidade ciclomática e a cobertura de testes:
$$\text{CRAP} = CC^2 \times (1 - \text{coverage})^3 + CC$$

```bash
# Executa a auditoria de complexidade e CRAP score
python3 tools/quality_gates/crapper.py <caminho_ou_arquivo> --threshold 10.0
```
- **Regra:** Nenhuma função ou método pode ser aprovada com $\text{CRAP} \ge 10.0$. Reduza quebrando em métodos puros ou aumentando a cobertura de testes.

### 2.2 Dryer (Similaridade Estrutural AST < 0.82)
Analisa a AST e tokens estruturais normalizados para encontrar duplicações:
$$\text{Similaridade Jaccard} = \frac{\text{Fingerprints Compartilhados}}{\text{Total de Fingerprints}}$$

```bash
# Executa a detecção de código duplicado
python3 tools/quality_gates/dryer.py <caminho_ou_pasta> --threshold 0.82
```
- **Regra:** Pares com similaridade $\ge 0.82$ devem ser unificados (ex: extração para o pacote corporativo `Ma9DevPack`).

### 2.3 Mutator (Mutation Testing)
Aplica mutações propositais no código (troca de operadores de borda, negação booleana) para provar que a suíte de testes realmente detecta falhas:

```bash
# Roda análise de mutantes
python3 tools/quality_gates/mutator.py <arquivo> [--test-cmd "dotnet test"]
```
- **Regra:** Testes cegos cujos mutantes sobrevivem devem ser reforçados até matar as mutações.

---

## 3. Validação Unificada (Quality Gate Runner)

Para verificar todos os portões de uma só vez antes de criar um commit:

```bash
python3 tools/quality_gates/verify_quality.py <caminho_do_modulo>
```

Se o runner retornar código `0`, o código está formalmente aprovado para commit e merge.

---

## 4. Follow Practice (Rituais)

* **Guarde a Janela de Contexto**: Mantenha o chat principal enxuto, externalizando relatórios pesados para arquivos.
* **Commits Atômicos e Explicativos**: Cada commit deve responder: *o que mudou*, *por que mudou* e *como foi comprovado* pelos testes.
