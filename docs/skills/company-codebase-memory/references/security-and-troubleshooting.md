# Segurança e solução de problemas

## Modelo de acesso

- Cada desenvolvedor deve usar uma API key individual.
- O gateway autentica `Authorization: Bearer <token>`.
- O painel associa o usuário a IDs individuais de repositório; workspaces servem apenas para seleção em massa.
- O guardrail filtra projetos e ferramentas e valida o argumento `project` em cada chamada de análise.
- O nome amigável `owner/repository` não é necessariamente o ID técnico do MCP.
- A credencial Sistema/Playground é administrativa e não deve ser distribuída aos desenvolvedores.

## Interpretar falhas

### HTTP 401 ou `no API Key found`

Verificar, sem revelar o valor do token:

1. se a variável de ambiente configurada no cliente existe no processo que iniciou o agente;
2. se o cliente envia o token como Bearer;
3. se o token foi revogado, rotacionado ou excluído;
4. se o agente foi reiniciado depois da configuração.

Não solicitar que o usuário cole a chave na conversa ou a grave no repositório.

### Usuário sem acesso ao projeto

O projeto existe no conjunto conhecido pelo servidor, mas não está liberado para o usuário. Informar o ID técnico recusado e orientar a solicitação de acesso no painel. Não tentar descobrir seu conteúdo por outra credencial.

### Projeto não existe ou ainda não foi indexado

O ID informado não está entre os projetos conhecidos. Executar novamente `list_projects` e usar o ID retornado. Se o repositório esperado não aparecer, confirmar no painel se ele foi clonado, indexado e reconciliado.

### Projeto ausente em `list_projects`

A ausência é ambígua para um token individual: pode significar falta de permissão ou ausência de indexação. Não escolher uma causa sem evidência adicional. Pedir que o administrador confirme o cadastro e o estado da indexação.

### Ferramenta ausente

`tools/list` é filtrado para tokens individuais. Operações administrativas e futuras ferramentas não incluídas na allowlist ficam ocultas. Não tentar chamá-las pelo nome. Usar ferramentas de análise liberadas ou encaminhar a operação ao administrador.

### `trace_path` recusa `cross_service`

Esse modo pode atravessar repositórios e exige a credencial de sistema. Limitar a investigação ao projeto autorizado e explicar que uma análise entre serviços depende de ação administrativa ou de uma capacidade futura com ACL multi-repositório segura.

### Índice incompleto ou desatualizado

Consultar `index_status`, `check_index_coverage` e `detect_changes`. Complementar com o código local e qualificar a conclusão. Não usar ausência no grafo como prova de ausência no código.

### Timeout, falha de conexão ou MCP indisponível

1. confirmar que a máquina está na mesma rede local ou VPN do servidor;
2. conferir a URL e a porta `UI_PORT`;
3. distinguir falha HTTP de falha de uma ferramenta específica;
4. usar busca local quando possível;
5. relatar qual parte da investigação ficou sem cobertura do MCP.

Endereços privados como `192.168.x.x` não são acessíveis por agentes executados fora da rede sem VPN, túnel ou runner conectado à rede local.

## Manuseio de segredos

- Manter o token em variável de ambiente ou cofre do cliente.
- Não colocar token em `SKILL.md`, `AGENTS.md`, `.codex/config.toml` versionado, logs, issues ou prompts.
- Não usar `http_headers` estático quando o cliente oferece referência a variável de ambiente.
- Rotacionar o token pelo painel quando houver suspeita de exposição.
- Lembrar que HTTP na rede local não cifra o token em trânsito; restringir a rede e planejar VPN ou TLS se o modelo de ameaça exigir proteção contra captura interna.
