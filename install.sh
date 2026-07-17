#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
BASE_DIR="$SCRIPT_DIR"
REPOSITORIES_DIR="${BASE_DIR}/repositories"
CACHE_DIR="${BASE_DIR}/cache"
DATA_DIR="${BASE_DIR}/data"
PROXY_SECRETS_DIR="${DATA_DIR}/secrets/proxy"
AGENTGATEWAY_DATA_DIR="${DATA_DIR}/agentgateway"
ENV_FILE="${BASE_DIR}/.env"
GPU_COMPOSE_FILE="${BASE_DIR}/compose.gpu.yaml"
OLLAMA_LAUNCH_AGENT="${HOME}/Library/LaunchAgents/com.codebase-memory.ollama.plist"
CBM_BIN="${HOME}/.local/bin/codebase-memory-mcp"
CBM_CONTAINER_BIN="$CBM_BIN"
CBM_VERSION="v0.8.1"
INSTALL_URL="https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/${CBM_VERSION}/install.sh"
RELEASE_DOWNLOAD_URL="https://github.com/DeusData/codebase-memory-mcp/releases/download/${CBM_VERSION}"
CURRENT_USER="$(id -un)"
SUDO_KEEPALIVE_PID=''
ADMIN_PASSWORD=''
ADMIN_EMAIL=''
OPENWEBUI_ADMIN_NAME='Admin'
OPENWEBUI_PREVIOUS_EMAIL=''
OPENWEBUI_PREVIOUS_NAME=''
OPENWEBUI_PREVIOUS_PASSWORD=''
OPENWEBUI_DESIRED_PASSWORD=''
OLLAMA_VERSION='0.32.1'
OLLAMA_CHAT_MODEL='gemma4:e2b'
OLLAMA_RUNTIME='docker'
OLLAMA_BASE_URL='http://ollama:11434'
OLLAMA_COMPOSE_PROFILES='ollama-docker'
OLLAMA_GPU_MODE='cpu'
OLLAMA_GPU_DEVICE_IDS=''
SYSTEM_PLATFORM=''
SYSTEM_ARCHITECTURE="$(uname -m)"
BREW_BIN=''
OLLAMA_BIN=''

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
  ADMIN_PASSWORD=''
  OPENWEBUI_PREVIOUS_PASSWORD=''
  OPENWEBUI_DESIRED_PASSWORD=''
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

detect_system_platform() {
  case "$(uname -s)" in
    Linux) printf 'linux\n' ;;
    Darwin) printf 'macos\n' ;;
    *) fail "Sistema não suportado: $(uname -s). Use Linux ou macOS." ;;
  esac
}

