import re, sys, os

target = sys.argv[1] if len(sys.argv) > 1 else "/app/backend/open_webui/utils/payload.py"
if not os.path.exists(target):
    print(f"Target {target} does not exist", file=sys.stderr)
    sys.exit(1)

with open(target, "r", encoding="utf-8") as f:
    code = f.read()

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

if "# --- TURN NOTICE AND DETAIL MANAGEMENT PATCH ---" in code:
    code = re.sub(r" *# --- TURN NOTICE AND DETAIL MANAGEMENT PATCH ---.*?# --- END TURN NOTICE AND DETAIL MANAGEMENT PATCH ---\n*", "", code, flags=re.DOTALL)

patch = r'''async def apply_system_prompt_to_body(
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
        _notice_pat = _notice_re.compile(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?\s*$', _notice_re.IGNORECASE)
        
        # 1. Limpar avisos das respostas anteriores do assistente para nao enviesar o modelo
        for m in form_data.get('messages', []):
            if m.get('role') == 'assistant' and isinstance(m.get('content'), str):
                m['content'] = _notice_pat.sub('', m['content']).rstrip()

        _assistant_count = sum(1 for m in form_data.get('messages', []) if m.get('role') == 'assistant')
        
        # 2. Limpar qualquer aviso estatico residual do system prompt
        system = _notice_pat.sub('', system).rstrip()

        # 3. Detectar se o usuario pediu detalhamento na ultima mensagem
        _last_user_msg = ''
        for m in reversed(form_data.get('messages', [])):
            if m.get('role') == 'user' and isinstance(m.get('content'), str):
                _last_user_msg = m['content'].lower()
                break
        
        _is_detail_request = any(w in _last_user_msg for w in ['detalhe', 'explique melhor', 'como funciona', 'mais detalhes', 'aprofunde', 'detalhar', 'detalhes'])

        # 4. Injetar diretriz contextual de turno
        if _assistant_count == 0:
            system += '\n\n[DIRETRIZ DESTE TURNO]: Como esta e a PRIMEIRA resposta da conversa, responda resumido e inclua ao final a nota padrao: "*(Responderei de forma resumida e direta por padrao. Se em algum ponto desejar mais detalhes, causa raiz, impacto ou passo a passo, e so pedir!)*".'
        else:
            if _is_detail_request:
                # Remove a fonte de cópia: o modelo repetia literalmente a resposta anterior.
                _msgs = form_data.get('messages', [])
                _prev_q = ''
                _last_user_idx = max(i for i, m in enumerate(_msgs) if m.get('role') == 'user')
                for i in range(_last_user_idx - 1, -1, -1):
                    if _msgs[i].get('role') == 'user' and isinstance(_msgs[i].get('content'), str):
                        _prev_q = _msgs[i]['content']
                        break
                for i in range(_last_user_idx):
                    if _msgs[i].get('role') == 'assistant' and isinstance(_msgs[i].get('content'), str):
                        _msgs[i]['content'] = '[Resposta resumida já entregue ao usuário. NÃO a repita.]'
                _msgs[_last_user_idx]['content'] = (
                    f'Aprofunde o tema "{_prev_q}" (pedido original do usuário: "{_msgs[_last_user_idx]["content"]}"). '
                    'O usuário JÁ leu a visão geral em tópicos; NÃO repita a lista de pilares nem frases já ditas. '
                    'Entregue conteúdo NOVO e aprofundado: (1) como funciona passo a passo, de ponta a ponta, um fluxo real '
                    '(ex.: da criação do produto até a venda, adesão, cobrança via PagueOn, repasse de comissão e cancelamento); '
                    '(2) regras de negócio e responsabilidades de cada ator; (3) exemplos concretos e cenários; '
                    '(4) pontos de atenção/exceções. Use seções com títulos. Use a base de conhecimento quando houver.'
                )
                system += '\n\n[DIRETRIZ DESTE TURNO - DETALHAMENTO OBRIGATORIO]: O usuario pediu para detalhar. E TERMINANTEMENTE PROIBIDO repetir a resposta anterior resumida! Explique detalhadamente e em profundidade cada pilar, modulo, fluxo tecnico e regra de negocio, fornecendo exemplos concretos. NAO inclua nenhum aviso entre parenteses ao final.'
            else:
                system += '\n\n[DIRETRIZ DESTE TURNO]: Esta NAO e a primeira resposta da conversa (Turno posterior). E TERMINANTEMENTE PROIBIDO incluir qualquer aviso de sintese ou nota entre parenteses ao final.'
    except Exception as _e:
        log.debug(f"Erro em turn notice patch: {_e}")
    # --- END TURN NOTICE AND DETAIL MANAGEMENT PATCH ---'''

if anchor not in code:
    print(f"Anchor not found in {target}", file=sys.stderr)
    sys.exit(1)

code = code.replace(anchor, patch, 1)

with open(target, "w", encoding="utf-8") as f:
    f.write(code)

print("Payload patched successfully!")
