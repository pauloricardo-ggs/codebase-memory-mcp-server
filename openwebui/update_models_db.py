import sqlite3
import json

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

claps_code_architecture = """
======================================================================
VISÃO GERAL E ARQUITETURA TÉCNICA DO SISTEMA CLAPS
======================================================================
O Claps é a plataforma central de gestão e distribuição de seguros e assistências da MA9.
Arquitetura de Software e Stack Tecnológica:
- Arquitetura: Microsserviços orientados a eventos (EDA) seguindo Clean Architecture, DDD e CQRS.
- Backend: .NET 8 / C# com ASP.NET Core Web API, Entity Framework Core e Dapper para leituras otimizadas.
- Mensageria e Comunicação Assíncrona: RabbitMQ para orquestração de eventos assíncronos e mensageria idempotente (ex: ContratoCriadoEvent, PagamentoConfirmadoEvent, CancelamentoProcessadoEvent).
- Banco de Dados e Cache: PostgreSQL para persistência transacional de contratos e propostas; Redis para cache de tokens, sessões, tabelas de comissionamento e catálogo de produtos.
- Gateway de Pagamentos: Integração bilateral nativa e idempotente com o PagueOn via webhooks autenticados para processamento de PIX, Cartão de Crédito e Boleto com split de comissões automático.

Módulos e Domínios do Sistema:
1. Claps.Produto:
   - Parametrização dinâmica de regras de produtos de seguros e assistências (coberturas, capitais segurados, franquias, carências e vigências).
   - Acordos operacionais customizados por parceiro/fornecedor (ex: ArtyOdonto, Benemed).
2. Claps.ForcaVenda:
   - Estrutura hierárquica e multinível de canais de distribuição (distribuidores, corretores, pontos de venda).
   - Motor de cálculo de comissionamento flexível com regras de repasse e faturamento.
3. Claps.Contrato (Ciclo de Vida):
   - Máquina de estados finitos do contrato: Rascunho -> Proposta Submetida -> Aguardando Cobrança -> Vigente/Ativo -> Inadimplente -> Suspenso -> Cancelado/Encerrado.
   - Rotinas de backoffice automatizadas para arrecadação recorrente, suspensão preventiva e régua de cancelamento.
4. Claps.Integracao (Adaptadores Externos):
   - APIs de comunicação segura com operadoras parceiras (Banese, Banestes, Benemed, ArtyOdonto) e prestadoras de telemedicina e assistência 24h.
5. Observabilidade e Telemetria:
   - Instrumentado com Datadog (APM traces, logs estruturados com correlation IDs, métricas e error tracking).
"""

claps_biz_architecture = """
======================================================================
VISÃO GERAL E REGRAS DE NEGÓCIO DO SISTEMA CLAPS
======================================================================
O Claps é a plataforma central de gestão e distribuição de seguros e assistências da MA9.
Ele integra e automatiza os processos operacionais e de negócio em quatro pilares fundamentais:

1. FORNECEDORES E SEGURADORAS:
   - Criação e distribuição de produtos respeitando as condições impostas em acordos operacionais com parceiros.
   - Parametrização ágil de coberturas, capitais segurados, assistências (saúde, odontológica, veicular, residencial, funeral, telemedicina).
   - Painel completo com acompanhamento de distribuição e comissionamento flexível.

2. FORÇA DE VENDA:
   - Rede amplamente organizada e configurável de distribuição (corretores, parceiros corporativos e correspondentes).
   - Produtos customizáveis com preços altamente competitivos e condições diferenciadas.
   - Painel de vendas completo, suporte a checkout transparente e regras de comissionamento em tempo real.

3. SEGURADOS:
   - Produtos pensados e customizados para necessidades específicas pelo melhor preço de mercado.
   - Desburocratização de contratação, adesão digital ágil e facilidade no acionamento de assistências.

4. GESTÃO DE CONTRATOS E BACKOFFICE:
   - Automação integral das rotinas operacionais:
     a) Adesão: entrada ágil de propostas com validação de dados e elegibilidade.
     b) Arrecadação e Cobrança: integrado nativamente com o gateway de pagamentos PagueOn (PIX, boleto, cartão de crédito com split de pagamentos).
     c) Régua de Cobrança e Inadimplência: avisos preventivos, suspensão e cancelamento automatizado após prazos regulamentares.
     d) Cancelamento e Encerramento: processamento ágil sem burocracia desnecessária.
   - Integrações homologadas: Benemed, ArtyOdonto, Banese, Banestes e redes de prestadores 24h.
"""