require_supported_system() {
  local macos_major macos_version
  (( EUID != 0 )) || fail "Execute este instalador como usuário comum, não como root."
  SYSTEM_PLATFORM="$(detect_system_platform)"

  if [[ "$SYSTEM_PLATFORM" == macos ]]; then
    macos_version="$(sw_vers -productVersion)"
    macos_major="${macos_version%%.*}"
    [[ "$macos_major" =~ ^[0-9]+$ ]] && (( macos_major >= 14 )) \
      || fail "O modo macOS requer macOS 14 (Sonoma) ou mais recente."
    if [[ "$SYSTEM_ARCHITECTURE" == x86_64 && "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" == 1 ]]; then
      SYSTEM_ARCHITECTURE='arm64'
    fi
    command -v sudo >/dev/null 2>&1 || fail "O comando sudo não está disponível."
    return
  fi

  [[ -f /etc/os-release ]] || fail "Não foi possível identificar a distribuição Linux."

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

validate_system_clock() {
  if command -v chronyc >/dev/null 2>&1; then
    chronyc tracking | awk -F: '
      /System time/ {
        gsub(/^[[:space:]]+/, "", $2)
        split($2, fields, /[[:space:]]+/)
        offset = fields[1] + 0
        if (offset < 0) offset = -offset
        found = 1
        if (offset > 60) exit 1
      }
      END { if (!found) exit 1 }
    ' || fail "O relógio do servidor está fora de sincronia. O instalador não altera a hora do host. Corrija com 'sudo chronyc -a makestep', valide com 'chronyc tracking' e execute novamente."
    success "Relógio do sistema validado pelo Chrony"
    return
  fi

  if command -v timedatectl >/dev/null 2>&1; then
    if [[ "$(timedatectl show -p NTPSynchronized --value 2>/dev/null)" != yes ]]; then
      warn "O sistema não informa sincronização NTP ativa; o APT validará as datas dos repositórios."
    fi
  fi
}

install_linux_dependencies() {
  validate_system_clock
  run_step "Atualizando a lista de pacotes" sudo apt-get update
  run_step "Instalando dependências do sistema" sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y ca-certificates curl git gnupg jq openssh-client openssl util-linux docker.io

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

configure_homebrew_path() {
  local candidate
  if command -v brew >/dev/null 2>&1; then
    BREW_BIN="$(command -v brew)"
  else
    for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      if [[ -x "$candidate" ]]; then
        BREW_BIN="$candidate"
        break
      fi
    done
  fi
  if [[ -n "$BREW_BIN" ]]; then
    export PATH="$($BREW_BIN --prefix)/bin:$($BREW_BIN --prefix)/sbin:$PATH"
  fi
}

install_homebrew() {
  configure_homebrew_path
  if [[ -n "$BREW_BIN" ]]; then
    success "Homebrew já está instalado"
    return
  fi

  info "Instalando Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  configure_homebrew_path
  [[ -n "$BREW_BIN" ]] || fail "O Homebrew não foi encontrado após a instalação."
  success "Homebrew instalado"
}

wait_for_docker_desktop() {
  local attempt
  if docker info >/dev/null 2>&1; then
    return
  fi
  open -ga Docker || fail "Não foi possível iniciar o Docker Desktop."
  for attempt in {1..120}; do
    if docker info >/dev/null 2>&1; then
      success "Docker Desktop está ativo"
      return
    fi
    sleep 2
  done
  fail "O Docker Desktop não ficou disponível. Conclua a configuração inicial do aplicativo e execute novamente o instalador."
}

install_macos_dependencies() {
  local -a brew_packages=()
  install_homebrew

  command -v jq >/dev/null 2>&1 || brew_packages+=(jq)
  command -v git >/dev/null 2>&1 || brew_packages+=(git)
  if (( ${#brew_packages[@]} > 0 )); then
    run_step "Instalando dependências pelo Homebrew" "$BREW_BIN" install "${brew_packages[@]}"
  fi

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    run_step "Instalando Docker Desktop" "$BREW_BIN" install --cask docker-desktop
    configure_homebrew_path
  fi

  local command_name
  for command_name in bash curl git jq ssh openssl docker; do
    command -v "$command_name" >/dev/null 2>&1 || fail "Dependência não encontrada: ${command_name}"
  done
  docker compose version >/dev/null 2>&1 || fail "O plugin Docker Compose não está disponível."
  wait_for_docker_desktop
}

install_dependencies() {
  if [[ "$SYSTEM_PLATFORM" == macos ]]; then
    install_macos_dependencies
  else
    install_linux_dependencies
  fi
}

xml_escape() {
  sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

configure_host_ollama_command() {
  local ollama_bin ollama_bin_xml log_file log_file_xml user_domain
  ollama_bin="$OLLAMA_BIN"
  [[ -x "$ollama_bin" ]] || fail 'O executável do Ollama não está disponível para o LaunchAgent.'
  log_file="${HOME}/Library/Logs/CodebaseMemoryOllama.log"
  ollama_bin_xml="$(printf '%s' "$ollama_bin" | xml_escape)"
  log_file_xml="$(printf '%s' "$log_file" | xml_escape)"
  user_domain="gui/$(id -u)"

  mkdir -p "$(dirname "$OLLAMA_LAUNCH_AGENT")" "$(dirname "$log_file")"
  if [[ -n "$BREW_BIN" ]] && "$BREW_BIN" list --formula ollama >/dev/null 2>&1; then
    "$BREW_BIN" services stop ollama >/dev/null 2>&1 || true
  fi
  osascript -e 'tell application "Ollama" to quit' >/dev/null 2>&1 || true
  launchctl bootout "${user_domain}/com.codebase-memory.ollama" >/dev/null 2>&1 || true
  launchctl bootout "$user_domain" "$OLLAMA_LAUNCH_AGENT" >/dev/null 2>&1 || true

  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0">'
    printf '%s\n' '<dict>'
    printf '%s\n' '  <key>Label</key>'
    printf '%s\n' '  <string>com.codebase-memory.ollama</string>'
    printf '%s\n' '  <key>ProgramArguments</key>'
    printf '%s\n' '  <array>'
    printf '    <string>%s</string>\n' "$ollama_bin_xml"
    printf '%s\n' '    <string>serve</string>'
    printf '%s\n' '  </array>'
    printf '%s\n' '  <key>EnvironmentVariables</key>'
    printf '%s\n' '  <dict>'
    printf '%s\n' '    <key>OLLAMA_HOST</key>'
    printf '%s\n' '    <string>0.0.0.0:11434</string>'
    printf '%s\n' '  </dict>'
    printf '%s\n' '  <key>RunAtLoad</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>KeepAlive</key>'
    printf '%s\n' '  <true/>'
    printf '%s\n' '  <key>StandardOutPath</key>'
    printf '  <string>%s</string>\n' "$log_file_xml"
    printf '%s\n' '  <key>StandardErrorPath</key>'
    printf '  <string>%s</string>\n' "$log_file_xml"
    printf '%s\n' '</dict>'
    printf '%s\n' '</plist>'
  } >"${OLLAMA_LAUNCH_AGENT}.tmp"
  plutil -lint "${OLLAMA_LAUNCH_AGENT}.tmp" >/dev/null
  chmod 600 "${OLLAMA_LAUNCH_AGENT}.tmp"
  mv "${OLLAMA_LAUNCH_AGENT}.tmp" "$OLLAMA_LAUNCH_AGENT"
  launchctl bootstrap "$user_domain" "$OLLAMA_LAUNCH_AGENT"
  launchctl kickstart -k "${user_domain}/com.codebase-memory.ollama"
}

install_host_ollama() {
  local attempt
  [[ "$OLLAMA_RUNTIME" == host ]] || return 0
  [[ "$SYSTEM_PLATFORM" == macos ]] || fail 'O modo host do Ollama requer macOS.'
  configure_homebrew_path
  [[ -n "$BREW_BIN" ]] || fail 'Homebrew não está disponível para instalar o Ollama.'

  if command -v ollama >/dev/null 2>&1; then
    OLLAMA_BIN="$(command -v ollama)"
    success "Ollama já está instalado"
  elif [[ -x /Applications/Ollama.app/Contents/Resources/ollama ]]; then
    OLLAMA_BIN='/Applications/Ollama.app/Contents/Resources/ollama'
    success "Ollama já está instalado"
  else
    run_step "Instalando Ollama pelo Homebrew" "$BREW_BIN" install ollama
    configure_homebrew_path
    OLLAMA_BIN="$(command -v ollama)"
  fi
  [[ -x "$OLLAMA_BIN" ]] || fail 'O executável do Ollama não foi encontrado.'

  warn 'O Ollama escutará em 0.0.0.0:11434 para permitir o acesso dos containers; restrinja essa porta no firewall local.'
  run_step "Configurando o Ollama como serviço nativo" configure_host_ollama_command
  for attempt in {1..60}; do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      success "Ollama nativo está disponível"
      return
    fi
    sleep 2
  done
  fail "O Ollama nativo não ficou disponível. Consulte ${HOME}/Library/Logs/CodebaseMemoryOllama.log."
}

configure_nvidia_runtime_command() {
  [[ "$OLLAMA_GPU_MODE" != cpu ]] || return 0
  command -v nvidia-smi >/dev/null 2>&1 || fail 'A GPU foi habilitada, mas o driver NVIDIA não está disponível.'
  nvidia-smi -L >/dev/null || fail 'A GPU foi habilitada, mas o driver NVIDIA não respondeu.'

  if ! command -v nvidia-ctk >/dev/null 2>&1; then
    curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
      | sudo gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
    curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
      | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
      | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
    sudo apt-get update
    sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y nvidia-container-toolkit
  fi

  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker
  sudo docker info >/dev/null
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

ask_ollama_runtime() {
  local choice default_choice existing_runtime
  existing_runtime="$(read_existing_environment_value OLLAMA_RUNTIME)"

  if [[ "$existing_runtime" == docker || ( "$existing_runtime" == host && "$SYSTEM_PLATFORM" == macos ) ]]; then
    OLLAMA_RUNTIME="$existing_runtime"
  elif [[ "$SYSTEM_PLATFORM" == macos ]]; then
    OLLAMA_RUNTIME='host'
  else
    OLLAMA_RUNTIME='docker'
  fi

  printf "\n${COLOR_BOLD}Modo de execução do Ollama${COLOR_RESET}\n"
  printf 'Onde o Ollama deve ser executado?\n\n'
  printf '  1) Docker (padrão para Linux)\n'
  printf '  2) Host macOS (Homebrew; Apple Silicon usa aceleração nativa)\n\n'

  [[ "$OLLAMA_RUNTIME" == host ]] && default_choice=2 || default_choice=1
  while true; do
    read -r -p "Escolha [1-2, atual: ${default_choice}]: " choice
    case "${choice:-$default_choice}" in
      1)
        OLLAMA_RUNTIME='docker'
        OLLAMA_BASE_URL='http://ollama:11434'
        OLLAMA_COMPOSE_PROFILES='ollama-docker'
        break
        ;;
      2)
        [[ "$SYSTEM_PLATFORM" == macos ]] || {
          warn 'O modo host é suportado somente no macOS.'
          continue
        }
        OLLAMA_RUNTIME='host'
        OLLAMA_BASE_URL='http://host.docker.internal:11434'
        OLLAMA_COMPOSE_PROFILES=''
        break
        ;;
      *) warn 'Opção inválida. Escolha 1 ou 2.' ;;
    esac
  done

  if [[ "$OLLAMA_RUNTIME" == host ]]; then
    success 'Ollama será executado nativamente no macOS'
  else
    success 'Ollama será executado pelo Docker'
  fi
}

ask_ollama_model() {
  local choice custom_model existing_model
  existing_model="$(read_existing_environment_value OLLAMA_CHAT_MODEL)"
  OLLAMA_CHAT_MODEL="${existing_model:-gemma4:e2b}"

  printf "\n${COLOR_BOLD}Modelo local do Ollama${COLOR_RESET}\n"
  printf 'Qual modelo de chat deve ser baixado durante a instalação?\n\n'
  printf '  1) gemma4:e2b (Gemma 4 Effective 2B)\n'
  printf '  2) gemma4:e4b (Gemma 4 Effective 4B)\n'
  printf '  3) Outro modelo do Ollama\n\n'

  while true; do
    read -r -p "Escolha [1-3, atual: ${OLLAMA_CHAT_MODEL}]: " choice
    if [[ -z "$choice" ]]; then
      break
    fi
    case "$choice" in
      1) OLLAMA_CHAT_MODEL='gemma4:e2b'; break ;;
      2) OLLAMA_CHAT_MODEL='gemma4:e4b'; break ;;
      3)
        read -r -p 'Informe o identificador do modelo (ex.: gemma4:12b): ' custom_model
        if [[ "$custom_model" =~ ^[A-Za-z0-9._/-]+(:[A-Za-z0-9._-]+)?$ ]]; then
          OLLAMA_CHAT_MODEL="$custom_model"
          break
        fi
        warn 'Identificador inválido para um modelo Ollama.'
        ;;
      *) warn 'Opção inválida. Escolha um número entre 1 e 3.' ;;
    esac
  done
  success "Modelo selecionado: ${OLLAMA_CHAT_MODEL}"
}

