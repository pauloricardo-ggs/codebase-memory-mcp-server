import sqlite3
import json
import re

db_path = "/app/backend/data/webui.db"
conn = sqlite3.connect(db_path)
c = conn.cursor()

# 1. Conhecimento compartilhado
knowledge_biz = {
    'id': 'ae6bcc64-853f-4bcd-b86c-5257b0a471f6',
    'name': 'Claps Business Knowledge',
    'type': 'collection',
    'description': 'Base de conhecimento dos arquivos de negócio do claps'
}
knowledge_api = {
    'id': '2d509eb3-9581-4735-bccf-313ac344b51e',
    'name': 'Claps API Docs',
    'type': 'collection',
    'description': 'Base de conhecimento dos arquivos de API do claps'
}

claps_full_knowledge = """
======================================================================
BASE CONCEITUAL E ARQUITETURAL DO SISTEMA CLAPS (MA9)
======================================================================
O Claps é a plataforma central de gestão, parametrização e distribuição de seguros e assistências da MA9.
Ele atua como o núcleo operacional e transacional integrando seguradoras/fornecedores parceiros, redes e canais de distribuição, clientes segurados e a infraestrutura financeira e operacional de backoffice.

1. ARQUITETURA DOS MÓDULOS DO CLAPS:
- Gestor Claps (Backoffice e Catálogo Central):
  * Parametrização ágil e dinâmica de produtos de seguros (Prestamista PJ/PF, Acidentes Pessoais - AP, Residencial - RE, Vida em Grupo/Individual, Multirrisco Rural e Penhor Rural) e assistências (Dr. Online/Telemedicina, Saúde Benemed, Odontologia ArtyOdonto/Odontoprev, Assistência Funeral e Residencial 24h).
  * Configuração de tabelas de vigência, prêmio líquido, coberturas, franquias, carências e capitais segurados.
- Força de Venda e Rede de Distribuição:
  * Estrutura hierárquica e multinível de canais parceiros (correspondentes bancários, corretores, redes de agências Banese, rede Banestes, plataformas corporativas).
  * Alçadas de venda configuráveis, split de pagamentos e motor de cálculo de comissionamento automático em tempo real.
  * Portais de venda assistida de balcão e jornadas digitais de autocontratação com checkout responsivo.
- Cobrança e Arrecadação Integrada (Gateway PagueOn):
  * Integração nativa e idempotente com o PagueOn via APIs REST e webhooks para PIX dinâmico (com liquidação e conciliação instantânea), boleto bancário registrado e cartão de crédito recorrente (tokenizado sem comprometer o limite total do segurado).
- Gestão do Ciclo de Vida e Contratos:
  * Máquina de estados do contrato: Rascunho -> Proposta Submetida -> Aguardando Cobrança -> Vigente/Ativo -> Inadimplente -> Suspenso -> Cancelado/Encerrado.
  * Automação de réguas de cobrança preventiva, suspensão temporária e cancelamento regulamentar.
- Integrações e Barramento de Serviços:
  * Integração bilateral com bancos e parceiros estipulantes (Banese, Banestes).
  * Integração com seguradoras parceiras (Zurich Seguros, Mapfre) para envio de propostas, emissão de apólices e controle de sinistros.
  * Integração com operadoras de saúde e assistências (Benemed, ArtyOdonto, Odontoprev).

2. FLUXO OPERACIONAL DE PONTA A PONTA (PASSO A PASSO):
- Passo 1 (Parametrização): O gestor configura o produto no Claps, definindo fornecedor, coberturas, vigência, preço e regras de comissionamento para cada canal.
- Passo 2 (Distribuição e Venda): O canal de venda (corretor, correspondente ou link digital) acessa o catálogo e simula a proposta para o cliente.
- Passo 3 (Adesão e Emissão): Coleta de dados do proponente, validação de elegibilidade e conformidade regulamentar, geração da proposta/certificado e emissão do contrato.
- Passo 4 (Arrecadação via PagueOn): O Claps gera a cobrança via gateway PagueOn (PIX, cartão ou boleto). Ao liquidar, o PagueOn envia webhook autenticado confirmando o pagamento.
- Passo 5 (Ativação e Vigência): O contrato transita para o status "Ativo/Vigente", liberando certificados, carteirinhas e o acionamento de assistências.
- Passo 6 (Faturamento e Split de Comissões): O sistema calcula a remuneração dos canais de acordo com a tabela cadastrada e realiza a conciliação contábil e repasse.
- Passo 7 (Régua de Cobrança e Inadimplência): Na recorrência mensal/anual, o PagueOn processa as cobranças automáticas. Em caso de falha, são disparadas notificações preventivas e tentativas automáticas. Permanecendo o não pagamento, o contrato é suspenso e posteriormente cancelado por inadimplência.
- Passo 8 (Cancelamento e Encerramento): Realizado a pedido do segurado ou por encerramento de vigência/inadimplência, com baixa no sistema e aviso às operadoras.

======================================================================
ROBUSTEZ FONÉTICA E CORREÇÃO DE DIGITAÇÃO / STT
======================================================================
Trate de forma 100% transparente variações fonéticas e erros comuns de digitação/transcrição:
- "lcpas", "calps", "clpas", "cleps", "clepes", "clapse", "clubs", "klaps", "lpas" → Compreenda imediatamente como **Claps**.
- "pagueno", "pague on", "pagão", "pague um", "pagueom" → Compreenda imediatamente como **PagueOn**.
- "m a 9", "eme a nove", "m a nove", "ma nove" → Compreenda imediatamente como **MA9**.
- "datadogue", "data dog", "dado dog" → Compreenda imediatamente como **Datadog**.
- "arte odonto", "art odonto", "arti odonto" → Compreenda imediatamente como **ArtyOdonto**.
- "bene med", "benemedi", "bene médico" → Compreenda imediatamente como **Benemed**.
- "banesi", "banes", "banéze" → Compreenda imediatamente como **Banese**.
- "baneste", "banest" → Compreenda imediatamente como **Banestes**.

REGRA DE CONDUTA: NUNCA corrija a grafia do usuário, NUNCA diga que ele digitou ou pronunciou errado. Responda diretamente e com naturalidade utilizando a grafia canônica oficial ("Claps", "MA9", "PagueOn", "Datadog").

======================================================================
DIRETRIZ MANDATÓRIA DE COMUNICAÇÃO: SÍNTESE E DETALHAMENTO
======================================================================
1. RESPOSTA DIRETA E OBJETIVA POR PADRÃO:
   - Por padrão, responda de forma concisa, objetiva e direta ao ponto em todas as mensagens.
   - Entregue a resposta central imediatamente.

2. DIRETRIZ DE AVISO DE SÍNTESE:
   - Apenas na PRIMEIRA resposta da conversa (Turno 1) é permitido incluir uma breve nota de que você responderá de forma resumida por padrão.
   - Em TODAS as respostas seguintes (Turno 2 em diante): É TERMINANTEMENTE PROIBIDO incluir qualquer aviso, nota entre parênteses, mensagem de síntese ou oferta de detalhamento ao final. Responda de forma 100% limpa e direta.

3. ATENDIMENTO IMEDIATO A PEDIDOS DE DETALHAMENTO:
   - Quando o usuário solicitar "detalhe", "detalhe mais", "explique melhor", "como funciona", "passo a passo", "mais detalhes" ou pedir aprofundamento:
     É TERMINANTEMENTE PROIBIDO repetir a resposta anterior resumida ou listar apenas tópicos superficiais!
     Você DEVE aprofundar explicando a arquitetura dos módulos do Claps, o funcionamento do ciclo de vida dos contratos passo a passo de ponta a ponta, as integrações com PagueOn e operadoras parceiras, e as regras de negócio com riqueza de detalhes e clareza.

4. TELEMETRIA E LOGS DO DATADOG:
   - Quando o usuário perguntar sobre erros ou logs do Datadog e os dados forem fornecidos pelo MCP ou no contexto, analise e liste os erros de forma clara (serviço, horário, mensagem, quantidade/recorrência e criticidade), sugerindo os pontos de atenção. Se não houver erros no período, declare explicitamente que nenhum erro foi registrado. NUNCA diga "Não sei" quando houver dados ou integração disponível.
"""