rule_communication = """
======================================================================
DIRETRIZ MANDATÓRIA DE COMUNICAÇÃO: SÍNTESE E DETALHAMENTO
======================================================================
1. RESPOSTA DIRETA E OBJETIVA POR PADRÃO:
   - Por padrão, responda de forma concisa, objetiva e direta ao ponto.
   - Entregue a resposta central imediatamente.

2. ATENDIMENTO IMEDIATO A PEDIDOS DE DETALHAMENTO:
   - Quando o usuário solicitar "detalhe", "detalhe mais", "explique melhor", "como funciona", "passo a passo" ou pedir aprofundamento:
     É TERMINANTEMENTE PROIBIDO repetir a resposta anterior resumida!
     Expanda a explicação em profundidade: detalhe a arquitetura do sistema, o funcionamento dos módulos, regras de negócio, fluxos técnicos e código-fonte com clareza e exemplos práticos.
"""

# Atualizar claps-code
r_code = c.execute("SELECT meta, params FROM model WHERE id = 'claps-code'").fetchone()
if r_code:
    meta = json.loads(r_code[0]) if r_code[0] else {}
    params = json.loads(r_code[1]) if r_code[1] else {}
    
    meta['knowledge'] = [knowledge_biz, knowledge_api]
    meta['toolIds'] = ['server:mcp:mcp-claps', 'server:mcp:mcp-datadog']
    params['repeat_penalty'] = 1.15
    
    sys_prompt = params.get('system', '')
    import re
    sys_prompt = re.sub(r'={10,}\s*VISÃO GERAL E ARQUITETURA.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*DIRETRIZ MANDATÓRIA DE COMUNICAÇÃO.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'3\.\s*AVISO DE SÍNTESE.*?ao final\.\n*', '', sys_prompt, flags=re.DOTALL)
    
    sys_prompt = sys_prompt.strip() + "\n\n" + claps_code_architecture.strip() + "\n\n" + rule_communication.strip()
    params['system'] = sys_prompt
    
    c.execute("UPDATE model SET meta = ?, params = ? WHERE id = 'claps-code'", (json.dumps(meta), json.dumps(params)))
    print("claps-code atualizado com sucesso!")

# Atualizar claps-business
r_biz = c.execute("SELECT meta, params FROM model WHERE id = 'claps-business'").fetchone()
if r_biz:
    meta = json.loads(r_biz[0]) if r_biz[0] else {}
    params = json.loads(r_biz[1]) if r_biz[1] else {}
    
    meta['knowledge'] = [knowledge_biz, knowledge_api]
    meta['toolIds'] = ['server:mcp:mcp-datadog']
    params['repeat_penalty'] = 1.15
    
    sys_prompt = params.get('system', '')
    import re
    sys_prompt = re.sub(r'={10,}\s*VISÃO GERAL E ARQUITETURA.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'={10,}\s*DIRETRIZ MANDATÓRIA DE COMUNICAÇÃO.*?={10,}', '', sys_prompt, flags=re.DOTALL)
    sys_prompt = re.sub(r'3\.\s*AVISO DE SÍNTESE.*?ao final\.\n*', '', sys_prompt, flags=re.DOTALL)
    
    sys_prompt = sys_prompt.strip() + "\n\n" + claps_biz_architecture.strip() + "\n\n" + rule_communication.strip()
    params['system'] = sys_prompt
    
    c.execute("UPDATE model SET meta = ?, params = ? WHERE id = 'claps-business'", (json.dumps(meta), json.dumps(params)))
    print("claps-business atualizado com sucesso!")

conn.commit()
conn.close()
print("Banco atualizado com sucesso!")