ask_ollama_gpu() {
  local existing_mode existing_devices existing_indices='' choice default_choice record index uuid name memory selection token selected_ids='' selected_uuid position
  local -a gpu_records=() requested_indices=() gpu_indices=() gpu_uuids=()

  existing_mode="$(read_existing_environment_value OLLAMA_GPU_MODE)"
  existing_devices="$(read_existing_environment_value OLLAMA_GPU_DEVICE_IDS)"
  OLLAMA_GPU_MODE='cpu'
  OLLAMA_GPU_DEVICE_IDS=''

  if [[ "$OLLAMA_RUNTIME" == host ]]; then
    if [[ "$SYSTEM_ARCHITECTURE" == arm64 || "$SYSTEM_ARCHITECTURE" == aarch64 ]]; then
      OLLAMA_GPU_MODE='metal'
      success 'Ollama nativo usará a aceleração do Apple Silicon'
    else
      OLLAMA_GPU_MODE='cpu'
      success 'Ollama nativo usará CPU neste Mac'
    fi
    return
  fi

  if ! command -v nvidia-smi >/dev/null 2>&1; then
    info 'Nenhuma GPU NVIDIA foi detectada; o Ollama usará CPU.'
    return
  fi
  while IFS= read -r record; do
    [[ -z "$record" ]] || gpu_records+=("$record")
  done < <(nvidia-smi --query-gpu=index,uuid,name,memory.total --format=csv,noheader,nounits 2>/dev/null || true)
  if (( ${#gpu_records[@]} == 0 )); then
    warn 'O nvidia-smi não encontrou GPUs utilizáveis; o Ollama usará CPU.'
    return
  fi

  printf "\n${COLOR_BOLD}Aceleração do Ollama${COLOR_RESET}\n"
  printf 'GPUs NVIDIA detectadas:\n\n'
  for record in "${gpu_records[@]}"; do
    IFS=',' read -r index uuid name memory <<<"$record"
    index="${index//[[:space:]]/}"
    uuid="${uuid#${uuid%%[![:space:]]*}}"; uuid="${uuid%${uuid##*[![:space:]]}}"
    name="${name#${name%%[![:space:]]*}}"; name="${name%${name##*[![:space:]]}}"
    memory="${memory//[[:space:]]/}"
    gpu_indices+=("$index")
    gpu_uuids+=("$uuid")
    if [[ ",${existing_devices}," == *",${uuid},"* ]]; then
      existing_indices="${existing_indices:+${existing_indices},}${index}"
    fi
    printf '  GPU %s — %s — %s MiB — %s\n' "$index" "$name" "$memory" "$uuid"
  done
  printf '\n  1) Usar todas as GPUs\n'
  printf '  2) Selecionar GPUs\n'
  printf '  3) Usar somente CPU\n\n'

  case "$existing_mode" in
    all) default_choice=1 ;;
    selected) default_choice=2 ;;
    *) default_choice=3 ;;
  esac
  while true; do
    read -r -p "Escolha [1-3, atual: ${default_choice}]: " choice
    case "${choice:-$default_choice}" in
      1)
        OLLAMA_GPU_MODE='all'
        OLLAMA_GPU_DEVICE_IDS=''
        break
        ;;
      2)
        read -r -p "Informe os índices separados por vírgula${existing_indices:+ [atual: ${existing_indices}]}: " selection
        selection="${selection:-$existing_indices}"
        selected_ids=''
        IFS=',' read -ra requested_indices <<<"$selection"
        for token in "${requested_indices[@]}"; do
          token="${token//[[:space:]]/}"
          selected_uuid=''
          if [[ "$token" =~ ^[0-9]+$ ]]; then
            for position in "${!gpu_indices[@]}"; do
              if [[ "${gpu_indices[$position]}" == "$token" ]]; then
                selected_uuid="${gpu_uuids[$position]}"
                break
              fi
            done
          fi
          if [[ -z "$selected_uuid" ]]; then
            selected_ids=''
            break
          fi
          if [[ ",${selected_ids}," != *",${selected_uuid},"* ]]; then
            selected_ids="${selected_ids:+${selected_ids},}${selected_uuid}"
          fi
        done
        if [[ -n "$selected_ids" ]]; then
          OLLAMA_GPU_MODE='selected'
          OLLAMA_GPU_DEVICE_IDS="$selected_ids"
          break
        fi
        warn 'Seleção inválida. Use somente os índices exibidos, separados por vírgula.'
        ;;
      3)
        OLLAMA_GPU_MODE='cpu'
        OLLAMA_GPU_DEVICE_IDS=''
        break
        ;;
      *) warn 'Opção inválida. Escolha um número entre 1 e 3.' ;;
    esac
  done

  case "$OLLAMA_GPU_MODE" in
    all) success 'Ollama configurado para usar todas as GPUs NVIDIA' ;;
    selected) success "Ollama configurado para usar: ${OLLAMA_GPU_DEVICE_IDS}" ;;
    cpu) success 'Ollama configurado para usar somente CPU' ;;
  esac
}

