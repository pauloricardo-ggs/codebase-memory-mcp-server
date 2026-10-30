#!/usr/bin/env bash
# ==============================================================================
# Executa o Treinamento QLoRA em Container Docker Isolado com Sucesso de GPU
# ==============================================================================
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HF_CACHE_DIR="${HOME}/.cache/huggingface"

mkdir -p "$HF_CACHE_DIR"
mkdir -p "$WORKSPACE_DIR/training/checkpoints"
mkdir -p "$WORKSPACE_DIR/training/claps_lora_adapter"

echo "============================================================"
echo "🐳 INICIANDO AMBIENTE DE TREINAMENTO DOCKER (GPU RTX 5060 Ti)"
echo "============================================================"

# 1. Constrói a imagem do treinador (se ainda não existir)
if ! docker image inspect claps-trainer:latest >/dev/null 2>&1; then
    echo "• Construindo imagem do treinador claps-trainer:latest..."
    docker build -t claps-trainer:latest -f "$WORKSPACE_DIR/training/Dockerfile" "$WORKSPACE_DIR"
fi

# 2. Executa o script de treino com acesso direto à GPU e IPC host
echo "• Executando scripts/train_qlora.py dentro do container..."
docker run --rm -it \
    --gpus all \
    --ipc=host \
    -v "$WORKSPACE_DIR:/workspace" \
    -v "$HF_CACHE_DIR:/root/.cache/huggingface" \
    claps-trainer:latest \
    python3 scripts/train_qlora.py "$@"
