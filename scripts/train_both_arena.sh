#!/usr/bin/env bash
# ==============================================================================
# Pipeline Completo de Fine-Tuning A/B (Qwen 14B vs Gemma 4 12B)
# ==============================================================================
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_DIR"

HF_CACHE_DIR="${HOME}/.cache/huggingface"
mkdir -p "$HF_CACHE_DIR"
mkdir -p "training/checkpoints"
mkdir -p "training/qwen_lora_adapter"
mkdir -p "training/gemma_lora_adapter"
mkdir -p "training/gguf"

# Garante que o Ollama será sempre despausado ao finalizar ou interromper
cleanup() {
    echo "• Restaurando status dos serviços..."
    docker unpause codebase-memory-ollama-1 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "============================================================"
echo "🔒 1. ISOLANDO GPU (PAUSANDO SERVIÇOS EXTERNOS)"
echo "============================================================"
echo "• Pausando Ollama para garantir 100% de VRAM exclusiva para treino..."
docker pause codebase-memory-ollama-1 2>/dev/null || true

echo "============================================================"
echo "🏋️ 2. TREINANDO MODELO 1: Qwen2.5-Coder-14B-Instruct"
echo "============================================================"
docker run --rm \
    --gpus all \
    --ipc=host \
    --shm-size=16g \
    -e PYTORCH_ALLOC_CONF=expandable_segments:True \
    -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    -e HF_HOME=/root/.cache/huggingface \
    -v "$WORKSPACE_DIR:/workspace" \
    -v "$HF_CACHE_DIR:/root/.cache/huggingface" \
    claps-trainer:latest \
    python3 scripts/train_qlora.py \
        --model_id "Qwen/Qwen2.5-Coder-14B-Instruct" \
        --dataset_path "dataset/claps_training_dataset_master.jsonl" \
        --output_dir "training/checkpoints/qwen" \
        --adapter_dir "training/qwen_lora_adapter" \
        --epochs 2 \
        --max_seq_len 1024 \
        --batch_size 1 \
        --grad_accum 8

echo "============================================================"
echo "🏋️ 3. TREINANDO MODELO 2: google/gemma-4-12B-it"
echo "============================================================"
docker run --rm \
    --gpus all \
    --ipc=host \
    --shm-size=16g \
    -e PYTORCH_ALLOC_CONF=expandable_segments:True \
    -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    -e HF_HOME=/root/.cache/huggingface \
    -v "$WORKSPACE_DIR:/workspace" \
    -v "$HF_CACHE_DIR:/root/.cache/huggingface" \
    claps-trainer:latest \
    python3 scripts/train_qlora.py \
        --model_id "google/gemma-4-12B-it" \
        --dataset_path "dataset/claps_training_dataset_master.jsonl" \
        --output_dir "training/checkpoints/gemma" \
        --adapter_dir "training/gemma_lora_adapter" \
        --epochs 2 \
        --max_seq_len 1024 \
        --batch_size 1 \
        --grad_accum 8

echo "============================================================"
echo "🔓 4. DESPAUSANDO OLLAMA E RESTAURANDO OPERAÇÃO"
echo "============================================================"
docker unpause codebase-memory-ollama-1 2>/dev/null || true

echo "============================================================"
echo "🎉 AMBOS OS MODELOS FORAM TREINADOS COM SUCESSO!"
echo "• Adaptador Qwen: training/qwen_lora_adapter"
echo "• Adaptador Gemma: training/gemma_lora_adapter"
echo "============================================================"