read_existing_environment_value() {
  local variable_name="$1"
  if [[ -f "$ENV_FILE" ]]; then
    sed -n "s/^${variable_name}=//p" "$ENV_FILE" | tail -n 1
  fi
}

ask_proxy_access() {
  local suggested_email input password_confirmation existing_username=''

  if [[ -f "${PROXY_SECRETS_DIR}/.htpasswd" ]]; then
    existing_username="$(cut -d: -f1 "${PROXY_SECRETS_DIR}/.htpasswd" | head -n 1)"
  fi
  if [[ -f "${DATA_DIR}/secrets/openwebui.env" ]]; then
    OPENWEBUI_PREVIOUS_EMAIL="$(sed -n 's/^WEBUI_ADMIN_EMAIL=//p' "${DATA_DIR}/secrets/openwebui.env" | tail -n 1)"
    OPENWEBUI_PREVIOUS_NAME="$(sed -n 's/^WEBUI_ADMIN_NAME=//p' "${DATA_DIR}/secrets/openwebui.env" | tail -n 1)"
    OPENWEBUI_PREVIOUS_PASSWORD="$(sed -n 's/^WEBUI_ADMIN_PASSWORD=//p' "${DATA_DIR}/secrets/openwebui.env" | tail -n 1)"
  fi
  suggested_email="${OPENWEBUI_PREVIOUS_EMAIL:-$(read_existing_environment_value ADMIN_EMAIL)}"
  suggested_email="${suggested_email:-$existing_username}"
  [[ "$suggested_email" == *@*.* ]] || suggested_email='joao@exemplo.com'

  printf "\n${COLOR_BOLD}Acesso ao painel${COLOR_RESET}\n"
  while true; do
    read -r -p "E-mail administrativo [${suggested_email}]: " input
    ADMIN_EMAIL="${input:-$suggested_email}"
    if [[ "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
      break
    fi
    warn "Informe um endereço de e-mail válido."
  done
  ADMIN_USERNAME="$ADMIN_EMAIL"

  while true; do
    if [[ -f "${PROXY_SECRETS_DIR}/.htpasswd" && -s "${DATA_DIR}/secrets/openwebui.env" && "$ADMIN_EMAIL" == "$OPENWEBUI_PREVIOUS_EMAIL" && "$ADMIN_USERNAME" == "$existing_username" ]]; then
      read -r -s -p 'Nova senha (deixe vazia para manter a atual): ' ADMIN_PASSWORD
      printf '\n'
      [[ -z "$ADMIN_PASSWORD" ]] && break
    else
      read -r -s -p 'Senha administrativa (mínimo de 6 caracteres): ' ADMIN_PASSWORD
      printf '\n'
    fi

    if (( ${#ADMIN_PASSWORD} < 6 )); then
      warn "A senha precisa ter pelo menos 6 caracteres."
      continue
    fi
    read -r -s -p 'Confirme a senha: ' password_confirmation
    printf '\n'
    if [[ "$ADMIN_PASSWORD" == "$password_confirmation" ]]; then
      break
    fi
    warn "As senhas não coincidem."
  done

  if [[ -n "$ADMIN_PASSWORD" ]]; then
    OPENWEBUI_DESIRED_PASSWORD="$ADMIN_PASSWORD"
  else
    OPENWEBUI_DESIRED_PASSWORD="$OPENWEBUI_PREVIOUS_PASSWORD"
  fi
  [[ -n "$OPENWEBUI_DESIRED_PASSWORD" ]] || fail "A senha atual do Open WebUI não foi encontrada; informe uma nova senha."

  success "Credencial de acesso definida para ${ADMIN_EMAIL}"
}

create_local_structure() {
  mkdir -p "$REPOSITORIES_DIR" "$CACHE_DIR" "$DATA_DIR" "${DATA_DIR}/bin" "$PROXY_SECRETS_DIR" "$AGENTGATEWAY_DATA_DIR" "${DATA_DIR}/knowledge-sync" "${DATA_DIR}/secrets/knowledge-sync"
  chmod 755 "$REPOSITORIES_DIR"
  chmod 700 "$CACHE_DIR" "$DATA_DIR" "${DATA_DIR}/bin" "${DATA_DIR}/secrets" "$PROXY_SECRETS_DIR" "$AGENTGATEWAY_DATA_DIR" "${DATA_DIR}/knowledge-sync" "${DATA_DIR}/secrets/knowledge-sync"
  success "Estrutura local criada em ${BASE_DIR}"
}

write_ollama_gpu_compose_override() {
  local temporary_file="${GPU_COMPOSE_FILE}.tmp" device_id
  local -a device_ids=()
  if [[ "$OLLAMA_RUNTIME" != docker ]]; then
    rm -f "$GPU_COMPOSE_FILE" "$temporary_file"
    success 'Override NVIDIA não é necessário para o Ollama nativo'
    return
  fi
  if [[ "$OLLAMA_GPU_MODE" == cpu ]]; then
    rm -f "$GPU_COMPOSE_FILE" "$temporary_file"
    success 'Ollama permanecerá em CPU'
    return
  fi

  {
    printf 'services:\n'
    printf '  ollama:\n'
    printf '    deploy:\n'
    printf '      resources:\n'
    printf '        reservations:\n'
    printf '          devices:\n'
    printf '            - driver: nvidia\n'
    if [[ "$OLLAMA_GPU_MODE" == all ]]; then
      printf '              count: all\n'
    else
      IFS=',' read -ra device_ids <<<"$OLLAMA_GPU_DEVICE_IDS"
      (( ${#device_ids[@]} > 0 )) || fail 'Nenhuma GPU foi selecionada para o Ollama.'
      printf '              device_ids:\n'
      for device_id in "${device_ids[@]}"; do
        [[ "$device_id" =~ ^GPU-[A-Za-z0-9-]+$ ]] || fail "UUID de GPU inválido: ${device_id}"
        printf '                - "%s"\n' "$device_id"
      done
    fi
    printf '              capabilities: [gpu]\n'
  } >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$GPU_COMPOSE_FILE"
  success "Override de GPU criado em ${GPU_COMPOSE_FILE}"
}

configure_google_drive_sync() {
  local sync_token_file="${DATA_DIR}/secrets/knowledge-sync/knowledge-sync-token"
  local service_account_file="${DATA_DIR}/secrets/knowledge-sync/google-drive-service-account.json"
  local legacy_token_file="${DATA_DIR}/secrets/knowledge-sync-token"
  local legacy_service_account_file="${DATA_DIR}/secrets/google-drive-service-account.json"
  if [[ ! -s "$sync_token_file" && -s "$legacy_token_file" ]]; then
    mv "$legacy_token_file" "$sync_token_file"
  fi
  if [[ ! -s "$service_account_file" && -s "$legacy_service_account_file" ]]; then
    mv "$legacy_service_account_file" "$service_account_file"
  fi
  if [[ ! -s "$sync_token_file" ]]; then
    openssl rand -hex 32 >"${sync_token_file}.tmp"
    chmod 600 "${sync_token_file}.tmp"
    mv "${sync_token_file}.tmp" "$sync_token_file"
  fi
  chmod 600 "$sync_token_file"
  [[ ! -f "$service_account_file" ]] || chmod 600 "$service_account_file"
  success 'Worker do Google Drive preparado; a integração é configurada em Bases e Drive'
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

  local openwebui_env="${DATA_DIR}/secrets/openwebui.env"
  local stored_email stored_password stored_name webui_secret
  if [[ ! -s "$openwebui_env" ]]; then
    webui_secret="$(openssl rand -hex 32)"
    write_openwebui_environment "$ADMIN_EMAIL" "$OPENWEBUI_DESIRED_PASSWORD" "$OPENWEBUI_ADMIN_NAME" "$webui_secret"
  else
    stored_email="$(sed -n 's/^WEBUI_ADMIN_EMAIL=//p' "$openwebui_env" | tail -n 1)"
    stored_password="$(sed -n 's/^WEBUI_ADMIN_PASSWORD=//p' "$openwebui_env" | tail -n 1)"
    stored_name="$(sed -n 's/^WEBUI_ADMIN_NAME=//p' "$openwebui_env" | tail -n 1)"
    webui_secret="$(sed -n 's/^WEBUI_SECRET_KEY=//p' "$openwebui_env" | tail -n 1)"
    [[ -n "$stored_email" && -n "$stored_password" && -n "$stored_name" && -n "$webui_secret" ]] \
      || fail "Configuração administrativa incompleta em ${openwebui_env}."
    write_openwebui_environment "$stored_email" "$stored_password" "$stored_name" "$webui_secret"
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

write_openwebui_environment() {
  local admin_email="$1" admin_password="$2" admin_name="$3" webui_secret="$4"
  local openwebui_env="${DATA_DIR}/secrets/openwebui.env"

  {
    if [[ -f "$openwebui_env" ]]; then
      sed -E '/^(WEBUI_ADMIN_EMAIL|WEBUI_ADMIN_PASSWORD|WEBUI_ADMIN_NAME|WEBUI_SECRET_KEY)=/d' "$openwebui_env"
    fi
    printf 'WEBUI_ADMIN_EMAIL=%s\n' "$admin_email"
    printf 'WEBUI_ADMIN_PASSWORD=%s\n' "$admin_password"
    printf 'WEBUI_ADMIN_NAME=%s\n' "$admin_name"
    printf 'WEBUI_SECRET_KEY=%s\n' "$webui_secret"
  } >"${openwebui_env}.tmp"
  chmod 600 "${openwebui_env}.tmp"
  mv "${openwebui_env}.tmp" "$openwebui_env"
}

create_environment_file() {
  local temporary_file="${ENV_FILE}.tmp" ui_port=8787 agentgateway_ui_port=8788 openwebui_port=3000 workspace_timezone=America/Maceio repository_sync_concurrency=3 existing_value
  if [[ -f "$ENV_FILE" ]]; then
    existing_value="$(sed -n 's/^OLLAMA_VERSION=//p' "$ENV_FILE" | tail -n 1)"
    [[ "$existing_value" =~ ^[A-Za-z0-9._-]+$ ]] && OLLAMA_VERSION="$existing_value"
    existing_value="$(sed -n 's/^UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
    [[ "$existing_value" =~ ^[0-9]+$ ]] && (( existing_value >= 1 && existing_value <= 65535 )) && ui_port="$existing_value"
    existing_value="$(sed -n 's/^AGENTGATEWAY_UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
    [[ "$existing_value" =~ ^[0-9]+$ ]] && (( existing_value >= 1 && existing_value <= 65535 )) && agentgateway_ui_port="$existing_value"
    existing_value="$(sed -n 's/^OPENWEBUI_PORT=//p' "$ENV_FILE" | tail -n 1)"
    [[ "$existing_value" =~ ^[0-9]+$ ]] && (( existing_value >= 1 && existing_value <= 65535 )) && openwebui_port="$existing_value"
    existing_value="$(sed -n 's/^WORKSPACE_TIMEZONE=//p' "$ENV_FILE" | tail -n 1)"
    [[ -n "$existing_value" ]] && workspace_timezone="$existing_value"
    existing_value="$(sed -n 's/^REPOSITORY_SYNC_CONCURRENCY=//p' "$ENV_FILE" | tail -n 1)"
    [[ "$existing_value" =~ ^[0-9]+$ ]] && (( existing_value >= 1 && existing_value <= 20 )) && repository_sync_concurrency="$existing_value"
  fi
  printf 'CBM_CACHE_DIR=%s\nCBM_ALLOWED_ROOT=%s\nCBM_MEM_BUDGET_MB=%s\nCBM_HOST_BIN=%s\nLOCAL_UID=%s\nLOCAL_GID=%s\nUI_PORT=%s\nAGENTGATEWAY_UI_PORT=%s\nOPENWEBUI_PORT=%s\nWORKSPACE_TIMEZONE=%s\nREPOSITORY_SYNC_CONCURRENCY=%s\nADMIN_EMAIL=%s\nADMIN_USERNAME=%s\nOLLAMA_VERSION=%s\nOLLAMA_CHAT_MODEL=%s\nOLLAMA_RUNTIME=%s\nOLLAMA_BASE_URL=%s\nCOMPOSE_PROFILES=%s\nOLLAMA_GPU_MODE=%s\nOLLAMA_GPU_DEVICE_IDS=%s\n' \
    "$CACHE_DIR" "$REPOSITORIES_DIR" "$CBM_MEM_BUDGET_MB" "$CBM_CONTAINER_BIN" "$(id -u)" "$(id -g)" "$ui_port" "$agentgateway_ui_port" "$openwebui_port" "$workspace_timezone" "$repository_sync_concurrency" "$ADMIN_EMAIL" "$ADMIN_USERNAME" "$OLLAMA_VERSION" "$OLLAMA_CHAT_MODEL" "$OLLAMA_RUNTIME" "$OLLAMA_BASE_URL" "$OLLAMA_COMPOSE_PROFILES" "$OLLAMA_GPU_MODE" "$OLLAMA_GPU_DEVICE_IDS" >"$temporary_file"
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$ENV_FILE"
  success "Arquivo .env gerado com caminhos absolutos"
}

install_codebase_memory_command() {
  curl -fsSL "$INSTALL_URL" | CBM_DOWNLOAD_URL="$RELEASE_DOWNLOAD_URL" bash -s -- --ui --skip-config
}

install_codebase_memory() {
  if [[ -x "$CBM_BIN" ]]; then
    success "Codebase Memory MCP já está instalado"
    return
  fi
  run_step "Instalando Codebase Memory MCP" install_codebase_memory_command
  [[ -x "$CBM_BIN" ]] || fail "Executável não encontrado após a instalação: ${CBM_BIN}"
}

install_container_codebase_memory_command() {
  local docker_arch archive temporary_dir expected_checksum actual_checksum
  docker_arch="$(docker info --format '{{.Architecture}}')"
  case "$docker_arch" in
    arm64|aarch64) docker_arch='arm64' ;;
    amd64|x86_64) docker_arch='amd64' ;;
    *) fail "Arquitetura do Docker não suportada: ${docker_arch}" ;;
  esac

  archive="codebase-memory-mcp-ui-linux-${docker_arch}-portable.tar.gz"
  temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/cbm-container-bin.XXXXXX")"
  curl -fsSL "${RELEASE_DOWNLOAD_URL}/${archive}" -o "${temporary_dir}/${archive}"
  curl -fsSL "${RELEASE_DOWNLOAD_URL}/checksums.txt" -o "${temporary_dir}/checksums.txt"
  expected_checksum="$(awk -v archive="$archive" '$2 == archive { print $1; exit }' "${temporary_dir}/checksums.txt")"
  [[ -n "$expected_checksum" ]] || fail "Checksum não encontrado para ${archive}."
  actual_checksum="$(shasum -a 256 "${temporary_dir}/${archive}" | awk '{ print $1 }')"
  [[ "$actual_checksum" == "$expected_checksum" ]] || fail "Checksum inválido para ${archive}."
  tar -xzf "${temporary_dir}/${archive}" -C "$temporary_dir"
  [[ -f "${temporary_dir}/codebase-memory-mcp" ]] || fail "Binário Linux não encontrado em ${archive}."
  install -m 755 "${temporary_dir}/codebase-memory-mcp" "$CBM_CONTAINER_BIN"
  rm -rf "$temporary_dir"
}

install_container_codebase_memory() {
  if [[ "$SYSTEM_PLATFORM" != macos ]]; then
    CBM_CONTAINER_BIN="$CBM_BIN"
    return
  fi
  CBM_CONTAINER_BIN="${DATA_DIR}/bin/codebase-memory-mcp"
  run_step "Instalando o binário Linux do Codebase Memory para os containers" install_container_codebase_memory_command
  [[ -x "$CBM_CONTAINER_BIN" ]] || fail "Executável dos containers não encontrado: ${CBM_CONTAINER_BIN}"
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
  local -a compose_files=(-f "${BASE_DIR}/compose.yaml")
  [[ ! -f "$GPU_COMPOSE_FILE" ]] || compose_files+=(-f "$GPU_COMPOSE_FILE")
  if [[ "$SYSTEM_PLATFORM" == macos || "$(uname -s)" == Darwin ]]; then
    docker compose "${compose_files[@]}" "$@"
    return
  fi
  if docker info >/dev/null 2>&1; then
    docker compose "${compose_files[@]}" "$@"
  else
    sudo docker compose "${compose_files[@]}" "$@"
  fi
}

start_admin_panel_command() {
  cd "$BASE_DIR"
  # O agentgateway-config altera um arquivo bind-mounted sem modificar a
  # definição do serviço. Force a recriação para o AgentGateway reler a porta
  # antes de o agentgateway-ready verificar o listener MCP.
  if ! docker_compose up -d --build --force-recreate; then
    docker_compose ps -a
    if [[ "$OLLAMA_RUNTIME" == docker ]]; then
      docker_compose logs --tail=200 \
        agentgateway-config agentgateway agentgateway-ready admin proxy graph-ui ollama docling open-webui openwebui-bootstrap
    else
      docker_compose logs --tail=200 \
        agentgateway-config agentgateway agentgateway-ready admin proxy graph-ui docling open-webui openwebui-bootstrap
    fi
    return 1
  fi
  # O nginx.conf é bind-mounted. Alterá-lo não faz o Compose recriar o
  # container, portanto valide e recarregue o processo em toda instalação.
  docker_compose exec -T proxy nginx -t -c /tmp/nginx.conf
  docker_compose exec -T proxy nginx -s reload -c /tmp/nginx.conf
}

validate_admin_panel_command() {
  local attempt ui_port
  ui_port="$(sed -n 's/^UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  for attempt in {1..30}; do
    if curl -fsS "http://127.0.0.1:${ui_port}/healthz" >/dev/null; then
      return 0
    fi
    sleep 1
  done
  docker_compose logs --tail=100 admin proxy
  return 1
}

validate_graph_ui_command() {
  local attempt
  for attempt in {1..30}; do
    if docker_compose exec -T graph-ui wget -q --spider "http://127.0.0.1:9749/"; then
      return 0
    fi
    sleep 1
  done
  docker_compose logs --tail=100 graph-ui proxy
  return 1
}

validate_agentgateway_command() {
  local attempt ui_port ready=0
  ui_port="$(sed -n 's/^UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  for attempt in {1..30}; do
    if docker_compose exec -T proxy wget -q --spider "http://agentgateway:15000/ui/" \
      && docker_compose exec -T proxy sh -c \
        'wget -qO- http://agentgateway:15000/api/config | grep -Eq "\"port\"[[:space:]]*:[[:space:]]*$1"' \
        _ "$ui_port"; then
      ready=1
      break
    fi
    sleep 1
  done
  if (( ready != 1 )); then
    docker_compose logs --tail=100 agentgateway-config agentgateway proxy
    return 1
  fi

  docker_compose exec -T admin node --input-type=module -e '
    const { readFile } = await import("node:fs/promises");
    const systemToken = (await readFile("/data/app/secrets/mcp-system-token", "utf8")).trim();
    if (!systemToken) throw new Error("Token MCP do sistema não foi criado.");
    let lastError;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      let sessionId;
      let catalogValidated = false;
      try {
        const initializeBody = JSON.stringify({
          jsonrpc: "2.0",
          id: attempt,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "install-check", version: "1.0" }
          }
        });
        const unauthenticated = await fetch("http://proxy:8080/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json"
          },
          body: initializeBody,
          signal: AbortSignal.timeout(5000)
        });
        if (unauthenticated.status !== 401) {
          const body = await unauthenticated.text();
          throw new Error(`MCP aceitou chamada sem token: HTTP ${unauthenticated.status} ${body}`);
        }
        const response = await fetch("http://proxy:8080/mcp", {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            authorization: `Bearer ${systemToken}`
          },
          body: initializeBody,
          signal: AbortSignal.timeout(5000)
        });
        const body = await response.text();
        if (response.ok && body.includes("\"result\"")) {
          sessionId = response.headers.get("mcp-session-id");
          if (!sessionId) throw new Error("MCP initialize não retornou Mcp-Session-Id.");
          const headers = {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            authorization: `Bearer ${systemToken}`,
            "mcp-session-id": sessionId
          };
          await fetch("http://proxy:8080/mcp", {
            method: "POST",
            headers,
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/initialized",
              params: {}
            }),
            signal: AbortSignal.timeout(5000)
          });

          const requiredTools = new Set([
            "search_graph",
            "query_graph",
            "trace_path",
            "get_code_snippet",
            "get_graph_schema",
            "get_architecture",
            "search_code",
            "list_projects",
            "index_status",
            "detect_changes"
          ]);
          const advertisedTools = new Set();
          let cursor;
          do {
            const listResponse = await fetch("http://proxy:8080/mcp", {
              method: "POST",
              headers,
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: `tools-${cursor || "first"}`,
                method: "tools/list",
                params: cursor ? { cursor } : {}
              }),
              signal: AbortSignal.timeout(10000)
            });
            const listBody = await listResponse.text();
            const dataLine = listBody.split("\n").find(line => line.startsWith("data:"));
            if (!listResponse.ok || !dataLine) {
              throw new Error(`tools/list falhou: HTTP ${listResponse.status} ${listBody}`);
            }
            const payload = JSON.parse(dataLine.slice(5));
            for (const tool of payload.result?.tools || []) advertisedTools.add(tool.name);
            cursor = payload.result?.nextCursor;
          } while (cursor);

          const missingTools = [...requiredTools].filter(name => !advertisedTools.has(name));
          if (missingTools.length) {
            const error = new Error(
              `Catálogo MCP incompatível; ferramentas ausentes: ${missingTools.join(", ")}. ` +
              `Ferramentas anunciadas: ${[...advertisedTools].sort().join(", ") || "nenhuma"}. ` +
              "Atualize o binário codebase-memory-mcp antes de concluir a instalação."
            );
            error.code = "MCP_CATALOG_INCOMPATIBLE";
            throw error;
          }
          catalogValidated = true;
        }
        lastError = new Error(`HTTP ${response.status} ${body}`);
      } catch (error) {
        if (error?.code === "MCP_CATALOG_INCOMPATIBLE") throw error;
        lastError = error;
      } finally {
        if (sessionId) {
          try {
            await fetch("http://proxy:8080/mcp", {
              method: "DELETE",
              headers: {
                authorization: `Bearer ${systemToken}`,
                "mcp-session-id": sessionId
              },
              signal: AbortSignal.timeout(5000)
            });
          } catch {
            // A validação original é mais importante que uma falha de limpeza.
          }
        }
      }
      if (catalogValidated) process.exit(0);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`MCP initialize não ficou disponível: ${lastError?.message}`);
  ' || {
    docker_compose logs --tail=200 agentgateway-config agentgateway agentgateway-ready proxy
    return 1
  }
}

