import re, sys, os

# 1. Patch de payload.py (apply_system_prompt_to_body)
target_payload = "/app/backend/open_webui/utils/payload.py"
if os.path.exists(target_payload):
    with open(target_payload, "r", encoding="utf-8") as f:
        code_p = f.read()

    anchor = """async def apply_system_prompt_to_body(
    system: Optional[str],
    form_data: dict,
    metadata: Optional[dict] = None,
    user=None,
    replace: bool = False,
) -> dict:
    system = await resolve_system_prompt(system, metadata, user)
    if not system:
        return form_data"""

    if "# --- TURN NOTICE AND DETAIL MANAGEMENT PATCH ---" in code_p:
        code_p = re.sub(r" *# --- TURN NOTICE AND DETAIL MANAGEMENT PATCH ---.*?# --- END TURN NOTICE AND DETAIL MANAGEMENT PATCH ---\n*", "", code_p, flags=re.DOTALL)

    patch_p = r'''async def apply_system_prompt_to_body(
    system: Optional[str],
    form_data: dict,
    metadata: Optional[dict] = None,
    user=None,
    replace: bool = False,
) -> dict:
    system = await resolve_system_prompt(system, metadata, user)
    if not system:
        return form_data

    # --- TURN NOTICE AND DETAIL MANAGEMENT PATCH ---
    try:
        import re as _notice_re

        def _get_text(m):
            c = m.get('content')
            if isinstance(c, str):
                return c
            if isinstance(c, list):
                for part in c:
                    if isinstance(part, dict) and part.get('type') in ('text', 'output_text'):
                        return part.get('text', '')
            return ''

        def _set_text(m, new_t):
            c = m.get('content')
            if isinstance(c, list):
                found = False
                for part in c:
                    if isinstance(part, dict) and part.get('type') in ('text', 'output_text'):
                        part['text'] = new_t
                        found = True
                        break
                if not found:
                    m['content'] = new_t
            else:
                m['content'] = new_t

        _notice_pat = _notice_re.compile(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?', _notice_re.IGNORECASE)
        
        # 1. Preservar blocos dinâmicos gerados em middleware (como <datadog_resultado>)
        _dd_block = ''
        if form_data.get('messages'):
            for _msg in form_data['messages']:
                if _msg.get('role') == 'system':
                    _stxt = _get_text(_msg)
                    _mdd = _notice_re.search(r'(<datadog_resultado>.*?</datadog_resultado>.*)', _stxt, _notice_re.DOTALL)
                    if _mdd:
                        _dd_block = '\n\n' + _mdd.group(1).strip()
                        break

        # 2. Limpar avisos das respostas anteriores do assistente para nao enviesar o modelo
        for m in form_data.get('messages', []):
            if m.get('role') == 'assistant':
                _t = _get_text(m)
                if _t:
                    _set_text(m, _notice_pat.sub('', _t).rstrip())

        _assistant_count = sum(1 for m in form_data.get('messages', []) if m.get('role') == 'assistant')
        
        # 3. Limpar qualquer aviso estatico residual do system prompt
        system = _notice_pat.sub('', system).rstrip()

        # 4. Detectar se o usuario pediu detalhamento na ultima mensagem
        _last_user_msg = ''
        for m in reversed(form_data.get('messages', [])):
            if m.get('role') == 'user':
                _last_user_msg = _get_text(m).lower()
                break
        
        _is_detail_request = any(w in _last_user_msg for w in [
            'detalhe', 'detalhar', 'detalhes', 'aprofunde', 'aprofundar', 'explique melhor',
            'como funciona', 'mais detalhes', 'passo a passo', 'fluxo', 'explorar em maior profundidade'
        ])

        # 5. Injetar diretriz contextual de turno
        if _assistant_count == 0:
            system += '\n\n[DIRETRIZ DESTE TURNO]: Como esta e a PRIMEIRA resposta da conversa, responda de forma concisa e direta por padrao e inclua ao final a nota padrao: "*(Responderei de forma resumida e direta por padrao. Se em algum ponto desejar mais detalhes, causa raiz, impacto ou passo a passo, e so pedir!)*".'
        else:
            if _is_detail_request:
                _msgs = form_data.get('messages', [])
                _prev_q = ''
                _last_user_idx = max(i for i, m in enumerate(_msgs) if m.get('role') == 'user')
                for i in range(_last_user_idx - 1, -1, -1):
                    if _msgs[i].get('role') == 'user':
                        _prev_q = _get_text(_msgs[i])
                        if _prev_q:
                            break
                for i in range(_last_user_idx):
                    if _msgs[i].get('role') == 'assistant':
                        _set_text(_msgs[i], '[Visão geral resumida já entregue ao usuário. NÃO a repita.]')

                _orig_user_text = _get_text(_msgs[_last_user_idx])
                _set_text(_msgs[_last_user_idx], (
                    f'Aprofunde e explique em detalhes o tema "{_prev_q}" (solicitação do usuário: "{_orig_user_text}"). '
                    'O usuário JÁ leu a visão geral básica em 4 tópicos; É TERMINANTEMENTE PROIBIDO repetir a lista dos 4 pilares resumidos ou frases já ditas! '
                    'Entregue uma explicação aprofundada, estruturada em seções com títulos: '
                    '(1) Arquitetura dos módulos do Claps (Gestor Claps, Cobrança, Contratos, Força de Vendas, Integrações); '
                    '(2) Fluxo operacional de ponta a ponta passo a passo (parametrização do produto -> distribuição para canais e corretores -> cotação e emissão -> adesão digital -> cobrança e arrecadação via PagueOn com PIX/boleto/cartão recorrente -> régua de cobrança automática e conciliação -> split e repasse de comissões -> pós-venda e cancelamento); '
                    '(3) Regras de negócio, responsabilidades dos atores (MA9, fornecedores, força de vendas, segurado) e integrações homologadas. '
                    'NÃO inclua nenhum aviso entre parênteses ao final.'
                ))
                system += '\n\n[DIRETRIZ DESTE TURNO - DETALHAMENTO OBRIGATORIO]: O usuario pediu para detalhar. E TERMINANTEMENTE PROIBIDO repetir a resposta anterior resumida ou listar apenas topicos superficiais! Explique detalhadamente e em profundidade cada modulo, o fluxo operacional de ponta a ponta e todas as regras de negocio. E TERMINANTEMENTE PROIBIDO incluir qualquer aviso ou nota entre parenteses ao final.'
            else:
                system += '\n\n[DIRETRIZ DESTE TURNO]: Esta NAO e a primeira resposta da conversa (Turno posterior). E TERMINANTEMENTE PROIBIDO incluir qualquer aviso de sintese, nota entre parenteses ou oferta de detalhamento ao final.'

        if _dd_block:
            system += _dd_block
    except Exception as _e:
        log.debug(f"Erro em turn notice patch: {_e}")
    # --- END TURN NOTICE AND DETAIL MANAGEMENT PATCH ---'''

    if anchor in code_p:
        code_p = code_p.replace(anchor, patch_p, 1)
        with open(target_payload, "w", encoding="utf-8") as f:
            f.write(code_p)
        print("Payload patched successfully!")

