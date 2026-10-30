#!/usr/bin/env python3
"""
Módulo de Robustez Fonética e Transcrição de Voz para Claps AI.
Mapeia variações fonéticas de áudio para termos canônicos e gera
exemplos de treino para imunizar o modelo contra erros de Speech-to-Text.
"""

import json
import os
import random
import re

OUTPUT_DIR = "/home/ma9/codebase-memory-mcp-server/dataset"
MASTER_DATASET = os.path.join(OUTPUT_DIR, "claps_training_dataset_master.jsonl")

# Dicionário Canônico de Mapeamento Fonético
PHONETIC_DICTIONARY = {
    "Claps": ["cleps", "clepes", "clapse", "clapi", "clubs", "clex", "clepis", "cláps"],
    "PagueOn": ["pagueno", "pague on", "pagão", "pague um", "pagueom", "pague-o", "pagueoom"],
    "MA9": ["m a 9", "eme a nove", "m a nove", "ma nove", "m9", "eme nove", "m a nove tecnologia"],
    "ArtyOdonto": ["arte odonto", "art odonto", "arteodonto", "arti odonto", "artiodonto", "art odonto convênio"],
    "Benemed": ["bene med", "benemedi", "bene médico", "benemed saude", "benemede"],
    "Banese": ["banesi", "banes", "banéze", "banco banese"],
    "Banestes": ["baneste", "banest", "banestes corretora", "banescor"],
    "Datadog": ["datadogue", "data dog", "dado dog", "data dogue", "detadog", "datadog apm"],
    "AutoMapper": ["auto mapper", "automaper", "auto map", "automapeamento"],
    "trace_id": ["treice", "treis", "traci", "treici", "treice id", "trace id", "código do trace"],
    "claps-financeiro": ["cleps financeiro", "claps financeiro", "clepes financeiro", "serviço financeiro do cleps"],
    "pagueon-gateway": ["pague on gateway", "pagueno gateway", "gateway do pagão", "checkout do pagueno"],
    "pagueon-pix-service": ["pague on pix", "pagueno pix", "pix do pagão", "serviço de pix do pagueno"],
    "banese-connector": ["conector do banesi", "banese conector", "integração banesi"],
    "banestes-connector": ["conector do baneste", "banestes conector", "integração baneste"]
}

