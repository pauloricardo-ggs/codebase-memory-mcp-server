#!/usr/bin/env bash
# Orquestrador do Pipeline de Auditoria HG
set -euo pipefail

SINCE="${1:-12h}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === INICIANDO PIPELINE DE AUDITORIA HG (Filtro: $SINCE) ==="
python3 "$SCRIPT_DIR/hg_collector.py" "$SINCE"
python3 "$SCRIPT_DIR/hg_analyzer.py"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === PIPELINE CONCLUÍDO COM SUCESSO ==="
