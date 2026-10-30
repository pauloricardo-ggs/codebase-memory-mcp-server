import re, sys, os

target = "/app/backend/open_webui/utils/middleware.py"
if not os.path.exists(target):
    print(f"Target {target} does not exist", file=sys.stderr)
    sys.exit(1)

with open(target, "r", encoding="utf-8") as f:
    code = f.read()

# Remover versão anterior de patches se existirem
for marker in (
    "# --- QWEN TEXT TOOL-CALL EXTRACTION PATCH ---",
    "# --- DATADOG TOOL PARAMS AUTO-FIX ---",
    "# --- TURN NOTICE MANAGEMENT PATCH ---",
    "# --- RAG FOLLOWUP QUERY EXPANSION PATCH ---"
):
    if marker in code:
        end_marker = marker.replace("---", "--- END")
        code = re.sub(re.escape(marker) + r".*?" + re.escape(end_marker) + r"\n*", "", code, flags=re.DOTALL)

# 1. Patch de Extração de Tool Call de Texto (Qwen)
target_str1 = "                    # Responses API path: extract function_call items from output"
if target_str1 in code:
    patch_code1 = r"""                    # --- QWEN TEXT TOOL-CALL EXTRACTION PATCH ---
                    if not response_tool_calls and output and metadata.get('tools'):
                        last_msg = output[-1] if output and output[-1].get('type') == 'message' else None
                        if last_msg:
                            parts = last_msg.get('content', [])
                            txt = ""
                            if parts and parts[-1].get('type') == 'output_text':
                                txt = parts[-1].get('text', '').strip()
                            match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', txt, re.DOTALL)
                            if match:
                                txt_candidate = match.group(1).strip()
                            elif txt.startswith('{') and txt.endswith('}'):
                                txt_candidate = txt.strip()
                            else:
                                txt_candidate = ""
                            if txt_candidate.startswith('{') and txt_candidate.endswith('}'):
                                try:
                                    parsed = JSONCodec.loads(txt_candidate)
                                    fn_name = parsed.get('name')
                                    fn_args = parsed.get('arguments', {})
                                    available_tools = metadata.get('tools', {})
                                    matched_name = None
                                    if fn_name == 'datadog':
                                        fn_name = 'get_datadog_trace'
                                    elif fn_name in ('list_datadog_logs', 'get_datadog_logs', 'datadog_logs'):
                                        fn_name = 'search_datadog_logs'
                                    if fn_name in available_tools:
                                        matched_name = fn_name
                                    else:
                                        for t_name in available_tools.keys():
                                            if t_name.endswith(f"_{fn_name}") or t_name == fn_name:
                                                matched_name = t_name
                                                break
                                    if matched_name and isinstance(fn_args, dict):
                                        if 'datadog' in matched_name and 'telemetry' not in fn_args:
                                            fn_args['telemetry'] = {'intent': 'Execute observability tool query'}
                                        if 'datadog' in matched_name and 'query' in fn_args and isinstance(fn_args['query'], str):
                                            import re as _dd_q_re
                                            fn_args['query'] = _dd_q_re.sub(r'@error(?:\.\*|\b)', 'status:error', fn_args['query'])
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
""" + target_str1
    code = code.replace(target_str1, patch_code1, 1)

# 2. Patch de Parâmetros Datadog em execute_tool_call_for_output
target_str2 = "    params = {key: value for key, value in params.items() if key in allowed_params}"
if target_str2 in code:
    patch_code2 = target_str2 + r"""
    # --- DATADOG TOOL PARAMS AUTO-FIX ---
    if 'datadog' in name:
        if 'telemetry' not in params or not params['telemetry']:
            params['telemetry'] = {'intent': 'Execute observability tool query'}
        if 'query' in params and isinstance(params['query'], str):
            import re as _dd_re
            params['query'] = _dd_re.sub(r'@error(?:\.\*|\b)', 'status:error', params['query'])
        if 'trace_id' in params and isinstance(params['trace_id'], str):
            _tid = params['trace_id'].strip()
            if len(_tid) == 31:
                params['trace_id'] = '0' + _tid
    # --- END DATADOG TOOL PARAMS AUTO-FIX ---"""
    code = code.replace(target_str2, patch_code2, 1)

# 3. Patch de Expansão de Busca RAG para Perguntas de Detalhamento
target_str3 = """        if len(queries) == 0:
            queries = [get_last_user_message(body['messages']) or '']"""
if target_str3 in code:
    patch_code3 = r"""        # --- RAG FOLLOWUP QUERY EXPANSION PATCH ---
        if len(queries) == 0:
            last_msg = get_last_user_message(body['messages']) or ''
            user_msgs = [m.get('content', '') for m in body.get('messages', []) if m.get('role') == 'user' and isinstance(m.get('content'), str)]
            if len(user_msgs) > 1 and len(last_msg.split()) <= 6:
                prev_user_msg = user_msgs[-2]
                queries = [f"{prev_user_msg} {last_msg}".strip(), last_msg]
            else:
                queries = [last_msg]
        # --- END RAG FOLLOWUP QUERY EXPANSION PATCH ---"""
    code = code.replace(target_str3, patch_code3, 1)

# 4. Patch de Gerenciamento de Aviso de Turno em process_chat_payload
target_str4 = "    # Pipeline Inlet -> Filter Inlet -> Chat Memory -> Chat Web Search -> Chat Image Generation"
if target_str4 in code:
    patch_code4 = r"""    # --- TURN NOTICE MANAGEMENT PATCH ---
    try:
        import re as _notice_re
        _notice_pat = _notice_re.compile(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?\s*$', _notice_re.IGNORECASE)
        _assistant_count = sum(1 for m in form_data.get('messages', []) if m.get('role') == 'assistant')
        for m in form_data.get('messages', []):
            if m.get('role') == 'assistant' and isinstance(m.get('content'), str):
                m['content'] = _notice_pat.sub('', m['content']).rstrip()

        for m in form_data.get('messages', []):
            if m.get('role') == 'system' and isinstance(m.get('content'), str):
                m['content'] = _notice_pat.sub('', m['content']).rstrip()
                if _assistant_count == 0:
                    m['content'] += '\n\n[DIRETRIZ DESTE TURNO]: Como esta é a PRIMEIRA resposta da conversa, responda resumido e inclua ao final a nota padrão: "*(Responderei de forma resumida e direta por padrão. Se em algum ponto desejar mais detalhes, causa raiz, impacto ou passo a passo, é só pedir!)*".'
                else:
                    m['content'] += '\n\n[DIRETRIZ DESTE TURNO]: Esta NÃO é a primeira resposta da conversa (Turno posterior). É TERMINANTEMENTE PROIBIDO incluir qualquer aviso de síntese ou nota entre parênteses ao final. Se o usuário pediu detalhamento, explique detalhadamente em profundidade.'
                break
    except Exception as _e:
        log.debug(f"Erro ao gerenciar aviso de turno: {_e}")
    # --- END TURN NOTICE MANAGEMENT PATCH ---
""" + target_str4
    code = code.replace(target_str4, patch_code4, 1)

with open(target, "w", encoding="utf-8") as f:
    code = f.write(code)

print("Patch atualizado com sucesso no middleware.py")
