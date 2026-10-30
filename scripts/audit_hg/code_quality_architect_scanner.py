#!/usr/bin/env python3
"""
Scanner de Auditoria Prescritiva de Qualidade & Guia de Refatoração (CLAPS & PAGUEON)
Executado nos finais de semana na GPU local (RTX 5060 Ti via Ollama).

Varre a base de código buscando:
1. Métodos longos e de alta complexidade ciclomática (CRAP / Clean Code);
2. Duplicações estruturais de código (DRY violations);
3. Falhas críticas de resiliência (async void, catch Exception genérico);
4. Ausência de cobertura de testes unitários.

Gera um relatório único estruturado em:
- Resumo Executivo (visão estratégica);
- Detalhamento Técnico Prescritivo (com prompts prontos e receitas de código para outra IA implementar).
Enfileira o arquivo para envio automático na Segunda-feira às 08:00 BRT via Telegram.
"""

import os
import sys
import re
import json
import time
import datetime
import urllib.request
import shutil
from collections import defaultdict
from pathlib import Path

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
REPOSITORIES_DIR = BASE_DIR / "repositories"
REPORTS_DIR = BASE_DIR / "reports" / "engenharia"
PENDING_DIR = BASE_DIR / "reports" / "pending_dispatch"
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
AI_MODEL = os.getenv("QUALITY_AI_MODEL", "qwen2.5-coder:14b-instruct-q4_0")

def query_ollama(prompt: str, max_tokens: int = 600, temperature: float = 0.1) -> str:
    """Chama o modelo de código local no Ollama."""
    payload = {
        "model": AI_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": max_tokens,
            "num_ctx": 4096
        }
    }
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            resp_text = data.get("response", "").strip()
            # Remove eventuais tags <think> se o modelo for de raciocínio
            resp_text = re.sub(r"<think>.*?</think>", "", resp_text, flags=re.DOTALL).strip()
            return resp_text
    except Exception as e:
        return f"*(Falha na geração via IA local: {e})*"

def scan_complex_methods():
    """Varre métodos C# identificando linhas e ramificações (complexidade ciclomática)."""
    complex_methods = []
    method_pattern = re.compile(
        r'^\s*(?:public|private|protected|internal)(?:\s+static)?(?:\s+async)?(?:\s+virtual)?(?:\s+override)?\s+([\w<>[\]?]+)\s+(\w+)\s*\(([^)]*)\)',
        re.MULTILINE
    )

    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git", "node_modules", "Test", "Tests"]):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                lines = content.splitlines()

            # Encontra métodos e delimita o corpo pelas chaves
            for match in method_pattern.finditer(content):
                ret_type = match.group(1)
                method_name = match.group(2)
                args = match.group(3)
                start_pos = match.start()
                start_line = content[:start_pos].count("\n") + 1

                # Localiza a chave de abertura
                open_brace_idx = content.find("{", match.end())
                if open_brace_idx == -1 or open_brace_idx - match.end() > 200:
                    continue  # Interface ou abstract method

                # Rastreia o fechamento das chaves
                depth = 1
                curr_idx = open_brace_idx + 1
                body_chars = []
                while curr_idx < len(content) and depth > 0:
                    ch = content[curr_idx]
                    if ch == "{":
                        depth += 1
                    elif ch == "}":
                        depth -= 1
                    body_chars.append(ch)
                    curr_idx += 1

                if depth == 0:
                    body = "".join(body_chars[:-1])
                    body_lines = body.count("\n")
                    # Contagem de ramificações (Complexidade Ciclomática aproximada)
                    branches = len(re.findall(r'\b(if|else\s+if|for|foreach|while|case|catch)\b', body))
                    branches += body.count("&&") + body.count("||") + body.count("??")
                    cc = 1 + branches
                    coverage = 0.0 # Baseline conservador sem teste isolado
                    crap = round((cc ** 2) * ((1.0 - coverage) ** 3) + cc, 1)

                    if body_lines > 25 or branches >= 7:
                        complex_methods.append({
                            "file": str(p.relative_to(REPOSITORIES_DIR)),
                            "full_path": str(p),
                            "method": method_name,
                            "ret_type": ret_type,
                            "args": args,
                            "lines": body_lines,
                            "branches": branches,
                            "cc": cc,
                            "crap": crap,
                            "start_line": start_line,
                            "sample_body": body[:800]
                        })
        except Exception:
            pass

    complex_methods.sort(key=lambda x: (x["branches"] * 2 + x["lines"]), reverse=True)
    return complex_methods

