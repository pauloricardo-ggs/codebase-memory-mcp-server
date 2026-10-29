#!/usr/bin/env python3
"""
HG Log & Code Analyzer
Analisa o snapshot coletado de HG, deduplica erros, cruza com o código-fonte C# local,
executa inferência no DeepSeek-R1 (Ollama) e compila o relatório Markdown.
"""

import os
import sys
import json
import re
import datetime
import urllib.request
from pathlib import Path

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
REPOSITORIES_DIR = BASE_DIR / "repositories"
DATA_DIR = BASE_DIR / "data" / "hg_snapshots"
REPORTS_DIR = BASE_DIR / "reports" / "hg"
OLLAMA_URL = "http://127.0.0.1:11434"
AI_MODEL = "deepseek-r1:14b"

def get_latest_snapshot() -> Path:
    snapshots = [p for p in DATA_DIR.iterdir() if p.is_dir() and (p / "inventory.json").exists()]
    if not snapshots:
        raise FileNotFoundError(f"Nenhum snapshot encontrado em {DATA_DIR}")
    return sorted(snapshots)[-1]

def find_local_code_file(relative_path: str) -> Path:
    """Busca um arquivo nos repositórios locais baseado no caminho do stack trace."""
    filename = Path(relative_path).name
    matches = list(REPOSITORIES_DIR.rglob(filename))
    if matches:
        return matches[0]
    return None

def extract_code_snippet(file_path: Path, line_number: int, context_lines: int = 15) -> str:
    """Extrai o trecho do arquivo ao redor da linha indicada."""
    if not file_path or not file_path.exists():
        return ""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        start = max(0, line_number - context_lines - 1)
        end = min(len(lines), line_number + context_lines)
        numbered_lines = [f"{i+1:4d}: {lines[i]}" for i in range(start, end)]
        return "".join(numbered_lines)
    except Exception as e:
        return f"[Erro ao ler arquivo: {e}]"