# Cenários de Voz Realistas com Variações Fonéticas de STT
VOICE_SCENARIOS = [
    {
        "spoken": "como funciona o faturamento no cleps da eme a nove?",
        "intent": "Faturamento no Claps da MA9",
        "category": "business",
        "response": (
            "O faturamento no **Claps** (sistema de gestão da **MA9**) opera de forma centralizada e automatizada:\n\n"
            "1. **Agrupamento de Contratos:** Faturas de parceiros (como Banese e Banestes) são consolidadas em lotes periódicos.\n"
            "2. **Processamento via PagueOn:** Os boletos e cobranças PIX são emitidos pelo gateway PagueOn com split automático.\n"
            "3. **Baixa e Conciliação:** A confirmação do pagamento liquida automaticamente a fatura e libera os acessos.\n\n"
            "*(Resumi as etapas principais do faturamento. Se desejar que eu detalhe o calendário de faturamento ou regras de repasse, avise!)*"
        )
    },
    {
        "spoken": "o que é o pagueno e como ele se conecta ao cleps?",
        "intent": "Integração PagueOn e Claps",
        "category": "business",
        "response": (
            "O **PagueOn** é a plataforma proprietária de pagamentos da **MA9**, atuando de forma integrada ao **Claps**:\n\n"
            "- **Papel do PagueOn:** Processa checkouts, transações PIX, cartões de crédito e liquidação bancária com split de receitas.\n"
            "- **Conexão com o Claps:** Comunica-se via APIs REST e webhooks assíncronos. Sempre que um pagamento é aprovado, o Claps atualiza o status do contrato e comissões.\n\n"
            "*(Resumo da integração concluído. Se desejar entender o fluxo de conciliação ou simulação de taxas, avise!)*"
        )
    },
    {
        "spoken": "qual o erro no datadogue do clepes financeiro com o treice {trace_id}?",
        "intent": "Consulta de Trace no Datadog",
        "category": "code",
        "response": (
            "Consulta efetuada no **Datadog** para o serviço `claps-financeiro` (trace `{trace_id}`):\n\n"
            "- **Exceção:** `AutoMapperMappingException`\n"
            "- **Causa Raiz:** Campo obrigatório `TaxaAdquirente` veio nulo no payload da transação sem tratamento no profile de mapeamento.\n"
            "- **Fix Recomendado:** Adicionar `.ForMember(dest => dest.TaxaAdquirente, opt => opt.NullSubstitute(0m))` no arquivo `LancamentoProfile.cs`.\n\n"
            "*(Diagnóstico concluído de forma resumida. Se desejar que eu inspecione a classe completa via Codebase Memory ou simule o patch, avise!)*"
        )
    },
    {
        "spoken": "quais as regras de mensalidade do arte odonto no cleps?",
        "intent": "Regras da ArtyOdonto",
        "category": "business",
        "response": (
            "As mensalidades da **ArtyOdonto** no **Claps** seguem a documentação `API_Plano_CriarMensalidade.pdf`:\n\n"
            "1. **Validação do Titular:** O associado deve estar previamente cadastrado e ativo no sistema.\n"
            "2. **Geração da Cobrança:** A mensalidade é emitida via PagueOn (PIX ou boleto bancário).\n"
            "3. **Ativação dos Benefícios:** A liberação da cobertura de procedimentos do Anexo I ocorre logo após a liquidação financeira.\n\n"
            "*(Resumo das regras da ArtyOdonto. Se desejar consultar a tabela de valores de procedimentos ou fluxo de inadimplência, avise!)*"
        )
    },
    {
        "spoken": "o bene med está com problemas de contratação no pagueno?",
        "intent": "Status Benemed no PagueOn",
        "category": "business",
        "response": (
            "A esteira de contratação da **Benemed** integrada ao **PagueOn** opera normalmente:\n\n"
            "- **Fluxo Atual:** A proposta é gerada no Claps, enviada para liquidação no gateway e, após confirmação, o convênio de saúde é ativado.\n"
            "- **Recomendações:** Caso algum cliente encontre lentidão na emissão de boleto ou PIX, deve-se verificar a validade do CPF do titular e os limites do convênio.\n\n"
            "*(Resumo de status da Benemed. Se precisar investigar algum trace específico ou contrato pendente, avise!)*"
        )
    },
    {
        "spoken": "analise a falha no conector do banesi com treici {trace_id} para o p.o. e para os devs.",
        "intent": "Relatório Dual Banese",
        "category": "dual",
        "response": (
            "### 👔 Visão Negócio & Produto (P.O.)\n"
            "- **Impacto:** Instabilidade temporária de 12 minutos na transmissão de propostas para a Banese Corretora.\n"
            "- **Ação:** Nenhuma proposta foi perdida; as transmissões represadas estão sendo enviadas em fila automática.\n\n"
            "### 🛠️ Diagnóstico Técnico (Engenharia)\n"
            "- **Serviço:** `banese-connector` | **Status:** `504 Gateway Timeout`\n"
            "- **Causa:** Timeout na API SOAP bancária externa ativou o Circuit Breaker da Polly.\n"
            "- **Correção:** Aumentar threshold de tolerância transitória e acionar monitoria de conectividade do banco.\n\n"
            "*(Resumi ambas as perspectivas para o Banese. Se desejar aprofundar na telemetria ou logs brutos, avise!)*"
        )
    }
]

def make_trace_id():
    import hashlib
    return hashlib.md5(str(random.random()).encode()).hexdigest()

