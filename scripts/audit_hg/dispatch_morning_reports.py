#!/usr/bin/env python3
"""
Despachador Matinal de Relatórios (08:00 BRT - Segunda a Sexta)
Varre relatórios pendentes gerados na madrugada, envia resumo e documentos para o Telegram,
e arquiva os relatórios enviados.
"""

import os
import sys
import datetime
import shutil
from pathlib import Path
from telegram_notifier import send_telegram_message

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
PENDING_DIR = BASE_DIR / "reports" / "pending_dispatch"
DISPATCHED_DIR = BASE_DIR / "reports" / "dispatched"

def dispatch():
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    DISPATCHED_DIR.mkdir(parents=True, exist_ok=True)

    pending_files = sorted(list(PENDING_DIR.glob("*.md")))
    if not pending_files:
        print("[INFO] Nenhum relatório pendente para envio às 08:00.")
        return

    now_local = datetime.datetime.now()
    summary_text = (
        f"☀️ *Bom dia! Briefing Semanal de Engenharia, Qualidade & Produção*\n"
        f"📅 *Data:* {now_local.strftime('%d/%m/%Y')} (08:00 BRT)\n\n"
        f"O processamento semanal consolidado foi concluído pela IA local (DeepSeek-R1 / RTX 5060 Ti):\n"
        f"• *Homologação (HG):* Análise dos logs coletados ao longo da semana\n"
        f"• *Produção (Datadog APM):* Top gargalos e traces de produção\n"
        f"• *Conformidade Regulatória:* SUSEP / CNSP\n"
        f"• *Engenharia:* Oportunidades .NET 10 e débito técnico\n\n"
        f"Foram gerados *{len(pending_files)} relatórios* técnicos consolidados.\n\n"
        f"📄 Os arquivos detalhados seguem anexados abaixo:"
    )

    print(f"[*] Enviando briefing matinal com {len(pending_files)} relatórios para o Telegram...")
    # 1. Envia a mensagem de abertura
    send_telegram_message(summary_text)

    # 2. Envia cada documento individualmente e arquiva
    for file_path in pending_files:
        archived_path = DISPATCHED_DIR / file_path.name
        print(f"[*] Despachando documento: {file_path.name}")
        caption = (
            f"📑 *Relatório:* `{file_path.name}`\n"
            f"📂 *Caminho no Servidor:*\n`{archived_path}`"
        )
        send_telegram_message(caption, str(file_path))
        # Move para arquivamento
        shutil.move(file_path, archived_path)
        print(f"[✓] Arquivado em: {archived_path}")

    print("[✓] Despacho matinal concluído com sucesso!")

if __name__ == "__main__":
    dispatch()