validate_openwebui_command() {
  local openwebui_port
  openwebui_port="$(sed -n 's/^OPENWEBUI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  docker_compose wait openwebui-bootstrap
  curl -fsS "http://127.0.0.1:${openwebui_port}/health" >/dev/null || {
    if [[ "$OLLAMA_RUNTIME" == docker ]]; then
      docker_compose logs --tail=200 ollama docling open-webui openwebui-bootstrap
    else
      docker_compose logs --tail=200 docling open-webui openwebui-bootstrap
    fi
    return 1
  }
}

validate_ollama_gpu_command() {
  local visible_uuids device_id
  local -a expected_devices=()
  [[ "$OLLAMA_RUNTIME" == docker && "$OLLAMA_GPU_MODE" != cpu ]] || return 0
  visible_uuids="$(docker_compose exec -T ollama nvidia-smi --query-gpu=uuid --format=csv,noheader | sed '/^[[:space:]]*$/d' | paste -sd, - | tr -d '[:space:]')"
  [[ -n "$visible_uuids" ]] || {
    docker_compose logs --tail=200 ollama
    return 1
  }
  if [[ "$OLLAMA_GPU_MODE" == selected ]]; then
    IFS=',' read -ra expected_devices <<<"$OLLAMA_GPU_DEVICE_IDS"
    for device_id in "${expected_devices[@]}"; do
      [[ ",${visible_uuids}," == *",${device_id},"* ]] || {
        printf 'GPU selecionada não visível no container: %s\n' "$device_id" >&2
        return 1
      }
    done
  fi
  printf 'GPUs visíveis no container Ollama: %s\n' "$visible_uuids"
}

