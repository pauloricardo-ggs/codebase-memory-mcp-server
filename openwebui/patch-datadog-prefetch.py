import re, sys, os

target = sys.argv[1] if len(sys.argv) > 1 else "/app/backend/open_webui/utils/middleware.py"
with open(target, encoding="utf-8") as f:
    code = f.read()

marker = "# --- DATADOG PREFETCH PATCH ---"
end_marker = "# --- END DATADOG PREFETCH PATCH ---"
if marker in code:
    code = re.sub(r"\n *" + re.escape(marker) + r".*?" + re.escape(end_marker), "", code, flags=re.DOTALL)

# 1. Fallback para carregar toolIds configurados no modelo quando não passados explicitamente
anchor_tools = "        # Server side tools\n        tool_ids = metadata.get('tool_ids', None)\n"
patch_tools = anchor_tools + "        if not tool_ids and model:\n            tool_ids = (model.get('info', {}).get('meta', {}) or {}).get('toolIds', None)\n"
if anchor_tools in code and "if not tool_ids and model:" not in code:
    code = code.replace(anchor_tools, patch_tools, 1)

# 2. Prefetch do Datadog
anchor = "            metadata['tools'] = tools_dict\n"
if code.count(anchor) != 1:
    print("Anchor not found", file=sys.stderr)
    sys.exit(1)

patch = anchor + r'''            # --- DATADOG PREFETCH PATCH ---
            try:
                _dd_last = (get_last_user_message(form_data.get('messages', [])) or '').lower()
                _dd_tool = next((n for n in tools_dict if n.endswith('search_datadog_logs')), None)
                if _dd_tool and re.search(r'datadog|data dog|datadogue|\blogs?\b|erros? (registrad|em produ|do sistema|recentes|de hoje|da última|da ultima)|últimos erros|ultimos erros|log de erro', _dd_last):
                    _dd_from = 'now-1h'
                    _m = re.search(r'(\d+)\s*(minuto|min|hora|h\b|dia)', _dd_last)
                    if _m:
                        _n = int(_m.group(1)); _u = _m.group(2)
                        _dd_from = f'now-{_n}m' if _u.startswith('min') else (f'now-{_n}d' if _u.startswith('dia') else f'now-{_n}h')
                    elif 'hoje' in _dd_last:
                        _dd_from = 'now-24h'
                    elif 'ontem' in _dd_last:
                        _dd_from = 'now-48h'
                    elif 'semana' in _dd_last:
                        _dd_from = 'now-7d'
                    _dd_query = 'status:error'
                    _svc = re.search(r'servi[cç]o\s+([\w\-\.]+)', _dd_last)
                    if _svc:
                        _dd_query += f' service:{_svc.group(1)}'
                    if event_emitter:
                        await event_emitter({'type': 'status', 'data': {'description': f'Consultando Datadog ({_dd_query}, {_dd_from})...', 'done': False}})
                    _dd_result = await tools_dict[_dd_tool]['callable'](
                        query=_dd_query,
                        **{'from': _dd_from},
                        to='now',
                        telemetry={'intent': 'Listar erros recentes solicitados pelo usuário'},
                    )
                    _dd_text = _dd_result if isinstance(_dd_result, str) else JSONCodec.dumps(_dd_result)
                    if len(_dd_text) > 12000:
                        _dd_text = _dd_text[:12000] + '\n...[truncado]'
                    form_data['messages'] = add_or_update_system_message(
                        '<datadog_resultado>\n'
                        f'Consulta executada automaticamente no Datadog: query="{_dd_query}" from={_dd_from} to=now.\n'
                        f'{_dd_text}\n'
                        '</datadog_resultado>\n'
                        'INSTRUÇÃO MANDATÓRIA: A consulta ao Datadog JÁ FOI EXECUTADA e o resultado com os logs reais de produção está acima. '
                        'NÃO diga "Não sei", NÃO diga que não tem integração e NÃO gere código ou JSON de chamada de ferramenta. Responda diretamente em português do Brasil '
                        'listando os erros encontrados (serviço, horário, mensagem, quantidade/recorrência) '
                        'agrupados por serviço, e aponte os mais críticos. Se o resultado estiver vazio, diga '
                        'explicitamente que não houve erros no período consultado.',
                        form_data['messages'],
                        append=True,
                    )
                    metadata['datadog_prefetched'] = True
                    if event_emitter:
                        await event_emitter({'type': 'status', 'data': {'description': 'Datadog consultado', 'done': True}})
            except Exception as _dd_e:
                log.exception(f'Datadog prefetch falhou: {_dd_e}')
            # --- END DATADOG PREFETCH PATCH ---
'''
code = code.replace(anchor, patch, 1)

# Se o Datadog prefetch rodou, evitar chamar chat_completion_tools_handler repetidamente
anchor_legacy = "if metadata.get('params', {}).get('function_calling') != 'legacy':"
patch_legacy = "if metadata.get('datadog_prefetched'):\n                pass\n            elif metadata.get('params', {}).get('function_calling') != 'legacy':"
if anchor_legacy in code and "metadata.get('datadog_prefetched')" not in code:
    code = code.replace(anchor_legacy, patch_legacy, 1)

if not re.search(r"^import re\b|^import re$", code, re.M):
    code = "import re\n" + code

with open(target, "w", encoding="utf-8") as f:
    f.write(code)
print("Datadog prefetch patch aplicado com sucesso!")
