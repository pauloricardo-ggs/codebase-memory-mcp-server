# Avaliação do RAG documental

O diretório `rag-eval/` contém um runner determinístico para medir recuperação e respostas do Open WebUI. Ele verifica fatos obrigatórios, fatos proibidos, documentos citados, abstenção e latência. O relatório é JSON e pode ser comparado entre configurações de chunking, top-k e reranking.

## Preparar o dataset

Copie `rag-eval/datasets/example.json`, substitua o ID da Knowledge Base e cadastre perguntas reais. Cada caso aceita:

- `requiredFacts`: textos que precisam aparecer; uma lista aninhada representa alternativas;
- `forbiddenFacts`: afirmações que invalidam a resposta;
- `expectedDocuments`: nomes que precisam aparecer nas citações;
- `expectAbstention`: exige que o modelo reconheça ausência de informação;
- `knowledgeBaseIds`: substitui as bases padrão somente naquele caso.

Não coloque documentos, respostas sensíveis ou credenciais no dataset versionado. Use um arquivo fora do Git para dados corporativos.

## Executar contra o Open WebUI

```bash
cd rag-eval
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_API_KEY='<token>' \
RAG_EVAL_MODEL='gemma4:e2b' \
npm run evaluate -- datasets/minha-base.json reports/minha-base.json
```

Também é possível usar `WEBUI_ADMIN_EMAIL` e `WEBUI_ADMIN_PASSWORD` em vez de uma API key. `RAG_EVAL_MIN_PASS_RATE` define o limite que causa falha no processo; o padrão vem do dataset ou é `0.8`.

Para testes offline, configure `RAG_EVAL_RESPONSES_FILE` com um objeto cujas chaves sejam os IDs dos casos e os valores contenham `answer`, `citations` e `latencyMs`.

## Comparar configurações

Execute o mesmo dataset após cada alteração e preserve os relatórios com o nome da variante. Compare prioritariamente:

- `passRate`;
- `averageFactRecall`;
- `averageCitationRecall`;
- `p95LatencyMs`.

Uma alteração de chunking ou reranking só deve ser promovida quando melhorar qualidade sem exceder o limite de latência definido pela equipe.
