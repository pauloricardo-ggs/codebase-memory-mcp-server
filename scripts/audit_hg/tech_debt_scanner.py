#!/usr/bin/env python3
"""
Scanner Completo de Débito Técnico, Duplicações e Qualidade de Código (CLAPS & PAGUEON)
Mapeia:
1. Duplicações estruturais (DRY violations);
2. Disparidade de versões do .NET Framework (.NET 6 vs .NET 10);
3. Cobertura de testes unitários;
4. Engolimento silencioso de exceções (catch Exception);
5. TODOs e FIXMEs legados esquecidos.
Gera plano de ação arquitetural via DeepSeek-R1 (Ollama).
"""

import os
import sys
import json
import re
import datetime
import urllib.request
import shutil
from collections import defaultdict
from pathlib import Path

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
REPOSITORIES_DIR = BASE_DIR / "repositories"
REPORTS_DIR = BASE_DIR / "reports" / "debito_tecnico"
PENDING_DIR = BASE_DIR / "reports" / "pending_dispatch"
OLLAMA_URL = "http://127.0.0.1:11434"
AI_MODEL = "deepseek-r1:14b"

def scan_framework_versions():
    """Mapeia as versões de TargetFramework nos arquivos .csproj."""
    frameworks = defaultdict(list)
    for csproj in REPOSITORIES_DIR.rglob("*.csproj"):
        if any(s in csproj.parts for s in ["bin", "obj", ".git"]):
            continue
        try:
            with open(csproj, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            match = re.search(r"<TargetFramework>([^<]+)</TargetFramework>", content)
            tf = match.group(1).strip() if match else "Desconhecido"
            # Identifica o nome do repositório pai
            repo_name = csproj.parts[csproj.parts.index("repositories") + 2]
            frameworks[tf].append((repo_name, csproj.name))
        except Exception:
            pass
    return frameworks

def scan_duplicated_files():
    """Identifica arquivos com mesmo nome espalhados em diferentes repositórios."""
    file_map = defaultdict(list)
    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git"]):
            continue
        file_map[p.name].append(p)
    duplicated = {k: v for k, v in file_map.items() if len(v) >= 3}
    return sorted(duplicated.items(), key=lambda x: len(x[1]), reverse=True)

def scan_todos_and_fixmes():
    """Conta comentários de dívida técnica explícita."""
    findings = []
    pattern = re.compile(r"//\s*(TODO|FIXME|HACK|XXX)\b(.*)", re.IGNORECASE)
    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git", "node_modules"]):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                for idx, line in enumerate(f, 1):
                    m = pattern.search(line)
                    if m:
                        findings.append((p.name, idx, m.group(1).upper(), m.group(2).strip()))
        except Exception:
            pass
    return findings

def scan_exception_swallowing():
    """Identifica blocos de catch genéricos."""
    catches = []
    pattern = re.compile(r"catch\s*\(\s*Exception(\s+\w+)?\s*\)")
    for p in REPOSITORIES_DIR.rglob("*.cs"):
        if any(skip in p.parts for skip in ["bin", "obj", "Migrations", ".git"]):
            continue
        try:
            with open(p, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            for m in pattern.finditer(content):
                catches.append(p.name)
        except Exception:
            pass
    return catches

def scan_test_coverage_gaps():
    """Mapeia proporção de arquivos de código vs testes por microsserviço."""
    repo_stats = {}
    claps_dir = REPOSITORIES_DIR / "claps"
    if claps_dir.exists():
        for repo in [p for p in claps_dir.iterdir() if p.is_dir()]:
            all_cs = [p for p in repo.rglob("*.cs") if not any(s in p.parts for s in ["bin", "obj", "Migrations", ".git"])]
            test_cs = [p for p in all_cs if "Test" in p.parts or p.name.endswith("Test.cs") or p.name.endswith("Tests.cs")]
            app_cs = [p for p in all_cs if p not in test_cs]
            ratio = (len(test_cs) / len(app_cs) * 100) if app_cs else 0
            repo_stats[repo.name] = {
                "app_files": len(app_cs),
                "test_files": len(test_cs),
                "ratio": ratio
            }
    return sorted(repo_stats.items(), key=lambda x: x[1]["app_files"], reverse=True)

def analyze_tech_debt_with_ai(topic: str, context_data: str) -> str:
    prompt = f"""Você é um Principal Software Architect especialista em Arquitetura de Microsserviços .NET e Clean Architecture.
Analise o diagnóstico real de Débito Técnico levantado nos repositórios CLAPS e PAGUEON:

Tópico: {topic}

Dados Coletados nos Repositórios:
{context_data[:2000]}

Forneça um parecer técnico e estratégico em português contendo:
1. **Diagnóstico do Impacto**: Riscos operacionais, manutenção, divergência de bugs entre serviços e segurança.
2. **Plano de Consolidação e Ação**: Como refatorar e centralizar essas classes dentro do pacote corporativo `Ma9DevPack` e padronizar o ecossistema no .NET 10.
3. **Passo a Passo para os Desenvolvedores**: Guia prático de priorização para os líderes técnicos e desenvolvedores atuarem nas próximas sprints.
"""
    payload = {
        "model": AI_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.1,
            "num_ctx": 4096
        }
    }
    try:
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            cleaned = re.sub(r"<think>.*?</think>", "", data.get("response", ""), flags=re.DOTALL).strip()
            return cleaned
    except Exception as e:
        return f"*(Falha ao processar análise de débito técnico: {e})*"

def run_full_tech_debt_audit():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    print("[*] 1. Mapeando versões do .NET nos .csproj...")
    frameworks = scan_framework_versions()
    
    print("[*] 2. Mapeando duplicações estruturais de código...")
    duplicates = scan_duplicated_files()
    
    print("[*] 3. Mapeando comentários TODO / FIXME...")
    todos = scan_todos_and_fixmes()

    print("[*] 4. Mapeando blocos catch genéricos...")
    catches = scan_exception_swallowing()

    print("[*] 5. Mapeando cobertura de testes por microsserviço...")
    coverage_gaps = scan_test_coverage_gaps()

    # Prepara resumo para IA
    top_duplicates_summary = "\n".join([
        f"- {name}: repetido em {len(paths)} repositórios"
        for name, paths in duplicates[:8]
    ])
    frameworks_summary = "\n".join([
        f"- {tf}: {len(items)} projetos .csproj associados"
        for tf, items in frameworks.items()
    ])
    context_data = f"Duplicações Críticas:\n{top_duplicates_summary}\n\nVersões de Framework:\n{frameworks_summary}\n\nTotal de TODOs legados: {len(todos)}\nTotal de catches genéricos: {len(catches)}"

    print(f"[*] Executando análise com {AI_MODEL}...")
    ai_plan = analyze_tech_debt_with_ai("Mapeamento Completo de Débito Técnico e Transição para .NET 10", context_data)

    now = datetime.datetime.now(datetime.timezone.utc)
    report_filename = f"auditoria_debito_tecnico_completa_{now.strftime('%Y%m%d_%H%M%S')}.md"
    report_path = REPORTS_DIR / report_filename

    md_lines = [
        f"# 🏗️ Relatório de Auditoria Completa de Débito Técnico e Qualidade de Código",
        f"**Data da Auditoria:** {now.strftime('%d/%m/%Y %H:%M:%S UTC')}  ",
        f"**Ecossistemas Auditados:** CLAPS & PAGUEON  ",
        f"**Motor de IA:** `{AI_MODEL}` (Local - RTX 5060 Ti 16GB)\n",
        "## 1. Sumário Executivo",
        f"- **Projetos Auditados:** {sum(len(v) for v in frameworks.values())} arquivos `.csproj`",
        f"- **Classes Duplicadas entre Serviços:** {len(duplicates)} classes clonadas",
        f"- **Comentários TODO / FIXME Identificados:** {len(todos)} pendências no código",
        f"- **Capturas Genéricas de Erro (`catch Exception`):** {len(catches)} pontos de risco",
        "\n---",
        "## 2. Mapa de Versões do .NET Framework (Status da Migração)",
        "| Versão do TargetFramework | Quantidade de Projetos | Situação Atual |",
        "| :--- | :---: | :--- |"
    ]

    for tf, items in sorted(frameworks.items(), key=lambda x: len(x[1]), reverse=True):
        status_txt = "✅ Modernizado (.NET 10)" if "10.0" in tf else "⚠️ Legado (Pendente Migração)"
        md_lines.append(f"| `{tf}` | **{len(items)}** | {status_txt} |")
    md_lines.append("\n")

    md_lines.append("## 3. Top Classes Duplicadas entre Microsserviços")
    md_lines.append("| Arquivo / Classe | Ocorrências | Repositórios Afetados (Amostra) |")
    md_lines.append("| :--- | :---: | :--- |")
    for name, paths in duplicates[:12]:
        repos_sample = ", ".join(sorted(list(set([p.parts[p.parts.index('repositories')+2] for p in paths])))[:5])
        md_lines.append(f"| `{name}` | **{len(paths)}** | {repos_sample} |")
    md_lines.append("\n")

    md_lines.append("## 4. Disparidade de Cobertura de Testes Unitários")
    md_lines.append("| Microsserviço | Classes de Aplicação | Classes de Teste | Relação Teste/Código |")
    md_lines.append("| :--- | :---: | :---: | :---: |")
    for repo_name, stats in coverage_gaps[:10]:
        md_lines.append(f"| `{repo_name}` | {stats['app_files']} | {stats['test_files']} | {stats['ratio']:.1f}% |")
    md_lines.append("\n---\n")

    md_lines.append("## 5. Parecer da Inteligência Artificial & Plano Estratégico")
    md_lines.append(ai_plan)
    md_lines.append("\n---\n")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"[✓] Relatório completo gerado em: {report_path}")
    shutil.copy(report_path, PENDING_DIR / report_filename)
    print(f"[✓] Enfileirado para despacho matinal em: {PENDING_DIR / report_filename}")
    return report_path

if __name__ == "__main__":
    run_full_tech_debt_audit()