restart_and_validate_knowledge_sync_command() {
  docker_compose up -d --build --force-recreate knowledge-sync
  docker_compose exec -T admin node --input-type=module -e '
    const { readFile } = await import("node:fs/promises");
    const token = (await readFile("/data/app/secrets/knowledge-sync/knowledge-sync-token", "utf8")).trim();
    let lastError;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const health = await fetch("http://knowledge-sync:3002/health", { signal: AbortSignal.timeout(3000) });
        const status = await fetch("http://knowledge-sync:3002/api/status", {
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000)
        });
        if (health.ok && status.ok) process.exit(0);
        lastError = new Error(`health=${health.status}, status=${status.status}`);
      } catch (error) { lastError = error; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Worker não ficou disponível: ${lastError?.message}`);
  ' || {
    docker_compose logs --tail=200 knowledge-sync
    return 1
  }
}

migrate_openwebui_admin_command() {
  local openwebui_env="${DATA_DIR}/secrets/openwebui.env"
  local openwebui_port webui_secret auth_payload auth_response token user_id update_payload update_response

  # Em uma instalação nova, o usuário já foi criado com a credencial desejada.
  if [[ -z "$OPENWEBUI_PREVIOUS_EMAIL" || -z "$OPENWEBUI_PREVIOUS_PASSWORD" ]]; then
    ADMIN_PASSWORD=''
    OPENWEBUI_PREVIOUS_PASSWORD=''
    OPENWEBUI_DESIRED_PASSWORD=''
    return 0
  fi

  # Sem mudança de credenciais e com o nome correto, não há migração.
  if [[ "$ADMIN_EMAIL" == "$OPENWEBUI_PREVIOUS_EMAIL" \
    && "$OPENWEBUI_DESIRED_PASSWORD" == "$OPENWEBUI_PREVIOUS_PASSWORD" \
    && "$OPENWEBUI_PREVIOUS_NAME" == "$OPENWEBUI_ADMIN_NAME" ]]; then
    ADMIN_PASSWORD=''
    OPENWEBUI_PREVIOUS_PASSWORD=''
    OPENWEBUI_DESIRED_PASSWORD=''
    return 0
  fi

  openwebui_port="$(sed -n 's/^OPENWEBUI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  auth_payload="$(jq -cn \
    --arg email "$OPENWEBUI_PREVIOUS_EMAIL" \
    --arg password "$OPENWEBUI_PREVIOUS_PASSWORD" \
    '{email:$email,password:$password}')"
  if ! auth_response="$(printf '%s' "$auth_payload" | curl -fsS \
    --max-time 30 \
    "http://127.0.0.1:${openwebui_port}/api/v1/auths/signin" \
    -H 'content-type: application/json' \
    --data-binary @-)"; then
    # Aceita também o estado em que o banco já foi alterado manualmente,
    # mas o arquivo openwebui.env ainda contém a credencial anterior.
    auth_payload="$(jq -cn \
      --arg email "$ADMIN_EMAIL" \
      --arg password "$OPENWEBUI_DESIRED_PASSWORD" \
      '{email:$email,password:$password}')"
    auth_response="$(printf '%s' "$auth_payload" | curl -fsS \
      --max-time 30 \
      "http://127.0.0.1:${openwebui_port}/api/v1/auths/signin" \
      -H 'content-type: application/json' \
      --data-binary @-)"
  fi
  token="$(printf '%s' "$auth_response" | jq -er '.token')"
  user_id="$(printf '%s' "$auth_response" | jq -er '.id')"

  update_payload="$(jq -cn \
    --arg email "$ADMIN_EMAIL" \
    --arg name "$OPENWEBUI_ADMIN_NAME" \
    --arg password "$OPENWEBUI_DESIRED_PASSWORD" \
    '{email:$email,name:$name,password:$password}')"
  update_response="$(printf '%s' "$update_payload" | curl -fsS \
    --max-time 30 \
    "http://127.0.0.1:${openwebui_port}/api/v1/users/${user_id}/update" \
    -H "Authorization: Bearer ${token}" \
    -H 'content-type: application/json' \
    --data-binary @-)"
  printf '%s' "$update_response" | jq -e \
    --arg email "${ADMIN_EMAIL,,}" \
    --arg name "$OPENWEBUI_ADMIN_NAME" \
    '.email == $email and .name == $name and .role == "admin"' >/dev/null

  webui_secret="$(sed -n 's/^WEBUI_SECRET_KEY=//p' "$openwebui_env" | tail -n 1)"
  [[ -n "$webui_secret" ]] || fail "WEBUI_SECRET_KEY não encontrada em ${openwebui_env}."
  write_openwebui_environment \
    "$ADMIN_EMAIL" "$OPENWEBUI_DESIRED_PASSWORD" "$OPENWEBUI_ADMIN_NAME" "$webui_secret"

  ADMIN_PASSWORD=''
  OPENWEBUI_PREVIOUS_PASSWORD=''
  OPENWEBUI_DESIRED_PASSWORD=''
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
  local ui_port agentgateway_ui_port openwebui_port ollama_acceleration ollama_execution
  ui_port="$(sed -n 's/^UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  agentgateway_ui_port="$(sed -n 's/^AGENTGATEWAY_UI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  openwebui_port="$(sed -n 's/^OPENWEBUI_PORT=//p' "$ENV_FILE" | tail -n 1)"
  case "$OLLAMA_GPU_MODE" in
    all) ollama_acceleration='todas as GPUs NVIDIA' ;;
    selected) ollama_acceleration="GPUs ${OLLAMA_GPU_DEVICE_IDS}" ;;
    metal) ollama_acceleration='aceleração nativa Apple (Metal)' ;;
    *) ollama_acceleration='CPU' ;;
  esac
  [[ "$OLLAMA_RUNTIME" == host ]] && ollama_execution='host macOS' || ollama_execution='Docker'
  printf "\n${COLOR_GREEN}${COLOR_BOLD}✔ Instalação concluída${COLOR_RESET}\n\n"
  printf '  Repositórios : %s\n' "$REPOSITORIES_DIR"
  printf '  Cache        : %s\n' "$CACHE_DIR"
  printf '  Ambiente     : %s\n' "$ENV_FILE"
  printf '  Budget       : %s MB\n' "$CBM_MEM_BUDGET_MB"
  printf '  Executável   : %s\n' "$CBM_BIN"
  printf '  E-mail admin : %s\n' "$ADMIN_EMAIL"
  printf '  Modelo Ollama: %s\n' "$OLLAMA_CHAT_MODEL"
  printf '  Execução     : %s\n' "$ollama_execution"
  printf '  Aceleração   : %s\n' "$ollama_acceleration"
  printf '\nConfiguração: auto_index=false, auto_watch=true\n'
  printf '\nUI oficial do Codebase Memory:\n  http://<IP-ou-dominio>:%s/\n' "$ui_port"
  printf '\nPainel administrativo protegido:\n  http://<IP-ou-dominio>:%s/admin/\n\n' "$ui_port"
  printf 'AgentGateway Admin UI protegida:\n  http://<IP-ou-dominio>:%s/mcp-panel/\n' "$agentgateway_ui_port"
  printf '\nEndpoint MCP remoto:\n  http://<IP-ou-dominio>:%s/mcp\n\n' "$ui_port"
  printf 'Open WebUI:\n  http://<IP-ou-dominio>:%s/\n\n' "$openwebui_port"
  printf 'Google Drive  : configure em Bases e Drive no painel administrativo.\n\n'
}

main() {
  printf "\n${COLOR_BOLD}Codebase Memory MCP Server — instalação${COLOR_RESET}\n\n"
  require_supported_system
  printf "${COLOR_BOLD}Configuração inicial${COLOR_RESET}\n"
  info "Responda agora às perguntas necessárias. Depois disso, a instalação seguirá sem interrupções."
  ask_memory_budget
  ask_ollama_runtime
  ask_ollama_model
  ask_ollama_gpu
  ask_proxy_access
  validate_sudo
  keep_sudo_alive
  success "Configuração concluída; iniciando instalação não interativa"
  install_dependencies
  install_host_ollama
  if [[ "$OLLAMA_RUNTIME" == docker && "$OLLAMA_GPU_MODE" != cpu ]]; then
    run_step "Configurando o runtime NVIDIA no Docker" configure_nvidia_runtime_command
  fi
  create_local_structure
  write_ollama_gpu_compose_override
  configure_google_drive_sync
  create_proxy_credentials
  install_codebase_memory
  install_container_codebase_memory
  create_environment_file
  run_step "Aplicando configurações do Codebase Memory" configure_codebase_memory_command
  run_step "Validando a instalação" validate_installation_command
  run_step "Construindo e iniciando o painel administrativo" start_admin_panel_command
  if [[ "$OLLAMA_RUNTIME" == docker && "$OLLAMA_GPU_MODE" != cpu ]]; then
    run_step "Validando o acesso do Ollama às GPUs" validate_ollama_gpu_command
  fi
  run_step "Aguardando o painel ficar disponível" validate_admin_panel_command
  run_step "Aguardando a UI do grafo ficar disponível" validate_graph_ui_command
  run_step "Aguardando a Admin UI do AgentGateway ficar disponível" validate_agentgateway_command
  run_step "Baixando modelos e configurando o Open WebUI" validate_openwebui_command
  run_step "Sincronizando a credencial administrativa do Open WebUI" migrate_openwebui_admin_command
  run_step "Preparando o worker do Google Drive" restart_and_validate_knowledge_sync_command
  show_summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
