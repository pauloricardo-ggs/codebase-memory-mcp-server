#!/usr/bin/env python3
"""
Módulo de Modernização e Otimização para .NET 10 (C# Moderno)
Analisa classes reais dos repositórios locais do CLAPS e PAGUEON,
identifica oportunidades de melhoria em performance, legibilidade e padrões SRE/Microsoft,
e gera propostas de refatoração usando DeepSeek-R1 (Ollama).
"""

import os
import sys
import json
import re
import datetime
import urllib.request
import shutil
from pathlib import Path

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
REPOSITORIES_DIR = BASE_DIR / "repositories"
REPORTS_DIR = BASE_DIR / "reports" / "modernizacao"
PENDING_DIR = BASE_DIR / "reports" / "pending_dispatch"
OLLAMA_URL = "http://127.0.0.1:11434"
AI_MODEL = "deepseek-r1:14b"

# Alvos prioritários para refatoração e modernização
CANDIDATE_PATTERNS = [
    "UsuarioService.cs",
    "UsuarioQuery.cs",
    "ContratoService.cs",
    "ProdutoService.cs",
    "FinanceiroService.cs",
    "AutenticadorService.cs"
]

def find_target_file() -> Path:
    """Encontra um arquivo de código representativo nos repositórios."""
    for pattern in CANDIDATE_PATTERNS:
        matches = list(REPOSITORIES_DIR.rglob(pattern))
        if matches:
            # Retorna o primeiro que tiver tamanho significativo
            for m in matches:
                if m.is_file() and m.stat().st_size > 1000:
                    return m
    # Fallback para qualquer arquivo de serviço C#
    services = list(REPOSITORIES_DIR.rglob("*Service.cs"))
    return services[0] if services else None

def extract_meaningful_class(file_path: Path, max_lines: int = 70) -> str:
    """Extrai um bloco de classe ou métodos com construtor e regras de negócio."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        
        # Pega as primeiras max_lines linhas da classe (geralmente contém injeção de dependência e primeiros métodos)
        snippet = "".join(lines[:max_lines])
        return snippet
    except Exception as e:
        return ""

def analyze_modernization(file_path: Path, code_snippet: str) -> str:
    prompt = f"""Você é um Principal Software Architect especialista em performance e modernização da plataforma .NET (.NET 10 / C# 14).
Analise o trecho de código C# real do projeto Claps em anexo:

Arquivo: {file_path.name}
Caminho: {file_path}

Código Atual (.NET 6 / Legado):
```csharp
{code_snippet[:2200]}
```

Forneça uma proposta de refatoração para **.NET 10**, estruturada em:
1. **Oportunidades de Melhoria Identificadas**:
   - Redução de boilerplate (ex: Primary Constructors C# 12+);
   - Performance de Memória e GC (ex: Span<T>, FrozenDictionary, SearchValues, eliminação de alocações);
   - Legibilidade e Clean Code (ex: Collection expressions [...], pattern matching);
   - Acesso a dados ou chamadas resilientes.
2. **Código Refatorado (.NET 10 / C# Moderno)**: Apresente o código modernizado, limpo, conciso e com tipagem defensiva de nulos.
3. **Ganhos Estimados**: Explique o impacto em alocação de memória (Gen0 GC), legibilidade de código e manutenção.
4. **Referência Oficial da Microsoft**: Link ou citação de documentação do Microsoft Learn aplicável.
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
        return f"*(Falha ao processar análise de modernização: {e})*"

def run_modernization():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    target_file = find_target_file()
    if not target_file:
        print("[WARN] Nenhum arquivo C# elegível encontrado para modernização.")
        return

    print(f"[*] Analisando oportunidades de modernização .NET 10 em: {target_file.name}")
    snippet = extract_meaningful_class(target_file, max_lines=75)
    
    print(f"[*] Executando inferência com {AI_MODEL}...")
    ai_output = analyze_modernization(target_file, snippet)

    now = datetime.datetime.now(datetime.timezone.utc)
    report_filename = f"modernizacao_dotnet10_{now.strftime('%Y%m%d_%H%M%S')}.md"
    report_path = REPORTS_DIR / report_filename

    md_lines = [
        f"# 🚀 Oportunidade de Modernização e Performance (.NET 10)",
        f"**Data da Análise:** {now.strftime('%d/%m/%Y %H:%M:%S UTC')}  ",
        f"**Arquivo Analisado:** `{target_file.name}`  ",
        f"**Caminho no Repositório:** `{target_file}`  ",
        f"**Motor de IA:** `{AI_MODEL}` (Local - RTX 5060 Ti 16GB)\n",
        "## 1. Contexto da Migração",
        "Atualmente o ecossistema está em transição do **.NET 6** para o **.NET 10**. Esta análise aponta como transformar o código legado em padrões de alta performance e legibilidade utilizando os recursos mais modernos da linguagem C#.\n",
        "---",
        "## 2. Parecer Técnico e Proposta de Refatoração",
        ai_output,
        "\n---"
    ]

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"[✓] Relatório de modernização gerado em: {report_path}")
    shutil.copy(report_path, PENDING_DIR / report_filename)
    print(f"[✓] Enfileirado para despacho matinal (08:00 BRT) em: {PENDING_DIR / report_filename}")
    return report_path

if __name__ == "__main__":
    run_modernization()