def generate_voice_dataset():
    generated_turns = []

    # 1. Scenarios base
    for item in VOICE_SCENARIOS:
        t_id = make_trace_id()
        spoken_text = item["spoken"].replace("{trace_id}", t_id)
        resp_text = item["response"].replace("{trace_id}", t_id)
        category = item["category"]

        sys_prompt = (
            "Você é o Assistente Oficial do Claps e PagueOn (MA9). "
            "Você compreende perfeitamente transcrições de voz que contenham variações fonéticas "
            "(como 'cleps' para Claps, 'pagueno' para PagueOn, 'eme a nove' para MA9, 'arte odonto' para ArtyOdonto, "
            "'bene med' para Benemed, 'banesi' para Banese, 'datadogue' para Datadog e 'treice' para trace_id). "
            "NUNCA corrija o usuário nem mencione erros de pronúncia. "
            "Responda diretamente com os termos oficiais canônicos, de forma concisa e oferecendo detalhamento ao final."
        )

        generated_turns.append({
            "category": f"voice_{category}",
            "intent": item["intent"],
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": spoken_text},
                {"role": "assistant", "content": resp_text}
            ]
        })

    # 2. Augment by generating phonetic perturbations of common questions
    COMMON_QUERIES = [
        ("Como consultar o status de um contrato no {claps}?", "Consulta de Contratos"),
        ("O {pagueon} suporta split automático de pagamento com o {banese}?", "Split Banese PagueOn"),
        ("Tivemos erro de timeout no conector do {banestes}?", "Timeout Banestes"),
        ("Como cadastrar novo usuário na {artyodonto} pelo {claps}?", "Cadastro ArtyOdonto"),
        ("Qual a regra de carência para planos da {benemed} no {claps}?", "Carência Benemed"),
        ("Inspecione o erro no {datadog} com {trace_id}={tid} no {service}.", "Diagnóstico Datadog"),
        ("O cliente não conseguiu pagar com PIX no {pagueon}. O que houve?", "Falha PIX PagueOn"),
        ("A {ma9} possui integração homologada com a Banese Corretora?", "Homologação Banese MA9")
    ]

    for q_template, intent in COMMON_QUERIES:
        for _ in range(25):  # 25 variações fonéticas por consulta
            claps_term = random.choice(PHONETIC_DICTIONARY["Claps"])
            pagueon_term = random.choice(PHONETIC_DICTIONARY["PagueOn"])
            ma9_term = random.choice(PHONETIC_DICTIONARY["MA9"])
            banese_term = random.choice(PHONETIC_DICTIONARY["Banese"])
            banestes_term = random.choice(PHONETIC_DICTIONARY["Banestes"])
            arty_term = random.choice(PHONETIC_DICTIONARY["ArtyOdonto"])
            benemed_term = random.choice(PHONETIC_DICTIONARY["Benemed"])
            datadog_term = random.choice(PHONETIC_DICTIONARY["Datadog"])
            trace_term = random.choice(PHONETIC_DICTIONARY["trace_id"])
            service_term = random.choice(["claps financeiro", "pagueon pix", "gateway do pagão", "conector do banesi"])
            t_id = make_trace_id()

            query = q_template.format(
                claps=claps_term,
                pagueon=pagueon_term,
                ma9=ma9_term,
                banese=banese_term,
                banestes=banestes_term,
                artyodonto=arty_term,
                benemed=benemed_term,
                datadog=datadog_term,
                trace_id=trace_term,
                tid=t_id,
                service=service_term
            )

            response = (
                f"Informações sobre a operação no **Claps** e **PagueOn** (**MA9**):\n\n"
                f"- **Contexto Identificado:** Solicitação referente a {intent}.\n"
                f"- **Diretriz:** A operação segue os padrões oficiais homologados junto aos parceiros (Banese, Banestes e operadoras conveniadas).\n"
                f"- **Encaminhamento:** Os registros encontram-se íntegros na esteira transacional sem divergências detectadas.\n\n"
                f"*(Resumo da solicitação concluído. Se desejar que eu detalhe o passo a passo operacional, o fluxo financeiro ou traces no Datadog, avise!)*"
            )

            sys_prompt = (
                "Você é o Assistente Oficial do Claps e PagueOn (MA9). "
                "Compreenda perfeitamente termos fonéticos de voz ('cleps', 'pagueno', 'eme a nove', 'arte odonto', 'datadogue', 'treice') "
                "sem nunca corrigir o usuário. Responda diretamente e de forma concisa."
            )

            generated_turns.append({
                "category": "voice_phonetic_robustness",
                "intent": intent,
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": query},
                    {"role": "assistant", "content": response}
                ]
            })

    return generated_turns

def main():
    print("Iniciando geração de lote de Robustez Fonética de Voz...")
    voice_turns = generate_voice_dataset()
    print(f"✅ Gerados {len(voice_turns)} cenários com perturbações fonéticas de voz reais.")

    voice_file = os.path.join(OUTPUT_DIR, "voice_phonetic_robustness_dataset.jsonl")
    with open(voice_file, "w", encoding="utf-8") as f:
        for item in voice_turns:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    # Append to Master Dataset
    master_total = 0
    with open(MASTER_DATASET, "a", encoding="utf-8") as f_master:
        for item in voice_turns:
            f_master.write(json.dumps(item, ensure_ascii=False) + "\n")

    with open(MASTER_DATASET, "r", encoding="utf-8") as f_master:
        for _ in f_master:
            master_total += 1

    print("\n" + "="*60)
    print("🎙️ ROBUSTEZ FONÉTICA INCORPORADA AO DATASET MASTER COM SUCESSO!")
    print(f"- Novos cenários de áudio adicionados: {len(voice_turns)}")
    print(f"- Novo Total Consolidado do Dataset Master: {master_total} conversas")
    print("="*60)

if __name__ == "__main__":
    main()
