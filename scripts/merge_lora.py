#!/usr/bin/env python3
"""
Mescla os adaptadores LoRA treinados de volta aos pesos base do modelo.
Gera o modelo unificado em formato Hugging Face pronto para conversão em GGUF.
"""

import os
import sys
import argparse
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

def parse_args():
    parser = argparse.ArgumentParser(description="Mescla LoRA com Modelo Base")
    parser.add_argument("--base_model", type=str, default="Qwen/Qwen2.5-Coder-14B-Instruct", help="Modelo base Hugging Face")
    parser.add_argument("--adapter_dir", type=str, default="training/qwen_lora_adapter", help="Diretório do adaptador LoRA")
    parser.add_argument("--output_dir", type=str, default="training/claps_merged_model", help="Diretório de saída do modelo mesclado")
    parser.add_argument("--device_map", type=str, default="auto", help="Estratégia de alocação de dispositivos (auto / cpu)")
    return parser.parse_args()

def main():
    args = parse_args()
    print("=" * 60)
    print("🔄 INICIANDO MERGE DE ADAPTADORES LoRA")
    print(f"• Base: {args.base_model}")
    print(f"• Adaptador: {args.adapter_dir}")
    print(f"• Saída: {args.output_dir}")
    print(f"• Device Map: {args.device_map}")
    print("=" * 60)

    print("\n📦 Carregando tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(args.adapter_dir, trust_remote_code=True)

    print(f"\n📦 Carregando modelo base em bfloat16 com device_map={args.device_map}...")
    base_model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        torch_dtype=torch.bfloat16,
        device_map=args.device_map,
        trust_remote_code=True,
        low_cpu_mem_usage=True
    )

    print(f"\n📦 Aplicando adaptadores LoRA de {args.adapter_dir}...")
    model = PeftModel.from_pretrained(base_model, args.adapter_dir)

    print("\n⚡ Mesclando pesos (merge_and_unload)...")
    merged_model = model.merge_and_unload()

    print(f"\n💾 Salvando modelo unificado em: {args.output_dir}...")
    os.makedirs(args.output_dir, exist_ok=True)
    merged_model.save_pretrained(args.output_dir, safe_serialization=True, max_shard_size="5GB")
    tokenizer.save_pretrained(args.output_dir)

    print("\n✅ MERGE CONCLUÍDO COM SUCESSO!")
    print(f"• Modelo unificado disponível em: {args.output_dir}")

if __name__ == "__main__":
    main()
