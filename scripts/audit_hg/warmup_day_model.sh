#!/usr/bin/env bash
# Script para reaquecer o modelo diurno do Open WebUI na GPU às 07:50
set -euo pipefail

MODEL_DAY="qwen2.5-coder:14b-instruct-q4_0"
OLLAMA_URL="http://127.0.0.1:11434"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Iniciando reaquecimento do modelo diurno ($MODEL_DAY) na VRAM..."
curl -s "$OLLAMA_URL/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"$MODEL_DAY\", \"prompt\": \"\", \"keep_alive\": -1}" >/dev/null

echo "[$(date '+%Y-%m-%d %H:%M:%S')] [✓] Modelo diurno carregado e pronto para os usuários com cold-start zero!"
