#!/usr/bin/env python3
"""
Pipeline de Fine-Tuning QLoRA de Alta Performance para Claps AI.
Suporta Qwen2.5-Coder-14B e Gemma-4-12B com máxima aceleração por hardware:
- TensorFloat-32 (TF32) e bfloat16
- 4-bit NormalFloat (NF4) com Double Quantization
- Dataloader multi-core com pinned memory
- Gradient Checkpointing e otimizador Paged AdamW 8-bit
"""

import os
import sys
import argparse
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments
)
from peft import (
    LoraConfig,
    get_peft_model,
    prepare_model_for_kbit_training
)
from trl import SFTTrainer, SFTConfig

# Ativação de aceleração máxima de hardware na GPU
torch.backends.cuda.matmul.allow_tf32 = True
torch.backends.cudnn.allow_tf32 = True
torch.backends.cudnn.benchmark = True

def parse_args():
    parser = argparse.ArgumentParser(description="Treinamento QLoRA de Alta Performance")
    parser.add_argument("--model_id", type=str, default="Qwen/Qwen2.5-Coder-14B-Instruct", help="Modelo base Hugging Face")
    parser.add_argument("--dataset_path", type=str, default="dataset/claps_training_dataset_master.jsonl", help="Caminho do dataset JSONL")
    parser.add_argument("--output_dir", type=str, default="training/checkpoints", help="Diretório de saída dos checkpoints")
    parser.add_argument("--adapter_dir", type=str, default="training/claps_lora_adapter", help="Diretório final do adaptador LoRA")
    parser.add_argument("--epochs", type=int, default=2, help="Número de épocas de treinamento")
    parser.add_argument("--batch_size", type=int, default=1, help="Batch size por GPU")
    parser.add_argument("--grad_accum", type=int, default=8, help="Passos de acumulação de gradiente")
    parser.add_argument("--learning_rate", type=float, default=2e-4, help="Taxa de aprendizado")
    parser.add_argument("--max_seq_len", type=int, default=1024, help="Comprimento máximo de sequência")
    parser.add_argument("--lora_r", type=int, default=16, help="Rank LoRA")
    parser.add_argument("--lora_alpha", type=int, default=32, help="Alpha LoRA")
    return parser.parse_args()

def main():
    args = parse_args()
    print("=" * 65)
    print("🚀 INICIANDO FINE-TUNING QLoRA DE ALTA PERFORMANCE")
    print("=" * 65)
    print(f"• Modelo Base: {args.model_id}")
    print(f"• Dataset: {args.dataset_path}")
    print(f"• Épocas: {args.epochs} | Max Seq Len: {args.max_seq_len}")
    print(f"• LoRA: r={args.lora_r}, alpha={args.lora_alpha}")
    print(f"• Dispositivo: {torch.cuda.get_device_name(0)}")
    print(f"• VRAM Total: {round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)} GB")
    print("=" * 65)

    # 1. Configuração de Quantização 4-bit (NF4)
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16
    )

    # 2. Carregar Tokenizer
    print("\n📦 Carregando tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(args.model_id, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # 3. Carregar Modelo Base
    print(f"\n📦 Carregando pesos do modelo base em 4-bit...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model_id,
        quantization_config=bnb_config,
        device_map="auto",
        max_memory={0: "13.5GiB", "cpu": "24GiB"},
        trust_remote_code=True,
        dtype=torch.bfloat16
    )
    torch.cuda.empty_cache()

    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    torch.cuda.empty_cache()

    # 4. Configuração LoRA
    peft_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj"
        ],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM"
    )

    model = get_peft_model(model, peft_config)
    torch.cuda.empty_cache()
    trainable_params, all_params = model.get_nb_trainable_parameters()
    print(f"🎯 Parâmetros treináveis: {trainable_params:,} / {all_params:,} ({trainable_params/all_params*100:.2f}%)")

    # 5. Carregar e Processar Dataset em Paralelo
    print(f"\n📂 Carregando dataset: {args.dataset_path}")
    raw_dataset = load_dataset("json", data_files=args.dataset_path, split="train")

    def format_chatml(batch):
        formatted_texts = []
        for conversation in batch["messages"]:
            text = tokenizer.apply_chat_template(
                conversation,
                tokenize=False,
                add_generation_prompt=False
            )
            formatted_texts.append(text)
        return {"text": formatted_texts}

    dataset = raw_dataset.map(
        format_chatml,
        batched=True,
        num_proc=4,
        remove_columns=raw_dataset.column_names
    )
    print(f"• Total de amostras prontas para treino: {len(dataset)}")

    # 6. Configuração dos Hiperparâmetros de Treino
    training_args = SFTConfig(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.learning_rate,
        lr_scheduler_type="cosine",
        warmup_steps=20,
        optim="paged_adamw_8bit",
        bf16=True,
        logging_steps=25,
        save_strategy="no",  # Economiza I/O em disco, salva apenas o final
        gradient_checkpointing=True,
        dataloader_num_workers=4,
        dataloader_pin_memory=True,
        report_to="none",
        dataset_text_field="text",
        max_length=args.max_seq_len
    )

    # 7. Execução do SFTTrainer
    print("\n🏋️ Iniciando treinamento com aceleração máxima de GPU...")
    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        processing_class=tokenizer,
        args=training_args
    )

    trainer.train()

    # 8. Salvar Adaptador LoRA
    print(f"\n💾 Salvando adaptador final em: {args.adapter_dir}")
    os.makedirs(args.adapter_dir, exist_ok=True)
    trainer.model.save_pretrained(args.adapter_dir)
    tokenizer.save_pretrained(args.adapter_dir)

    print("\n" + "=" * 65)
    print(f"✅ TREINAMENTO DE {args.model_id} CONCLUÍDO COM SUCESSO!")
    print(f"• Adaptador salvo em: {args.adapter_dir}")
    print("=" * 65)

if __name__ == "__main__":
    main()