# 2. Patch de middleware.py (garantir remoção pós-geração nas respostas de turnos posteriores)
target_middleware = "/app/backend/open_webui/utils/middleware.py"
if os.path.exists(target_middleware):
    with open(target_middleware, "r", encoding="utf-8") as f:
        code_m = f.read()

    # Remover patches de strip de resposta anteriores se existirem
    for mk in (
        "# --- POST-PROCESSING STRIP NOTICE NON-STREAMING ---",
        "# --- POST-PROCESSING STRIP NOTICE STREAMING ---"
    ):
        if mk in code_m:
            emk = mk.replace("---", "--- END")
            code_m = re.sub(re.escape(mk) + r".*?" + re.escape(emk) + r"\n*", "", code_m, flags=re.DOTALL)

    anchor_non_stream = "    response, response_data = get_response_data(response)\n    if response_data is None:\n        return response\n"
    patch_non_stream = anchor_non_stream + r'''
    # --- POST-PROCESSING STRIP NOTICE NON-STREAMING ---
    try:
        _ast_cnt = sum(1 for _m in ctx.get('form_data', {}).get('messages', []) if _m.get('role') == 'assistant')
        if _ast_cnt > 0 and isinstance(response_data, dict):
            import re as _np_re
            _pat = _np_re.compile(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?', _np_re.IGNORECASE)
            for _ch in response_data.get('choices', []):
                if 'message' in _ch and isinstance(_ch['message'].get('content'), str):
                    _ch['message']['content'] = _pat.sub('', _ch['message']['content']).rstrip()
    except Exception:
        pass
    # --- END POST-PROCESSING STRIP NOTICE NON-STREAMING ---
'''
    if anchor_non_stream in code_m:
        code_m = code_m.replace(anchor_non_stream, patch_non_stream, 1)

    anchor_stream = "                current_output = full_output()\n"
    patch_stream = anchor_stream + r'''                # --- POST-PROCESSING STRIP NOTICE STREAMING ---
                try:
                    _ast_cnt = sum(1 for _m in ctx.get('form_data', {}).get('messages', []) if _m.get('role') == 'assistant')
                    if _ast_cnt > 0:
                        import re as _np_re
                        _pat = _np_re.compile(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?', _np_re.IGNORECASE)
                        for _it in current_output:
                            if _it.get('type') == 'message' and isinstance(_it.get('content'), list):
                                for _p in _it['content']:
                                    if _p.get('type') == 'output_text' and isinstance(_p.get('text'), str):
                                        _p['text'] = _pat.sub('', _p['text']).rstrip()
                except Exception:
                    pass
                # --- END POST-PROCESSING STRIP NOTICE STREAMING ---
'''
    if anchor_stream in code_m:
        code_m = code_m.replace(anchor_stream, patch_stream, 1)

    with open(target_middleware, "w", encoding="utf-8") as f:
        f.write(code_m)
    print("Middleware response post-processing patched successfully!")
