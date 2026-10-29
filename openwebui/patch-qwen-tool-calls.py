import re, sys, os

target = "/app/backend/open_webui/utils/middleware.py"
if not os.path.exists(target):
    print(f"Target {target} does not exist", file=sys.stderr)
    sys.exit(1)

with open(target, "r", encoding="utf-8") as f:
    code = f.read()

# Remover versão anterior se existir
old_marker = "# --- QWEN TEXT TOOL-CALL EXTRACTION PATCH ---"
if old_marker in code:
    code = re.sub(r" *# --- QWEN TEXT TOOL-CALL EXTRACTION PATCH ---.*?# --- END QWEN TEXT TOOL-CALL EXTRACTION PATCH ---\n*", "", code, flags=re.DOTALL)

target_str = "                    # Responses API path: extract function_call items from output"
if target_str not in code:
    print(f"Target anchor not found in {target}", file=sys.stderr)
    sys.exit(1)

patch_code = """                    # --- QWEN TEXT TOOL-CALL EXTRACTION PATCH ---
                    if not response_tool_calls and output and metadata.get('tools'):
                        last_msg = output[-1] if output and output[-1].get('type') == 'message' else None
                        if last_msg:
                            parts = last_msg.get('content', [])
                            txt = ""
                            if parts and parts[-1].get('type') == 'output_text':
                                txt = parts[-1].get('text', '').strip()
                            if txt.startswith('```json'):
                                txt = txt[7:]
                            if txt.startswith('```'):
                                txt = txt[3:]
                            if txt.endswith('```'):
                                txt = txt[:-3]
                            txt = txt.strip()
                            if txt.startswith('{') and txt.endswith('}'):
                                try:
                                    parsed = JSONCodec.loads(txt)
                                    fn_name = parsed.get('name')
                                    fn_args = parsed.get('arguments', {})
                                    available_tools = metadata.get('tools', {})
                                    matched_name = None
                                    if fn_name == 'datadog':
                                        fn_name = 'get_datadog_trace'
                                    if fn_name in available_tools:
                                        matched_name = fn_name
                                    else:
                                        for t_name in available_tools.keys():
                                            if t_name.endswith(f"_{fn_name}") or t_name == fn_name:
                                                matched_name = t_name
                                                break
                                    if matched_name and isinstance(fn_args, dict):
                                        # Auto-fix: Datadog trace_id requer 32 hex chars (adicionar zero à esquerda se tiver 31)
                                        if 'trace_id' in fn_args and isinstance(fn_args['trace_id'], str):
                                            tid = fn_args['trace_id'].strip()
                                            if len(tid) == 31:
                                                fn_args['trace_id'] = '0' + tid
                                        c_id = output_id('fc')
                                        tc = {
                                            'id': c_id,
                                            'index': 0,
                                            'function': {
                                                'name': matched_name,
                                                'arguments': JSONCodec.dumps(fn_args)
                                            }
                                        }
                                        response_tool_calls.append(tc)
                                        tool_calls.append(_split_tool_calls([tc]))
                                        output.pop()
                                        output.append({
                                            'type': 'function_call',
                                            'id': c_id,
                                            'call_id': c_id,
                                            'name': matched_name,
                                            'arguments': JSONCodec.dumps(fn_args),
                                            'status': 'completed'
                                        })
                                except Exception as e:
                                    log.debug(f"Falha ao extrair tool_call de texto cru: {e}")
                    # --- END QWEN TEXT TOOL-CALL EXTRACTION PATCH ---

""" + target_str

code = code.replace(target_str, patch_code, 1)

with open(target, "w", encoding="utf-8") as f:
    f.write(code)

print("Patch atualizado com sucesso no middleware.py")
