FROM ghcr.io/open-webui/open-webui:v0.11.4-cuda

USER root

# Instala bibliotecas necessárias para fine-tuning QLoRA
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        peft \
        bitsandbytes \
        trl \
        scipy

WORKDIR /workspace

CMD ["python3", "scripts/train_qlora.py"]
