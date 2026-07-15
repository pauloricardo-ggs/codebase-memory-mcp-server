#!/bin/sh

set -eu

CONFIG_DIR="${CONFIG_DIR:-/config}"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
TEMPLATE_FILE="${TEMPLATE_FILE:-/bootstrap/config.yaml}"
TEMP_FILE="${CONFIG_DIR}/config.yaml.tmp"
SYSTEM_TOKEN_FILE="${SYSTEM_TOKEN_FILE:-/secrets/mcp-system-token}"

case "${UI_PORT:-}" in
  ''|*[!0-9]*)
    echo "UI_PORT deve ser uma porta numérica." >&2
    exit 1
    ;;
esac

if [ "$UI_PORT" -lt 1 ] || [ "$UI_PORT" -gt 65535 ]; then
  echo "UI_PORT deve estar entre 1 e 65535." >&2
  exit 1
fi

mkdir -p "$CONFIG_DIR"

umask 077
mkdir -p "$(dirname "$SYSTEM_TOKEN_FILE")"
if [ ! -s "$SYSTEM_TOKEN_FILE" ]; then
  SYSTEM_TOKEN="cbm_mcp_$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  printf '%s\n' "$SYSTEM_TOKEN" >"${SYSTEM_TOKEN_FILE}.tmp"
  chmod 600 "${SYSTEM_TOKEN_FILE}.tmp"
  mv "${SYSTEM_TOKEN_FILE}.tmp" "$SYSTEM_TOKEN_FILE"
else
  SYSTEM_TOKEN="$(tr -d '\r\n' <"$SYSTEM_TOKEN_FILE")"
fi

case "$SYSTEM_TOKEN" in
  cbm_mcp_*) SYSTEM_TOKEN_VALUE="${SYSTEM_TOKEN#cbm_mcp_}" ;;
  *) SYSTEM_TOKEN_VALUE='' ;;
esac
case "$SYSTEM_TOKEN_VALUE" in
  ''|*[!A-Za-z0-9_-]*)
    echo "Token MCP do sistema possui formato inválido." >&2
    exit 1
    ;;
esac

if [ ! -f "$CONFIG_FILE" ]; then
  sed -e "s/__UI_PORT__/${UI_PORT}/g" -e "s/__MCP_SYSTEM_TOKEN__/${SYSTEM_TOKEN}/g" "$TEMPLATE_FILE" >"$TEMP_FILE"
else
  awk -v port="$UI_PORT" '
    BEGIN {
      in_mcp = 0
      updated = 0
    }
    {
      line = $0
    }
    line ~ /^mcp:[[:space:]]*$/ {
      in_mcp = 1
      print line
      next
    }
    in_mcp && line ~ /^[^[:space:]#]/ {
      if (!updated) print "  port: " port
      in_mcp = 0
    }
    in_mcp && line ~ /^  port:[[:space:]]*/ {
      print "  port: " port
      updated = 1
      next
    }
    { print line }
    END {
      if (in_mcp && !updated) print "  port: " port
    }
  ' "$CONFIG_FILE" >"$TEMP_FILE"
fi

chmod 600 "$TEMP_FILE"
mv "$TEMP_FILE" "$CONFIG_FILE"
