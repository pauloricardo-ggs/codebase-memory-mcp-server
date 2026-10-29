#!/usr/bin/env python3
"""
Telegram Notifier para Relatórios de Auditoria HG
Envia o resumo executivo no chat e anexa o relatório Markdown (.md) completo.
"""

import os
import sys
import json
import urllib.request
import urllib.parse
from pathlib import Path

SECRETS_FILE = Path("/home/ma9/codebase-memory-mcp-server/data/secrets/telegram.env")

def load_telegram_credentials():
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")

    if not token or not chat_id:
        if SECRETS_FILE.exists():
            with open(SECRETS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("TELEGRAM_BOT_TOKEN="):
                        token = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("TELEGRAM_CHAT_ID="):
                        chat_id = line.split("=", 1)[1].strip().strip('"').strip("'")

    return token, chat_id

def send_telegram_message(text: str, report_file_path: str = None) -> bool:
    token, chat_id = load_telegram_credentials()
    if not token or not chat_id:
        print("[INFO] Telegram credentials (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) não configurados ainda.")
        print(f"[INFO] Configure em {SECRETS_FILE} para habilitar o envio automático.")
        return False

    api_base = f"https://api.telegram.org/bot{token}"

    # 1. Enviar mensagem de texto (resumo)
    try:
        msg_payload = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown"
        }
        req = urllib.request.Request(
            f"{api_base}/sendMessage",
            data=json.dumps(msg_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            pass
        print("[✓] Mensagem de resumo enviada ao Telegram com sucesso.")
    except Exception as e:
        print(f"[WARN] Falha ao enviar texto para o Telegram: {e}")

    # 2. Enviar arquivo .md anexo se fornecido
    if report_file_path and os.path.exists(report_file_path):
        try:
            with open(report_file_path, "rb") as doc:
                file_bytes = doc.read()

            boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
            filename = os.path.basename(report_file_path)

            body = (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="chat_id"\r\n\r\n'
                f"{chat_id}\r\n"
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'
                f"Content-Type: text/markdown\r\n\r\n"
            ).encode("utf-8") + file_bytes + f"\r\n--{boundary}--\r\n".encode("utf-8")

            req = urllib.request.Request(
                f"{api_base}/sendDocument",
                data=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                pass
            print(f"[✓] Documento {filename} enviado ao Telegram com sucesso.")
        except Exception as e:
            print(f"[WARN] Falha ao enviar documento para o Telegram: {e}")

    return True

if __name__ == "__main__":
    if len(sys.argv) > 1:
        txt = sys.argv[1]
        doc_path = sys.argv[2] if len(sys.argv) > 2 else None
        send_telegram_message(txt, doc_path)
    else:
        print("Uso: telegram_notifier.py <mensagem> [caminho_arquivo_md]")
