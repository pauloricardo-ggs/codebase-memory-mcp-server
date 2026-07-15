#!/bin/sh

set -eu

case "${UI_PORT:-}" in
  ''|*[!0-9]*)
    echo "UI_PORT deve ser uma porta numérica." >&2
    exit 1
    ;;
esac

attempt=1
while [ "$attempt" -le 60 ]; do
  if nc -z agentgateway "$UI_PORT"; then
    echo "AgentGateway MCP disponível em agentgateway:${UI_PORT}."
    exit 0
  fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "AgentGateway não abriu a porta MCP ${UI_PORT} em 60 segundos." >&2
exit 1