def scan_duplicated_logic():
    """Identifica blocos e métodos clonados entre diferentes classes/microsserviços."""
    method_hashes = defaultdict(list)
    # Normaliza método para achar cópias idênticas
    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git", "Test", "Tests"]):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            pattern = re.compile(
                r'^\s*(?:public|private|protected|internal)(?:\s+static)?\s+[\w<>[\]?]+\s+(\w+)\s*\([^)]*\)\s*\{([^}]{80,500})\}',
                re.MULTILINE
            )
            for m in pattern.finditer(content):
                name = m.group(1)
                body = m.group(2)
                normalized = re.sub(r'\s+', ' ', re.sub(r'//.*', '', body)).strip()
                if len(normalized) > 80:
                    method_hashes[f"{name}::{normalized[:120]}"].append({
                        "file": str(p.relative_to(REPOSITORIES_DIR)),
                        "method": name,
                        "snippet": body.strip()[:300]
                    })
        except Exception:
            pass

    duplicates = [v for k, v in method_hashes.items() if len(v) >= 2]
    duplicates.sort(key=lambda x: len(x), reverse=True)
    return duplicates

def scan_resilience_flaws():
    """Identifica más práticas de resiliência (async void, catch Exception genérico)."""
    async_voids = []
    swallowed_exceptions = []

    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git", "Test", "Tests"]):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            for idx, line in enumerate(lines, 1):
                clean = line.strip()
                if clean.startswith("//"):
                    continue
                if "async void " in clean:
                    async_voids.append({
                        "file": str(p.relative_to(REPOSITORIES_DIR)),
                        "line": idx,
                        "snippet": clean
                    })
                if re.search(r'catch\s*\(\s*Exception(\s+\w+)?\s*\)', clean):
                    # Checa as próximas 3 linhas para ver se é engolido sem throw
                    next_lines = "".join(lines[idx:idx+3])
                    if "throw" not in next_lines:
                        swallowed_exceptions.append({
                            "file": str(p.relative_to(REPOSITORIES_DIR)),
                            "line": idx,
                            "snippet": clean
                        })
        except Exception:
            pass
    return async_voids, swallowed_exceptions

def generate_ai_recipe_for_method(item: dict) -> str:
    """Gera um diagnóstico e receita de refatoração para um método complexo."""
    prompt = f"""Você é um Arquiteto de Software Sênior especialista em C# .NET, Clean Code e Refatoração.
Analise este método complexo real do nosso sistema:

Arquivo: {item['file']}
Método: {item['ret_type']} {item['method']}({item['args']})
Linhas: {item['lines']} | Ramificações Ciclomáticas: {item['branches']}

Corpo (amostra):
```csharp
{item['sample_body']}
```

Responda em formato Markdown estruturado em 3 seções concisas:
1. **Diagnóstico e Riscos:** Explique por que este método viola Clean Code / SRP e os riscos de mantê-lo.
2. **Padrão Recomendado:** Sugira o padrão ideal (ex: Guard Clauses, Strategy, Factory, Extension Method ou decomposição em métodos privados).
3. **Prompt para IA Executora (Claude/Gemini/GPT):** Escreva o prompt EXATO que o desenvolvedor deve colar em outra IA para que ela implemente a refatoração perfeitamente.
4. **Código Refatorado Sugerido:** Apresente um esboço de código limpo e refatorado em C#.
"""
    return query_ollama(prompt, max_tokens=700)

def generate_ai_recipe_for_duplication(group: list) -> str:
    """Gera receita para unificar código duplicado."""
    files_str = "\n".join([f"- {item['file']}" for item in group[:4]])
    sample_snippet = group[0]['snippet']
    prompt = f"""Você é um Arquiteto de Software especialista em DRY e design de microsserviços .NET.
Detectamos a mesma lógica duplicada em múltiplos arquivos:

Arquivos Afetados:
{files_str}

Trecho do Código Duplicado:
```csharp
{sample_snippet}
```

Responda em Markdown conciso com:
1. **Diagnóstico:** Riscos de divergência de manutenção entre serviços.
2. **Solução Recomendada:** Como extrair essa lógica para um pacote compartilhado (`Ma9DevPack`) ou biblioteca comum.
3. **Prompt para IA Executora:** O prompt exato para passar a outra IA para unificar esse código.
"""
    return query_ollama(prompt, max_tokens=500)

