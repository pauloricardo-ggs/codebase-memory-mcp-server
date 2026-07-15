#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_DIR="$SCRIPT_DIR"
REPOSITORIES_DIR="${BASE_DIR}/repositories"
CACHE_DIR="${BASE_DIR}/cache"
DATA_DIR="${BASE_DIR}/data"
PROXY_SECRETS_DIR="${DATA_DIR}/secrets/proxy"
ENV_FILE="${BASE_DIR}/.env"
CBM_BIN="${HOME}/.local/bin/codebase-memory-mcp"
INSTALL_URL="https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh"
CURRENT_USER="$(id -un)"
SUDO_KEEPALIVE_PID=''
ADMIN_PASSWORD=''

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

cleanup() {
  if [[ -n "$SUDO_KEEPALIVE_PID" ]]; then
    kill "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
    wait "$SUDO_KEEPALIVE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

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

keep_sudo_alive() {
  (
    while true; do
      sudo -n true 2>/dev/null || true
      sleep 45
    done
  ) &
  SUDO_KEEPALIVE_PID=$!
}

install_dependencies() {
  run_step "Atualizando a lista de pacotes" sudo apt-get update
  run_step "Instalando dependências do sistema" sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y ca-certificates curl git jq openssh-client openssl util-linux docker.io

  if ! docker compose version >/dev/null 2>&1 && ! sudo docker compose version >/dev/null 2>&1; then
    if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
      run_step "Instalando Docker Compose" sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y docker-compose-v2
    else
      run_step "Instalando Docker Compose" sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y docker-compose-plugin
    fi
  fi

  local command_name
  for command_name in bash curl git jq flock ssh openssl docker; do
    command -v "$command_name" >/dev/null 2>&1 || fail "Dependência não encontrada: ${command_name}"
  done

  if ! sudo docker info >/dev/null 2>&1; then
    run_step "Iniciando o serviço do Docker" sudo systemctl enable --now docker
  fi
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

read_existing_environment_value() {
  local variable_name="$1"
  if [[ -f "$ENV_FILE" ]]; then
    sed -n "s/^${variable_name}=//p" "$ENV_FILE" | tail -n 1
  fi
}

ask_proxy_access() {
  local suggested_username input password_confirmation existing_username=''

  if [[ -f "${PROXY_SECRETS_DIR}/.htpasswd" ]]; then
    existing_username="$(cut -d: -f1 "${PROXY_SECRETS_DIR}/.htpasswd" | head -n 1)"
  fi
  suggested_username="${existing_username:-$(read_existing_environment_value ADMIN_USERNAME)}"
  suggested_username="${suggested_username:-admin}"

  printf "\n${COLOR_BOLD}Acesso ao painel${COLOR_RESET}\n"
  while true; do
    read -r -p "Usuário administrativo [${suggested_username}]: " input
    ADMIN_USERNAME="${input:-$suggested_username}"
    if [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
      break
    fi
    warn "Use apenas letras, números, ponto, hífen ou underscore."
  done

  while true; do
    if [[ -f "${PROXY_SECRETS_DIR}/.htpasswd" && "$ADMIN_USERNAME" == "$existing_username" ]]; then
      read -r -s -p 'Nova senha (deixe vazia para manter a atual): ' ADMIN_PASSWORD
      printf '\n'
      [[ -z "$ADMIN_PASSWORD" ]] && break
    else
      read -r -s -p 'Senha administrativa (mínimo de 12 caracteres): ' ADMIN_PASSWORD
      printf '\n'
    fi

    if (( ${#ADMIN_PASSWORD} < 12 )); then
      warn "A senha precisa ter pelo menos 12 caracteres."
      continue
    fi
    read -r -s -p 'Confirme a senha: ' password_confirmation
    printf '\n'
    if [[ "$ADMIN_PASSWORD" == "$password_confirmation" ]]; then
      break
    fi
    warn "As senhas não coincidem."
  done

  success "Autenticação do painel configurada para a porta 8787"
}

create_local_structure() {
  mkdir -p "$REPOSITORIES_DIR" "$CACHE_DIR" "$DATA_DIR" "$PROXY_SECRETS_DIR"
  chmod 755 "$REPOSITORIES_DIR"
  chmod 700 "$CACHE_DIR" "$DATA_DIR" "${DATA_DIR}/secrets" "$PROXY_SECRETS_DIR"
  success "Estrutura local criada em ${BASE_DIR}"
}

create_proxy_credentials() {
  local password_hash
  local htpasswd_file="${PROXY_SECRETS_DIR}/.htpasswd"

  if [[ -n "$ADMIN_PASSWORD" ]]; then
    password_hash="$(printf '%s\n' "$ADMIN_PASSWORD" | openssl passwd -apr1 -stdin)"
    printf '%s:%s\n' "$ADMIN_USERNAME" "$password_hash" >"${htpasswd_file}.tmp"
    chmod 600 "${htpasswd_file}.tmp"
    mv "${htpasswd_file}.tmp" "$htpasswd_file"
  fi
  ADMIN_PASSWORD=''

  [[ -f "$htpasswd_file" ]] || fail "Não foi possível criar a credencial do proxy."
  chmod 600 "$htpasswd_file"
  rm -f \
    "${PROXY_SECRETS_DIR}/tls.crt" \
    "${PROXY_SECRETS_DIR}/tls.key" \
    "${PROXY_SECRETS_DIR}/tls.crt.tmp" \
    "${PROXY_SECRETS_DIR}/tls.key.tmp"
  success "Credencial do proxy configurada"
}

create_environment_file() {
  local temporary_file="${ENV_FILE}.tmp"
  printf 'CBM_CACHE_DIR=%s\nCBM_ALLOWED_ROOT=%s\nCBM_MEM_BUDGET_MB=%s\nCBM_HOST_BIN=%s\nLOCAL_UID=%s\nLOCAL_GID=%s\nUI_PORT=8787\nADMIN_USERNAME=%s\n' \
    "$CACHE_DIR" "$REPOSITORIES_DIR" "$CBM_MEM_BUDGET_MB" "$CBM_BIN" "$(id -u)" "$(id -g)" "$ADMIN_USERNAME" >"$temporary_file"
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

docker_compose() {
  if docker info >/dev/null 2>&1; then
    docker compose "$@"
  else
    sudo docker compose "$@"
  fi
}

start_admin_panel_command() {
  cd "$BASE_DIR"
  docker_compose up -d --build
}

validate_admin_panel_command() {
  local attempt
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:8787/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  docker_compose logs --tail=100 admin proxy
  return 1
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
  printf '  Usuário web  : %s\n' "$ADMIN_USERNAME"
  printf '\nConfiguração: auto_index=false, auto_watch=true\n'
  printf '\nPainel administrativo protegido:\n  http://<IP-OU-DNS-DA-VM>:8787\n\n'
}

main() {
  printf "\n${COLOR_BOLD}Codebase Memory MCP Server — instalação${COLOR_RESET}\n\n"
  require_supported_system
  printf "${COLOR_BOLD}Configuração inicial${COLOR_RESET}\n"
  info "Responda agora às perguntas necessárias. Depois disso, a instalação seguirá sem interrupções."
  ask_memory_budget
  ask_proxy_access
  validate_sudo
  keep_sudo_alive
  success "Configuração concluída; iniciando instalação não interativa"
  install_dependencies
  create_local_structure
  create_proxy_credentials
  create_environment_file
  install_codebase_memory
  run_step "Aplicando configurações do Codebase Memory" configure_codebase_memory_command
  run_step "Validando a instalação" validate_installation_command
  run_step "Construindo e iniciando o painel administrativo" start_admin_panel_command
  run_step "Aguardando o painel ficar disponível" validate_admin_panel_command
  show_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
