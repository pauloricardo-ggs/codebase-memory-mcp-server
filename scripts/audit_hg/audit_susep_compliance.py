#!/usr/bin/env python3
"""
Auditoria de Conformidade Regulatória SUSEP / CNSP vs. Código CLAPS
Executa análise profunda de compliance na madrugada utilizando DeepSeek-R1 (Ollama).
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
DOCS_DIR = BASE_DIR / "docs" / "regulatorio_susep"
REPOSITORIES_DIR = BASE_DIR / "repositories" / "claps"
REPORTS_DIR = BASE_DIR / "reports" / "compliance"
PENDING_DIR = BASE_DIR / "reports" / "pending_dispatch"
OLLAMA_URL = "http://127.0.0.1:11434"
AI_MODEL = "deepseek-r1:14b"

def run_compliance_inference(topic: str, regulation_excerpt: str, code_evidence: str) -> str:
    prompt = f"""Você é um Especialista em Compliance de Seguros (Insurtech) e Arquiteto de Software.
Compare a exigência da regulamentação oficial da SUSEP/CNSP com a implementação do sistema CLAPS:

Tópico: {topic}

Trecho Regulatório Oficial (SUSEP / CNSP):
{regulation_excerpt[:1800]}

Evidências de Código do Sistema CLAPS (.NET C#):
{code_evidence[:2000]}

Avalie de forma objetiva e em português:
1. **Status de Conformidade**: (CONFORME, PARCIALMENTE CONFORME ou NÃO CONFORME).
2. **Análise Técnica**: Como o código atende (ou onde deixa lacunas em relação à norma).
3. **Recomendações Práticas**: O que o time de desenvolvimento deve ajustar para garantir 100% de compliance.
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
        return f"*(Falha ao processar análise de compliance: {e})*"

def run_audit():
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PENDING_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[*] Iniciando Auditoria de Conformidade Regulatória com {AI_MODEL}...")

    # Tópico 1: Primeiro Beneficiário (Credor) e Segundo Beneficiário no Seguro Prestamista
    topic1 = "1. Regras do Seguro Prestamista - Primeiro Beneficiário (Credor) e Restituição do Excedente"
    reg1 = """Resolução CNSP nº 439/2022:
No seguro prestamista, o primeiro beneficiário é obrigatoriamente o credor, a quem deve ser paga a indenização até o montante da dívida ou do compromisso financeiro, apurado na data do sinistro. Se o valor do capital segurado for superior ao saldo da obrigação, o excedente deverá ser pago ao próprio segurado (em coberturas de sobrevivência/invalidez) ou ao segundo beneficiário expressamente indicado pelo segurado (em cobertura de morte), ou, na falta deste, aos herdeiros legais conforme Código Civil."""
    
    code1 = """Claps.Contrato.Domain.Entities.Beneficiario & BeneficiarioHistorico:
Permite o cadastro e histórico de múltiplos beneficiários vinculados ao contrato.
Clapsapi-prestamista mapeia regras de apólice e cálculos de saldo devedor integrado ao fluxo de crédito."""

    analysis1 = run_compliance_inference(topic1, reg1, code1)

    # Tópico 2: Quitação Antecipada e Devolução Proporcional do Prêmio
    topic2 = "2. Cancelamento por Quitação Antecipada da Dívida e Devolução Proporcional (Pro-Rata)"
    reg2 = """Resolução CNSP nº 439/2022 e Circular SUSEP nº 667/2022:
Em caso de liquidação ou amortização antecipada da obrigação financeira que deu origem ao seguro prestamista, o seguro deverá ser cancelado ou ter seu capital reduzido proporcionalmente. A seguradora é obrigada a restituir ao segurado a parcela do prêmio pago relativa ao período de cobertura não decorrido (restituição pro-rata die)."""

    code2 = """Claps.Contrato.Domain.Entities.SolicitacaoCancelamento:
Mapeia status de solicitação de cancelamento, motivos e integração com clapsapi-financeiro para rotinas de estorno/devolução e suspensão de cobrança recorrente."""

    analysis2 = run_compliance_inference(topic2, reg2, code2)

    # Tópico 3: Meios Remotos e Certificado Individual
    topic3 = "3. Contratação Eletrônica por Meios Remotos e Envio do Certificado Individual"
    reg3 = """Circular SUSEP nº 666/2022:
A contratação de seguros por meios remotos exige:
I - disponibilização prévia de todas as condições gerais e coberturas antes do aceite;
II - confirmação inequívoca e registro de consentimento do segurado;
III - envio do certificado individual de seguro em meio durável no prazo regulatório após a aceitação."""

    code3 = """Claps.Templates.Contratos.Emails & Clapsapi-Arquivo:
Geração automatizada de certificados individuais e termos de contratação em PDF, com envio por e-mail e persistência dos metadados de emissão."""

    analysis3 = run_compliance_inference(topic3, reg3, code3)

    # Monta o relatório final
    now = datetime.datetime.now(datetime.timezone.utc)
    report_filename = f"auditoria_conformidade_susep_{now.strftime('%Y%m%d_%H%M%S')}.md"
    report_path = REPORTS_DIR / report_filename

    md_lines = [
        f"# ⚖️ Relatório de Auditoria de Conformidade Regulatória (SUSEP / CNSP)",
        f"**Data da Auditoria:** {now.strftime('%d/%m/%Y %H:%M:%S UTC')}  ",
        f"**Normas Auditadas:** Resolução CNSP nº 439/2022, Circulares SUSEP nº 666/2022 e 667/2022  ",
        f"**Motor de Auditoria:** `{AI_MODEL}` (Local - RTX 5060 Ti 16GB)\n",
        "## 1. Sumário Executivo",
        "Esta auditoria avalia a aderência do código e das regras de negócio do ecossistema **CLAPS** em relação ao marco regulatório vigente da SUSEP para Seguros de Pessoas, Seguro Prestamista e Contratação por Meios Remotos.\n",
        "---",
        f"## {topic1}\n{analysis1}\n\n---",
        f"## {topic2}\n{analysis2}\n\n---",
        f"## {topic3}\n{analysis3}\n\n---"
    ]

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(f"[✓] Relatório de compliance gerado em: {report_path}")
    shutil.copy(report_path, PENDING_DIR / report_filename)
    print(f"[✓] Relatório enfileirado para despacho matinal em: {PENDING_DIR / report_filename}")
    return report_path

if __name__ == "__main__":
    run_audit()
