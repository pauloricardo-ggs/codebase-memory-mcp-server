#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_DIR="$SCRIPT_DIR"
REPOSITORIES_DIR="${BASE_DIR}/repositories"
CACHE_DIR="${BASE_DIR}/cache"
SCRIPTS_DIR="${BASE_DIR}/scripts"
ENV_FILE="${BASE_DIR}/.env"
CBM_BIN="${HOME}/.local/bin/codebase-memory-mcp"
INSTALL_URL="https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh"
CURRENT_USER="$(id -un)"

if [[ -t 1 ]]; then
  COLOR_BLUE='\033[0;34m'
  COLOR_GREEN='\033[0;32m'
  COLOR_RED='\033[0;31m'
  COLOR_YELLOW='\033[0;33m'
  COLOR_BOLD='\033[1m'
  COLOR_RESET='\033[0m'
else
  COLOR_BLUE='' COLOR_GREEN='' COLOR_RED='' COLOR_YELLOW='' COLOR_BOLD='' COLOR_RESET=''
fi

info() { printf "${COLOR_BLUE}ℹ${COLOR_RESET}  %s\n" "$*"; }
success() { printf "${COLOR_GREEN}✔${COLOR_RESET}  %s\n" "$*"; }
warn() { printf "${COLOR_YELLOW}⚠${COLOR_RESET}  %s\n" "$*"; }
fail() { printf "${COLOR_RED}✖  %s${COLOR_RESET}\n" "$*" >&2; exit 1; }

on_error() {
  printf "\n${COLOR_RED}✖  A instalação falhou na linha %s.${COLOR_RESET}\n" "$1" >&2
}
trap 'on_error "$LINENO"' ERR

run_step() {
  local message="$1"
  shift

  local log_file status spinner_pid=''
  log_file="$(mktemp "${TMPDIR:-/tmp}/cbm-install.XXXXXX")"

  "$@" >"$log_file" 2>&1 &
  local command_pid=$!

  if [[ -t 1 ]]; then
    (
      local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏' index=0
      while kill -0 "$command_pid" 2>/dev/null; do
        printf "\r${COLOR_BLUE}%s${COLOR_RESET}  %s" "${frames:index++%${#frames}:1}" "$message"
        sleep 0.1
      done
    ) &
    spinner_pid=$!
  else
    info "$message"
  fi

  set +e
  wait "$command_pid"
  status=$?
  set -e

  if [[ -n "$spinner_pid" ]]; then
    wait "$spinner_pid" 2>/dev/null || true
    printf '\r\033[2K'
  fi

  if (( status != 0 )); then
    printf "${COLOR_RED}✖${COLOR_RESET}  %s\n" "$message" >&2
    sed 's/^/   /' "$log_file" >&2
    rm -f "$log_file"
    return "$status"
  fi

  rm -f "$log_file"
  success "$message"
}

require_supported_system() {
  (( EUID != 0 )) || fail "Execute este instalador como usuário comum, não como root."
  [[ -f /etc/os-release ]] || fail "Não foi possível identificar o sistema operacional."

  # shellcheck disable=SC1091
  source /etc/os-release
  if [[ "${ID:-}" != ubuntu && "${ID:-}" != debian && "${ID_LIKE:-}" != *debian* ]]; then
    fail "Sistema não suportado. Use Debian, Ubuntu ou uma distribuição compatível."
  fi

  command -v apt-get >/dev/null 2>&1 || fail "O comando apt-get não está disponível."
  command -v sudo >/dev/null 2>&1 || fail "O comando sudo não está disponível."
}

validate_sudo() {
  info "O sudo pode solicitar sua senha para instalar as dependências."
  sudo -v || fail "O usuário ${CURRENT_USER} não possui acesso ao sudo."
  success "Acesso ao sudo validado"
}

install_dependencies() {
  run_step "Atualizando a lista de pacotes" sudo apt-get update
  run_step "Instalando dependências do sistema" sudo apt-get install -y ca-certificates curl git jq openssh-client util-linux

  local command_name
  for command_name in bash curl git jq flock ssh; do
    command -v "$command_name" >/dev/null 2>&1 || fail "Dependência não encontrada: ${command_name}"
  done
}