def clean_and_update(sys_prompt):
    sys_prompt = re.sub(r'={10,}\s*VISÃO GERAL E ARQUITETURA.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*VISÃO GERAL E REGRAS DE NEGÓCIO.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*BASE CONCEITUAL.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*ROBUSTEZ FONÉTICA.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*DIRETRIZ MANDATÓRIA DE COMUNICAÇÃO.*?$', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'O Claps é a plataforma central de gestão e distribuição de seguros.*?redes de prestadores 24h\.\n*', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'O Claps é a plataforma central de gestão e distribuição de seguros.*?redes de assistência técnica/emergencial\.\n*', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'\s*\*?\s*\(\s*(?:Responderei|Resumi|Vou responder)[^)]*\)\s*\*?\s*', '', sys_prompt)
    return sys_prompt.strip() + "\n\n" + claps_full_knowledge.strip()

# Atualizar claps-business
r_biz = c.execute("SELECT meta, params FROM model WHERE id = 'claps-business'").fetchone()
if r_biz:
    meta = json.loads(r_biz[0]) if r_biz[0] else {}
    params = json.loads(r_biz[1]) if r_biz[1] else {}
    
    meta['knowledge'] = [knowledge_biz, knowledge_api]
    meta['toolIds'] = ['server:mcp:mcp-datadog']
    params['repeat_penalty'] = 1.15
    params['system'] = clean_and_update(params.get('system', ''))
    
    c.execute("UPDATE model SET meta = ?, params = ? WHERE id = 'claps-business'", (json.dumps(meta), json.dumps(params)))
    print("claps-business atualizado com sucesso!")

# Atualizar claps-code
r_code = c.execute("SELECT meta, params FROM model WHERE id = 'claps-code'").fetchone()
if r_code:
    meta = json.loads(r_code[0]) if r_code[0] else {}
    params = json.loads(r_code[1]) if r_code[1] else {}
    
    meta['knowledge'] = [knowledge_biz, knowledge_api]
    meta['toolIds'] = ['server:mcp:mcp-claps', 'server:mcp:mcp-datadog']
    params['repeat_penalty'] = 1.15
    params['system'] = clean_and_update(params.get('system', ''))
    
    c.execute("UPDATE model SET meta = ?, params = ? WHERE id = 'claps-code'", (json.dumps(meta), json.dumps(params)))
    print("claps-code atualizado com sucesso!")

conn.commit()
conn.close()
print("Banco atualizado com sucesso!")
