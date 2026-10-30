import re, sys, os

target = sys.argv[1] if len(sys.argv) > 1 else "/app/backend/open_webui/utils/middleware.py"
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
    "# --- RAG FOLLOWUP QUERY EXPANSION PATCH ---",
    "# --- MCP & MULTI-FORMAT TOOL CALL RESOLUTION ---",
    "# --- TYPO & PHONETIC NORMALIZATION PATCH ---"
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

# 2. Patch de tool_call_handler em chat_completion_tools_handler
anchor_tch = """                tool_function_name = tool_call.get('name', None)
                if tool_function_name not in tools:
                    log.warning(f'Tool "{tool_function_name}" not found')
                    return

                tool_function_params = tool_call.get('parameters', {})"""

patch_tch = r"""                # --- MCP & MULTI-FORMAT TOOL CALL RESOLUTION ---
                tool_function_name = tool_call.get('name') or tool_call.get('function', {}).get('name')
                if tool_function_name:
                    if tool_function_name in ('datadog', 'datadog_logs', 'list_datadog_logs', 'get_datadog_logs'):
                        tool_function_name = 'search_datadog_logs'
                    if tool_function_name not in tools:
                        matched = next((k for k in tools if k == tool_function_name or k.endswith(f"_{tool_function_name}") or tool_function_name in k), None)
                        if matched:
                            tool_function_name = matched

                if not tool_function_name or tool_function_name not in tools:
                    log.warning(f'Tool "{tool_function_name}" not found')
                    return

                tool_function_params = tool_call.get('parameters')
                if tool_function_params is None:
                    tool_function_params = tool_call.get('arguments')
                if tool_function_params is None:
                    tool_function_params = tool_call.get('function', {}).get('arguments')
                if tool_function_params is None:
                    tool_function_params = {}
                if isinstance(tool_function_params, str):
                    try:
                        tool_function_params = JSONCodec.loads(tool_function_params)
                    except Exception:
                        tool_function_params = {}
                if not isinstance(tool_function_params, dict):
                    tool_function_params = {}

                # Datadog auto-sanitization
                if 'datadog' in tool_function_name:
                    if 'telemetry' not in tool_function_params or not tool_function_params['telemetry']:
                        tool_function_params['telemetry'] = {'intent': 'Execute observability tool query'}
                    if 'query' in tool_function_params and isinstance(tool_function_params['query'], str):
                        import re as _dd_q_re
                        tool_function_params['query'] = _dd_q_re.sub(r'@error(?:\.\*|\b)', 'status:error', tool_function_params['query'])
                        if not tool_function_params['query'].strip():
                            tool_function_params['query'] = 'status:error'
                    else:
                        tool_function_params['query'] = 'status:error'
                    if 'from' not in tool_function_params or not tool_function_params['from']:
                        tool_function_params['from'] = 'now-1h'
                    if 'to' not in tool_function_params or not tool_function_params['to']:
                        tool_function_params['to'] = 'now'
                    if 'trace_id' in tool_function_params and isinstance(tool_function_params['trace_id'], str):
                        _tid = tool_function_params['trace_id'].strip()
                        if len(_tid) == 31:
                            tool_function_params['trace_id'] = '0' + _tid
                # --- END MCP & MULTI-FORMAT TOOL CALL RESOLUTION ---"""

if anchor_tch in code:
    code = code.replace(anchor_tch, patch_tch, 1)

# 3. Patch de Parâmetros Datadog em execute_tool_call_for_output
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

# 4. Patch de Expansão de Busca RAG para Perguntas de Detalhamento
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

# 5. Patch de Normalização Fonética e de Digitação (lcpas -> Claps) em process_chat_payload
target_str4 = "    # Pipeline Inlet -> Filter Inlet -> Chat Memory -> Chat Web Search -> Chat Image Generation"
if target_str4 in code:
    patch_code4 = r"""    # --- TYPO & PHONETIC NORMALIZATION PATCH ---
    try:
        import re as _typo_re
        for _m in form_data.get('messages', []):
            if _m.get('role') == 'user':
                _c = _m.get('content')
                if isinstance(_c, str):
                    _c = _typo_re.sub(r'\b(lcpas|calps|clpas|cleps|clepes|clapse|clubs)\b', 'Claps', _c, flags=_typo_re.IGNORECASE)
                    _c = _typo_re.sub(r'\b(pagueno|pague on|pagão|pague um|pagueom)\b', 'PagueOn', _c, flags=_typo_re.IGNORECASE)
                    _c = _typo_re.sub(r'\b(datadogue|data dog|dado dog)\b', 'Datadog', _c, flags=_typo_re.IGNORECASE)
                    _m['content'] = _c
                elif isinstance(_c, list):
                    for _part in _c:
                        if isinstance(_part, dict) and _part.get('type') == 'text' and isinstance(_part.get('text'), str):
                            _t = _part['text']
                            _t = _typo_re.sub(r'\b(lcpas|calps|clpas|cleps|clepes|clapse|clubs)\b', 'Claps', _t, flags=_typo_re.IGNORECASE)
                            _t = _typo_re.sub(r'\b(pagueno|pague on|pagão|pague um|pagueom)\b', 'PagueOn', _t, flags=_typo_re.IGNORECASE)
                            _t = _typo_re.sub(r'\b(datadogue|data dog|dado dog)\b', 'Datadog', _t, flags=_typo_re.IGNORECASE)
                            _part['text'] = _t
    except Exception as _e:
        log.debug(f"Erro em typo normalization patch: {_e}")
    # --- END TYPO & PHONETIC NORMALIZATION PATCH ---
""" + target_str4
    code = code.replace(target_str4, patch_code4, 1)

with open(target, "w", encoding="utf-8") as f:
    f.write(code)

print("Patch atualizado com sucesso no middleware.py")