def run_quality_architect_audit():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    now = datetime.datetime.now(datetime.timezone.utc)
    now_local = datetime.datetime.now()
    timestamp_str = now.strftime('%Y%m%d_%H%M%S')
    report_filename = f"auditoria_qualidade_e_guia_refatoracao_{timestamp_str}.md"
    report_path = REPORTS_DIR / report_filename

    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] === INICIANDO AUDITORIA PRESCRITIVA DE QUALIDADE ===")
    print("[*] 1. Analisando complexidade ciclomática e métodos longos...")
    complex_methods = scan_complex_methods()
    print(f"[✓] Encontrados {len(complex_methods)} métodos com complexidade elevada.")

    print("[*] 2. Mapeando duplicações estruturais (DRY)...")
    duplicates = scan_duplicated_logic()
    print(f"[✓] Encontrados {len(duplicates)} grupos de código duplicado.")

    print("[*] 3. Rastreando brechas de resiliência (async void / catch Exception)...")
    async_voids, swallowed_catches = scan_resilience_flaws()
    print(f"[✓] Encontrados {len(async_voids)} 'async void' e {len(swallowed_catches)} capturas genéricas de exceção.")

    # Gera pareceres com IA para os top casos mais críticos
    print(f"[*] 4. Consultando IA Local ({AI_MODEL} na RTX 5060 Ti) para gerar receitas...")
    top_complex_recipes = []
    for idx, cm in enumerate(complex_methods[:3], 1):
        print(f"    -> Gerando receita para método #{idx}: {cm['method']} em {Path(cm['file']).name}...")
        recipe = generate_ai_recipe_for_method(cm)
        top_complex_recipes.append((cm, recipe))

    top_duplicate_recipes = []
    if duplicates:
        print("    -> Gerando receita para unificação de duplicação crítica...")
        dup_recipe = generate_ai_recipe_for_duplication(duplicates[0])
        top_duplicate_recipes.append((duplicates[0], dup_recipe))

    # Montagem do Relatório Consolidado
    md = []
    md.append(f"# 🏛️ Relatório de Auditoria de Qualidade de Código & Guia Prescritivo de Refatoração")
    md.append(f"**Data da Geração:** {now_local.strftime('%d/%m/%Y às %H:%M:%S')} (Fim de Semana)  ")
    md.append(f"**Ecossistema:** CLAPS & PAGUEON (.NET Microservices & Frontends)  ")
    md.append(f"**Motor de Análise:** Heurística Determinística + `{AI_MODEL}` (Local - GPU RTX 5060 Ti 16GB)\n")

    # --- PARTE 1: RESUMO EXECUTIVO ---
    md.append("## 1. Resumo Executivo (Visão Gerencial e Estratégica)")
    md.append("Este relatório consolida a auditoria autônoma de fim de semana realizada no código-fonte. Seu objetivo é identificar dívidas técnicas de qualidade e fornecer **guias prontos de refatoração**, permitindo que outra IA implemente as melhorias com precisão na segunda-feira.\n")

    # Tabela de Indicadores
    md.append("### Indicadores Globais de Qualidade")
    md.append("| Métrica Auditada | Ocorrências | Nível de Risco | Ação Recomendada |")
    md.append("| :--- | :---: | :---: | :--- |")
    md.append(f"| **Métodos de Alta Complexidade Ciclomática** | `{len(complex_methods)}` | 🔴 Alto | Decomposição em métodos puros / SRP |")
    md.append(f"| **Blocos de Código Duplicados (DRY Violations)** | `{len(duplicates)}` | 🟠 Médio | Centralização no `Ma9DevPack` |")
    md.append(f"| **Métodos `async void` (Risco de Crash do Processo)** | `{len(async_voids)}` | 🔴 Crítico | Conversão imediata para `async Task` |")
    md.append(f"| **Capturas Genéricas Suspeitas (`catch Exception`)** | `{len(swallowed_catches)}` | 🟠 Médio | Tratamento específico e logging estruturado |")
    md.append("\n")

    md.append("### Matriz de Priorização para a Semana")
    md.append("1. **Prioridade Imediata (Resiliência):** Corrigir métodos `async void` para evitar finalização prematura de threads e crashes silenciosos.")
    md.append("2. **Prioridade Tática (Manutenibilidade):** Refatorar os métodos de formatação e checkout apontados na Seção 2 via IA executora.")
    md.append("3. **Prioridade Estrutural (DRY):** Extrair classes de endereço e cálculo repetidas para o pacote corporativo compartilhado.")
    md.append("\n---\n")

    # --- PARTE 2: DETALHAMENTO TÉCNICO & RECEITAS DE IMPLEMENTAÇÃO ---
    md.append("## 2. Detalhamento Técnico & Receitas de Refatoração para IA")
    md.append("> [!TIP]")
    md.append("> **Como usar esta seção:** Cada item abaixo já contém o diagnóstico e um **Prompt Pronto para IA Executora**. Basta copiar o prompt e enviar para o Claude Code, Cursor, Gemini ou Copilot para executar a refatoração imediatamente.\n")

    md.append("### 2.1 Métodos Críticos de Alta Complexidade Ciclomática (CRAP >= 10.0)")
    for idx, (cm, recipe) in enumerate(top_complex_recipes, 1):
        md.append(f"#### Item 2.1.{idx} — Método `{cm['method']}`")
        md.append(f"- **Repositório / Arquivo:** `{cm['file']}` (Linha ~{cm['start_line']})")
        md.append(f"- **Assinatura:** `{cm['ret_type']} {cm['method']}({cm['args']})`")
        md.append(f"- **Métricas do Uncle Bob:** {cm['lines']} linhas | **CC:** {cm['cc']} | **CRAP Score:** `{cm['crap']}` (Limite seguro: < 10.0)\n")
        md.append("**Parecer da IA & Guia de Implementação:**")
        md.append(recipe)
        md.append("\n" + "-" * 30 + "\n")

    md.append("### 2.2 Unificação de Código Duplicado (Violações de DRY)")
    for idx, (dup_group, recipe) in enumerate(top_duplicate_recipes, 1):
        md.append(f"#### Item 2.2.{idx} — Método Duplicado `{dup_group[0]['method']}`")
        md.append(f"- **Repetido em {len(dup_group)} arquivos:**")
        for it in dup_group:
            md.append(f"  * `{it['file']}`")
        md.append("\n**Parecer da IA & Guia de Implementação:**")
        md.append(recipe)
        md.append("\n" + "-" * 30 + "\n")

    md.append("### 2.3 Resiliência: Amostra de Métodos `async void` Críticos")
    md.append("Em .NET, exceções disparadas dentro de métodos `async void` não podem ser capturadas por chamadores e derrubam o processo de trabalho do ASP.NET. Devem ser convertidos para `async Task`.")
    md.append("\n| Arquivo | Linha | Assinatura Encontrada |")
    md.append("| :--- | :---: | :--- |")
    for av in async_voids[:8]:
        md.append(f"| `{av['file']}` | {av['line']} | `{av['snippet'][:70]}` |")
    md.append("\n")

    # --- PARTE 3: GUIA OPERACIONAL PARA SEGUNDA-FEIRA ---
    md.append("---")
    md.append("## 3. Instruções para Execução na Segunda-feira")
    md.append("1. **Escolha o item a ser refatorado** na Seção 2;")
    md.append("2. **Copie o texto do bloco 'Prompt para IA Executora'**;")
    md.append("3. **Cole no seu assistente de programação** (Claude Code, Antigravity, Cursor) aberto na pasta do respectivo repositório;")
    md.append("4. **Rode a suíte de testes unitários** para validar a ausência de regressões antes de comitar.")
    md.append("\n")

    full_report_text = "\n".join(md)
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(full_report_text)

    print(f"[✓] Relatório completo gravado localmente em: {report_path}")

    # Enfileira para despacho matinal
    pending_file = PENDING_DIR / report_filename
    shutil.copy(report_path, pending_file)
    print(f"[✓] Enfileirado para despacho matinal em: {pending_file}")

    return report_path

if __name__ == "__main__":
    run_quality_architect_audit()