def analyze_with_deepseek(service_name: str, exception_msg: str, stack_trace: str, code_snippet: str) -> str:
    """Invoca o DeepSeek-R1 no Ollama local para analisar a causa raiz e gerar sugestões técnicas."""
    prompt = f"""Você é um Arquiteto de Software .NET Sênior e Engenheiro SRE especialista em resiliência.
Analise a falha real capturada em Homologação (HG):

- Serviço / Container: {service_name}
- Exceção: {exception_msg}
- Stack Trace Relevante:
{stack_trace[:1500]}

- Código-Fonte Real Local (.NET C#):
{code_snippet[:2000]}

Forneça um parecer técnico objetivo em português contendo:
1. **Causa Raiz Exata**: O que disparou a falha no código ou integração.
2. **Proposta de Correção (Patch/Diff C#)**: Código corrigido moderno (.NET 8/9/10), com tratamento defensivo de nulos, timeouts ou concorrência.
3. **Padrão Recomendado (Microsoft / Indústria)**: Qual padrão de arquitetura oficial da Microsoft (ex: Microsoft Learn, Polly, gRPC Client Factory) deve ser adotado para evitar reincidência.
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
            response_text = data.get("response", "")
            # Limpa tags de pensamento <think>...</think> para o relatório final limpo
            cleaned_response = re.sub(r"<think>.*?</think>", "", response_text, flags=re.DOTALL).strip()
            return cleaned_response
    except Exception as e:
        return f"*(Falha ao processar análise com IA local: {e})*"

def run_analysis(snapshot_dir: Path = None):
    if not snapshot_dir:
        snapshot_dir = get_latest_snapshot()

    print(f"[*] Analisando snapshot: {snapshot_dir}")
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Carregar inventário e estatísticas
    with open(snapshot_dir / "inventory.json", "r", encoding="utf-8") as f:
        inventory = json.load(f)

    stats = []
    if (snapshot_dir / "stats.json").exists():
        with open(snapshot_dir / "stats.json", "r", encoding="utf-8") as f:
            stats = json.load(f)

    # 2. Varrer logs de cada container
    logs_dir = snapshot_dir / "logs"
    errors_by_service = {}
    total_exceptions = 0

    stack_trace_pattern = re.compile(r"in (/[^:]+):line (\d+)")

    for log_file in logs_dir.glob("*.log"):
        service_name = log_file.stem
        with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        # Filtra blocos de erro
        error_blocks = []
        for line in content.splitlines():
            if any(k in line for k in ["[ERR]", "[FTL]", "Exception", "NullReferenceException", "TimeoutException"]):
                error_blocks.append(line)

        if error_blocks:
            # Agrupa por mensagem principal
            errors_by_service[service_name] = {
                "count": len(error_blocks),
                "samples": error_blocks[:15],
                "raw_text": content
            }
            total_exceptions += len(error_blocks)

    print(f"[*] Total de erros/alertas identificados: {total_exceptions} em {len(errors_by_service)} serviços.")

    # 3. Análise dos Top Incidentes Críticos com DeepSeek-R1
    detailed_findings = []
    
    for service, err_data in errors_by_service.items():
        if service.startswith("claps-mongodb"):
            continue # Pula logs volumosos de infraestrutura padrão do mongo

        print(f"[*] Executando inferência profunda com DeepSeek-R1 para: {service}...")
        raw_text = err_data["raw_text"]

        # Busca stack trace com linha de código
        match = stack_trace_pattern.search(raw_text)
        code_snippet = ""
        file_path_str = ""
        line_num = 0

        if match:
            file_path_str = match.group(1)
            line_num = int(match.group(2))
            local_file = find_local_code_file(file_path_str)
            if local_file:
                code_snippet = extract_code_snippet(local_file, line_num)

        first_error = err_data["samples"][0] if err_data["samples"] else "Erro não identificado"
        stack_excerpt = "\n".join(err_data["samples"][:8])

        ai_analysis = analyze_with_deepseek(service, first_error, stack_excerpt, code_snippet)

        detailed_findings.append({
            "service": service,
            "error_count": err_data["count"],
            "sample": first_error,
            "file": file_path_str,
            "line": line_num,
            "analysis": ai_analysis
        })

    # 4. Montar o Relatório Final em Markdown
    now = datetime.datetime.now(datetime.timezone.utc)
    report_filename = f"auditoria_hg_{now.strftime('%Y%m%d_%H%M%S')}.md"
    report_path = REPORTS_DIR / report_filename

    md_lines = []
    md_lines.append(f"# 🛡️ Relatório de Auditoria e Qualidade de Homologação (HG)")
    md_lines.append(f"**Data da Coleta:** {now.strftime('%d/%m/%Y %H:%M:%S UTC')}  ")
    md_lines.append(f"**Servidor Auditado:** `hg (52.205.105.162)` (100% Read-Only)  ")
    md_lines.append(f"**Modelo de IA Analisador:** `{AI_MODEL}` (Local - RTX 5060 Ti 16GB)\n")

    md_lines.append("## 1. Sumário Executivo")
    md_lines.append(f"- **Total de Containers Monitorados:** {len(inventory)}")
    md_lines.append(f"- **Total de Ocorrências de Erro/Alerta:** {total_exceptions}")
    md_lines.append(f"- **Serviços Críticos com Falhas:** {len(detailed_findings)}\n")

    # Tabela de Inventário
    md_lines.append("## 2. Inventário de Versões em Homologação")
    md_lines.append("| Serviço / Container | Imagem / Versão Ativa | Status |")
    md_lines.append("| :--- | :--- | :--- |")
    for c in inventory:
        md_lines.append(f"| `{c.get('Names')}` | `{c.get('Image')}` | {c.get('Status')} |")
    md_lines.append("\n")

    # Métricas de Recursos
    if stats:
        md_lines.append("## 3. Consumo de Recursos (Top Utilização)")
        md_lines.append("| Container | CPU % | Uso de Memória / Limite | Memória % |")
        md_lines.append("| :--- | :---: | :---: | :---: |")
        for s in stats[:8]:
            md_lines.append(f"| `{s.get('Name')}` | {s.get('CPUPerc')} | {s.get('MemUsage')} | {s.get('MemPerc')} |")
        md_lines.append("\n")

    # Diagnósticos Detalhados com Causa Raiz e Diffs
    md_lines.append("## 4. Diagnóstico de Incidentes e Pontos de Melhoria")
    if not detailed_findings:
        md_lines.append("✅ **Nenhuma falha crítica detectada nos logs do período auditado!**\n")
    else:
        for item in detailed_findings:
            md_lines.append(f"### ⚠️ Serviço: `{item['service']}` ({item['error_count']} ocorrências)")
            md_lines.append(f"**Exemplo de Log:** `{item['sample'][:120]}`  ")
            if item["file"]:
                md_lines.append(f"**Arquivo Detectado:** `{item['file']}` (Linha {item['line']})\n")
            md_lines.append(f"#### Parecer da Inteligência Artificial & Melhores Práticas:")
            md_lines.append(f"{item['analysis']}\n")
            md_lines.append("---\n")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"[✓] Relatório completo gerado em: {report_path}")

    # Salva na fila de despacho matinal das 08:00 (Segunda a Sexta)
    pending_dir = BASE_DIR / "reports" / "pending_dispatch"
    pending_dir.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy(report_path, pending_dir / report_filename)
    print(f"[✓] Relatório enfileirado para envio matinal (08:00 BRT) em: {pending_dir / report_filename}")

    # Envia imediatamente apenas se for solicitado explicitamente via --send-now
    if "--send-now" in sys.argv:
        try:
            from telegram_notifier import send_telegram_message
            summary_text = (
                f"🚨 *Relatório de Auditoria HG ({now.strftime('%d/%m/%Y')})*\n\n"
                f"• *Containers:* {len(inventory)} ativos\n"
                f"• *Incidentes:* {len(detailed_findings)} serviços com erros\n"
                f"• *IA Analisadora:* `{AI_MODEL}`\n\n"
                f"📄 O relatório detalhado com patches e causas raízes segue em anexo."
            )
            send_telegram_message(summary_text, str(report_path))
        except Exception as e:
            print(f"[INFO] Disparo Telegram: {e}")

    return report_path

if __name__ == "__main__":
    snap = None
    for arg in sys.argv[1:]:
        if not arg.startswith("--") and os.path.exists(arg):
            snap = Path(arg)
    run_analysis(snap)