ask_memory_budget() {
  local choice custom_value

  printf "\n${COLOR_BOLD}Orçamento de memória${COLOR_RESET}\n"
  printf 'Quanto de RAM o Codebase Memory poderá utilizar?\n\n'
  printf '  1) 4 GB   (4096 MB)\n'
  printf '  2) 8 GB   (8192 MB)\n'
  printf '  3) 16 GB  (16384 MB)\n'
  printf '  4) 32 GB  (32768 MB)\n'
  printf '  5) Outro valor em MB\n\n'

  while true; do
    read -r -p 'Escolha [1-5]: ' choice
    case "$choice" in
      1) CBM_MEM_BUDGET_MB=4096; break ;;
      2) CBM_MEM_BUDGET_MB=8192; break ;;
      3) CBM_MEM_BUDGET_MB=16384; break ;;
      4) CBM_MEM_BUDGET_MB=32768; break ;;
      5)
        while true; do
          read -r -p 'Informe o valor inteiro em MB: ' custom_value
          if [[ "$custom_value" =~ ^[1-9][0-9]*$ ]]; then
            CBM_MEM_BUDGET_MB="$custom_value"
            break 2
          fi
          warn "Informe um número inteiro maior que zero."
        done
        ;;
      *) warn "Opção inválida. Escolha um número entre 1 e 5." ;;
    esac
  done

  success "Budget definido em ${CBM_MEM_BUDGET_MB} MB"
}

create_local_structure() {
  mkdir -p "$REPOSITORIES_DIR" "$CACHE_DIR" "$SCRIPTS_DIR"
  chmod 755 "$REPOSITORIES_DIR" "$SCRIPTS_DIR"
  chmod 700 "$CACHE_DIR"
  success "Estrutura local criada em ${BASE_DIR}"
}

create_environment_file() {
  local temporary_file="${ENV_FILE}.tmp"
  printf 'CBM_CACHE_DIR=%s\nCBM_ALLOWED_ROOT=%s\nCBM_MEM_BUDGET_MB=%s\n' \
    "$CACHE_DIR" "$REPOSITORIES_DIR" "$CBM_MEM_BUDGET_MB" >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$ENV_FILE"
  success "Arquivo .env gerado com caminhos absolutos"
}

install_codebase_memory_command() {
  curl -fsSL "$INSTALL_URL" | bash -s -- --ui --skip-config
}

install_codebase_memory() {
  if [[ -x "$CBM_BIN" ]]; then
    success "Codebase Memory MCP já está instalado"
    return
  fi
  run_step "Instalando Codebase Memory MCP" install_codebase_memory_command
  [[ -x "$CBM_BIN" ]] || fail "Executável não encontrado após a instalação: ${CBM_BIN}"
}

configure_codebase_memory_command() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  "$CBM_BIN" config set auto_index false
  "$CBM_BIN" config set auto_watch true
}

create_helpers() {
  local helper_file="${SCRIPTS_DIR}/cbm-shell.sh"
  local loader_file="${SCRIPTS_DIR}/load-env.sh"

  sed \
    -e "s|@ENV_FILE@|${ENV_FILE}|g" \
    -e "s|@CBM_BIN@|${CBM_BIN}|g" \
    "${SCRIPT_DIR}/templates/cbm-shell.sh.template" >"$helper_file"
  chmod 700 "$helper_file"

  sed \
    -e "s|@ENV_FILE@|${ENV_FILE}|g" \
    "${SCRIPT_DIR}/templates/load-env.sh.template" >"$loader_file"
  chmod 700 "$loader_file"
  success "Scripts auxiliares gerados"
}

validate_installation_command() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  "$CBM_BIN" --version
  "$CBM_BIN" config list
  [[ -d "$CBM_CACHE_DIR" && -d "$CBM_ALLOWED_ROOT" ]]
}

show_summary() {
  printf "\n${COLOR_GREEN}${COLOR_BOLD}✔ Instalação concluída${COLOR_RESET}\n\n"
  printf '  Repositórios : %s\n' "$REPOSITORIES_DIR"
  printf '  Cache        : %s\n' "$CACHE_DIR"
  printf '  Ambiente     : %s\n' "$ENV_FILE"
  printf '  Budget       : %s MB\n' "$CBM_MEM_BUDGET_MB"
  printf '  Executável   : %s\n' "$CBM_BIN"
  printf '\nConfiguração: auto_index=false, auto_watch=true\n'
  printf '\nAbra o ambiente administrativo com:\n  %s/cbm-shell.sh\n\n' "$SCRIPTS_DIR"
}

main() {
  printf "\n${COLOR_BOLD}Codebase Memory MCP Server — instalação${COLOR_RESET}\n\n"
  require_supported_system
  validate_sudo
  install_dependencies
  ask_memory_budget
  create_local_structure
  create_environment_file
  install_codebase_memory
  run_step "Aplicando configurações do Codebase Memory" configure_codebase_memory_command
  create_helpers
  run_step "Validando a instalação" validate_installation_command
  show_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
