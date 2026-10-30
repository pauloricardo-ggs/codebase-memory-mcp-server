#!/usr/bin/env bash
# ==============================================================================
# Pipeline de Exportação, Quantização Q4_K_M e Registro no Ollama
# ==============================================================================
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WORKSPACE_DIR"

MERGED_DIR="training/claps_merged_model"
GGUF_DIR="training/gguf"
FP16_GGUF="$GGUF_DIR/claps_ai_14b_f16.gguf"
Q4_GGUF="$GGUF_DIR/claps_ai_14b_q4_k_m.gguf"
MODELFILE="$GGUF_DIR/Modelfile"

mkdir -p "$GGUF_DIR"

echo "============================================================"
echo "🚀 EXPORTAÇÃO GGUF E QUANTIZAÇÃO Q4_K_M — CLAPS AI"
echo "============================================================"

# 1. Executa o Merge do LoRA caso ainda não tenha sido feito
if [ ! -d "$MERGED_DIR" ]; then
    echo "• Executando merge dos adaptadores LoRA..."
    python3 scripts/merge_lora.py
else
    echo "• Modelo mesclado já encontrado em $MERGED_DIR"
fi

# 2. Garante o utilitário de conversão llama.cpp
LLAMA_CPP_DIR="training/llama.cpp"
if [ ! -d "$LLAMA_CPP_DIR" ]; then
    echo "• Baixando utilitários de conversão do llama.cpp..."
    git clone --depth 1 https://github.com/ggerganov/llama.cpp "$LLAMA_CPP_DIR"
fi

# 3. Conversão Hugging Face -> GGUF (FP16)
if [ ! -f "$FP16_GGUF" ]; then
    echo "• Convertendo pesos para formato GGUF FP16..."
    python3 "$LLAMA_CPP_DIR/convert_hf_to_gguf.py" "$MERGED_DIR" --outfile "$FP16_GGUF" --outtype f16
else
    echo "• GGUF FP16 já existente em $FP16_GGUF"
fi

# 4. Quantização para Q4_K_M
echo "• Quantizando para Q4_K_M (algoritmo k-quants otimizado)..."
docker run --rm -v "$WORKSPACE_DIR:/workspace" ghcr.io/ggerganov/llama.cpp:full \
    llama-quantize "/workspace/$FP16_GGUF" "/workspace/$Q4_GGUF" Q4_K_M

# 5. Criar o Modelfile do Ollama
echo "• Gerando Modelfile para o Ollama..."
cat <<EOF > "$MODELFILE"
FROM ./claps_ai_14b_q4_k_m.gguf

PARAMETER stop "<|im_start|>"
PARAMETER stop "<|im_end|>"
PARAMETER temperature 0.2
PARAMETER top_p 0.85
PARAMETER num_ctx 131072
PARAMETER num_batch 2048

TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>"""
EOF

# 6. Registrar o modelo no Ollama
echo "• Registrando claps-ai:14b-q4_k_m no Ollama local..."
docker exec -i codebase-memory-ollama-1 ollama create claps-ai:14b-q4_k_m -f "/root/.ollama/models/..." || true

echo "============================================================"
echo "✅ MODELO FINAL PRONTO!"
echo "• Arquivo binário: $Q4_GGUF"
echo "• Modelfile: $MODELFILE"
echo "============================================================"
