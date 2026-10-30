#!/usr/bin/env bash
# Master Overnight Pipeline (Execução na Madrugada: 02:00 BRT / 05:00 UTC)
# Não envia notificações no Telegram de madrugada; enfileira tudo para as 08:00 BRT.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="/home/ma9/codebase-memory-mcp-server/data/hg_snapshots"
mkdir -p "$LOG_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === INICIANDO PIPELINE DE MADRUGADA (HG + COMPLIANCE SUSEP) ==="

# 1. Análise Técnica dos Logs e Código de HG (Processa o snapshot coletado às 18:20, sem SSH)
echo "[*] Passo 1: Executando análise técnica dos logs locais de HG..."
python3 "$SCRIPT_DIR/hg_analyzer.py" >> "$LOG_DIR/overnight_analyzer.log" 2>&1 || true

# 2. Auditoria de Conformidade Regulatória SUSEP / CNSP
echo "[*] Passo 2: Executando auditoria de conformidade SUSEP..."
python3 "$SCRIPT_DIR/audit_susep_compliance.py" >> "$LOG_DIR/overnight_compliance.log" 2>&1 || true

# 3. Modernização e Otimização para .NET 10
echo "[*] Passo 3: Executando análise de modernização e performance .NET 10..."
python3 "$SCRIPT_DIR/dotnet10_modernizer.py" >> "$LOG_DIR/overnight_modernizer.log" 2>&1 || true

# 4. Auditoria de Débito Técnico e Duplicação de Código
echo "[*] Passo 4: Executando auditoria de débito técnico e duplicações..."
python3 "$SCRIPT_DIR/tech_debt_scanner.py" >> "$LOG_DIR/overnight_tech_debt.log" 2>&1 || true

# 5. Auditoria de Desempenho e Telemetria de Produção Datadog APM
echo "[*] Passo 5: Executando análise de gargalos Datadog APM de produção..."
python3 "$SCRIPT_DIR/generate_and_send_performance_report.py" >> "$LOG_DIR/overnight_datadog.log" 2>&1 || true

# 6. Auditoria Prescritiva de Qualidade e Guia de Refatoração (Receitas para IA)
echo "[*] Passo 6: Executando auditoria prescritiva de qualidade e receitas de refatoração..."
python3 "$SCRIPT_DIR/code_quality_architect_scanner.py" >> "$LOG_DIR/overnight_quality_recipes.log" 2>&1 || true

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [✓] Auditorias semanais concluídas. Relatórios enfileirados exclusivamente para entrega na Segunda-feira às 08:00 BRT via Telegram."
