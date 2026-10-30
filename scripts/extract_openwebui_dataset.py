#!/usr/bin/env python3
"""
Extrai e sanitiza históricos de conversas do Open WebUI para o dataset de Fine-Tuning.
Executa a extração no SQLite dentro do container docker e grava na pasta dataset/ do host.
"""

import subprocess
import json
import os
import sys

OUTPUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "dataset"))

EXTRACTOR_SCRIPT = r'''
import sqlite3, json

def get_text_and_tools(msg):
    text_content = ""
    tool_calls = []

    c = msg.get('content', '')
    if isinstance(c, str) and c.strip():
        text_content = c.strip()
    elif isinstance(c, list):
        parts = [p.get('text', '') for p in c if isinstance(p, dict)]
        if ''.join(parts).strip():
            text_content = ''.join(parts).strip()

    out = msg.get('output', [])
    if isinstance(out, list):
        for item in out:
            if not isinstance(item, dict):
                continue
            item_type = item.get('type')
            if item_type == 'function_call':
                tool_calls.append({
                    'name': item.get('name'),
                    'arguments': item.get('arguments')
                })
            elif item_type == 'message' and not text_content:
                mc = item.get('content', [])
                if isinstance(mc, list):
                    texts = [x.get('text', '') for x in mc if isinstance(x, dict)]
                    if ''.join(texts).strip():
                        text_content = ''.join(texts).strip()
                elif isinstance(mc, str) and mc.strip():
                    text_content = mc.strip()

    return text_content, tool_calls

conn = sqlite3.connect('/app/backend/data/webui.db')
c = conn.cursor()
c.execute('SELECT id, title, chat, created_at, updated_at FROM chat ORDER BY updated_at ASC')
rows = c.fetchall()

extracted = []
for cid, title, chat_json, created_at, updated_at in rows:
    try:
        data = json.loads(chat_json)
    except:
        continue
    history = data.get('history', {})
    messages = history.get('messages', {})
    curr = history.get('currentId')

    chain = []
    visited = set()
    while curr and curr in messages and curr not in visited:
        visited.add(curr)
        chain.append(messages[curr])
        curr = messages[curr].get('parentId')
    chain.reverse()

    if not chain:
        continue

    chat_model = "unknown"
    for m in chain:
        if m.get('model'):
            chat_model = m.get('model')
            break

    conversation_turns = []
    i = 0
    while i < len(chain):
        msg = chain[i]
        if msg.get('role') == 'user':
            user_text, _ = get_text_and_tools(msg)
            if not user_text:
                i += 1
                continue
            
            assistant_text = ""
            assistant_tools = []
            j = i + 1
            while j < len(chain) and chain[j].get('role') == 'assistant':
                txt, tools = get_text_and_tools(chain[j])
                if txt:
                    assistant_text = txt
                if tools:
                    assistant_tools.extend(tools)
                j += 1
            
            if assistant_text:
                conversation_turns.append({
                    "user": user_text,
                    "assistant": assistant_text,
                    "tools": assistant_tools
                })
            i = j
        else:
            i += 1

    if conversation_turns:
        extracted.append({
            "id": cid,
            "title": title,
            "original_model": chat_model,
            "turns": conversation_turns
        })

print(json.dumps(extracted, ensure_ascii=False))
'''

CONCISE_CLOSING = "\n\n*(Resumi os pontos principais. Se desejar uma análise detalhada da causa raiz, do impacto ou dos passos de correção, avise!)*"

SYSTEM_PROMPTS = {
    "business": "Você é o Assistente de Negócio do Claps e PagueOn (MA9), voltado a POs, gerentes e analistas. Responda em português claro, profissional e direto ao ponto. Sempre responda de forma concisa por padrão e informe que pode detalhar a resposta caso solicitado.",
    "code": "Você é o Assistente de Desenvolvimento e Engenharia do Claps e PagueOn (MA9). Responda em português técnico, preciso e objetivo. Analise código, telemetria do Datadog e execução de ferramentas MCP de forma cirúrgica. Responda de forma concisa por padrão e informe que pode detalhar a resposta caso solicitado."
}

def sanitize_assistant_text(text):
    cleaned = text.strip()
    if "Resumi os pontos principais" not in cleaned and "detalhe técnico" not in cleaned and "avise" not in cleaned:
        cleaned += CONCISE_CLOSING
    return cleaned

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print("Iniciando extração do banco do Open WebUI...")
    
    cmd = ["docker", "exec", "-i", "codebase-memory-open-webui-1", "python3", "-"]
    res = subprocess.run(cmd, input=EXTRACTOR_SCRIPT, text=True, capture_output=True)
    
    if res.returncode != 0:
        print(f"Erro ao extrair dados do container: {res.stderr}", file=sys.stderr)
        sys.exit(1)
        
    try:
        chats = json.loads(res.stdout)
    except Exception as e:
        print(f"Erro ao decodificar JSON retornado: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Chats brutos recuperados com turnos válidos: {len(chats)}")

    all_chats = []
    business_chats = []
    code_chats = []

    stats = {
        "total_conversations": len(chats),
        "business_conversations": 0,
        "code_conversations": 0,
        "total_turns": 0
    }

    for chat in chats:
        model = chat.get("original_model", "").lower()
        is_code = any(k in model for k in ["code", "coder", "frontend"])
        category = "code" if is_code else "business"
        sys_prompt = SYSTEM_PROMPTS[category]

        messages = [
            {"role": "system", "content": sys_prompt}
        ]

        for turn in chat["turns"]:
            messages.append({"role": "user", "content": turn["user"]})
            cleaned_assistant = sanitize_assistant_text(turn["assistant"])
            messages.append({"role": "assistant", "content": cleaned_assistant})
            stats["total_turns"] += 1

        entry = {
            "id": chat["id"],
            "title": chat["title"],
            "category": category,
            "original_model": chat["original_model"],
            "messages": messages
        }

        all_chats.append(entry)
        if is_code:
            code_chats.append(entry)
            stats["code_conversations"] += 1
        else:
            business_chats.append(entry)
            stats["business_conversations"] += 1

    def save_jsonl(filename, items):
        path = os.path.join(OUTPUT_DIR, filename)
        with open(path, "w", encoding="utf-8") as f:
            for item in items:
                f.write(json.dumps(item, ensure_ascii=False) + "\n")
        return path

    p_all = save_jsonl("all_chats_clean.jsonl", all_chats)
    p_biz = save_jsonl("claps_business_raw.jsonl", business_chats)
    p_code = save_jsonl("claps_code_raw.jsonl", code_chats)

    print("=== EXTRAÇÃO CONCLUÍDA COM SUCESSO ===")
    print(f"- Total de conversas completas: {stats['total_conversations']}")
    print(f"  • Business (P.O. / Negócio): {stats['business_conversations']}")
    print(f"  • Code (Desenvolvimento / Telemetria): {stats['code_conversations']}")
    print(f"- Total de pares Pergunta/Resposta (turnos): {stats['total_turns']}")
    print("\nArquivos gerados:")
    print(f"  📁 {p_all}")
    print(f"  📁 {p_biz}")
    print(f"  📁 {p_code}")

if __name__ == "__main__":
    main()
