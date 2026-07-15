#!/bin/sh

set -eu

CONFIG_DIR="${CONFIG_DIR:-/config}"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"
TEMPLATE_FILE="${TEMPLATE_FILE:-/bootstrap/config.yaml}"
TEMP_FILE="${CONFIG_DIR}/config.yaml.tmp"

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

if [ ! -f "$CONFIG_FILE" ]; then
  sed "s/__UI_PORT__/${UI_PORT}/g" "$TEMPLATE_FILE" >"$TEMP_FILE"
else
  awk -v port="$UI_PORT" '
    function reset_api_key_block() {
      in_api_key = 0
      api_key_text = ""
      api_key_strict = 0
      api_key_empty = 0
    }
    function flush_api_key_block() {
      # Remove somente a política bootstrap antiga, sem chaves nem opções
      # adicionais. Políticas configuradas pelo usuário são preservadas.
      if (!(api_key_strict && api_key_empty)) {
        printf "%s", api_key_text
      }
      reset_api_key_block()
    }
    BEGIN {
      in_mcp = 0
      updated = 0
      reset_api_key_block()
    }
    {
      line = $0
    }
    in_api_key {
      if (line ~ /^      / || line ~ /^[[:space:]]*$/) {
        api_key_text = api_key_text line ORS
        if (line ~ /^      mode:[[:space:]]*strict[[:space:]]*$/) {
          api_key_strict = 1
        } else if (line ~ /^      keys:[[:space:]]*\[\][[:space:]]*$/) {
          api_key_empty = 1
        }
        next
      }
      flush_api_key_block()
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
    in_mcp && line ~ /^    apiKey:[[:space:]]*$/ {
      in_api_key = 1
      api_key_text = line ORS
      next
    }
    in_mcp && line ~ /^  port:[[:space:]]*/ {
      print "  port: " port
      updated = 1
      next
    }
    { print line }
    END {
      if (in_api_key) flush_api_key_block()
      if (in_mcp && !updated) print "  port: " port
    }
  ' "$CONFIG_FILE" >"$TEMP_FILE"
fi

chmod 600 "$TEMP_FILE"
mv "$TEMP_FILE" "$CONFIG_FILE"
