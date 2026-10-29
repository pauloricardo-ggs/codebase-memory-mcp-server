#!/usr/bin/env python3
"""
HG Log & Metric Collector (100% Read-Only)
Coleta metadados, consumo de recursos e logs de containers do servidor HG via SSH.
"""

import subprocess
import json
import os
import sys
import datetime
from pathlib import Path

BASE_DIR = Path("/home/ma9/codebase-memory-mcp-server")
DATA_DIR = BASE_DIR / "data" / "hg_snapshots"
SSH_HOST = "hg"

def run_ssh_command(cmd: str, timeout: int = 45) -> str:
    """Executa um comando somente-leitura no servidor HG via SSH."""
    full_cmd = ["ssh", "-o", "ConnectTimeout=10", SSH_HOST, cmd]
    try:
        res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=timeout)
        if res.returncode != 0:
            print(f"[WARN] Comando '{cmd[:50]}...' retornou código {res.returncode}: {res.stderr.strip()}", file=sys.stderr)
        return res.stdout
    except subprocess.TimeoutExpired:
        print(f"[ERROR] Timeout ao executar comando no HG: {cmd[:50]}...", file=sys.stderr)
        return ""
    except Exception as e:
        print(f"[ERROR] Falha de conexão SSH: {e}", file=sys.stderr)
        return ""

def collect_snapshot(since: str = None) -> Path:
    """
    Coleta o snapshot completo de HG.
    :param since: formato compatível com docker logs (ex: '2026-10-19T08:00:00' ou '12h')
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    snapshot_dir = DATA_DIR / timestamp_str
    logs_dir = snapshot_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    print(f"[*] Iniciando coleta de snapshot HG em: {snapshot_dir}")

    # 1. Coleta de Inventário de Containers
    print("[*] Coletando lista e tags dos containers...")
    ps_raw = run_ssh_command('docker ps --format "{{json .}}"')
    containers = []
    for line in ps_raw.strip().splitlines():
        if line.strip():
            try:
                containers.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    with open(snapshot_dir / "inventory.json", "w", encoding="utf-8") as f:
        json.dump(containers, f, indent=2, ensure_ascii=False)
    print(f"[*] {len(containers)} containers ativos identificados.")

    # 2. Coleta de Métricas de Recursos (docker stats)
    print("[*] Coletando métricas de CPU/RAM (docker stats)...")
    stats_raw = run_ssh_command('docker stats --no-stream --format "{{json .}}"')
    stats = []
    for line in stats_raw.strip().splitlines():
        if line.strip():
            try:
                stats.append(json.loads(line))
            except json.JSONDecodeError:
                pass

    with open(snapshot_dir / "stats.json", "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    # 3. Coleta de Logs de cada container
    since_arg = f"--since '{since}'" if since else "--since '12h'"
    print(f"[*] Coletando logs com filtro de tempo: {since_arg}...")

    collected_logs_count = 0
    total_log_bytes = 0

    for c in containers:
        c_name = c.get("Names") or c.get("ID")
        if not c_name:
            continue

        log_cmd = f"docker logs {since_arg} {c_name} 2>&1"
        container_log = run_ssh_command(log_cmd, timeout=30)

        log_file = logs_dir / f"{c_name}.log"
        with open(log_file, "w", encoding="utf-8", errors="replace") as f:
            f.write(container_log)

        log_size = len(container_log.encode("utf-8"))
        total_log_bytes += log_size
        collected_logs_count += 1
        lines_count = len(container_log.splitlines())
        print(f"    - {c_name}: {lines_count} linhas ({log_size / 1024:.1f} KB)")

    meta = {
        "timestamp": now.isoformat(),
        "since": since or "12h",
        "container_count": len(containers),
        "total_log_bytes": total_log_bytes,
        "snapshot_path": str(snapshot_dir)
    }
    with open(snapshot_dir / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"[✓] Coleta concluída com sucesso! Total: {total_log_bytes / 1024:.1f} KB em {snapshot_dir}")
    return snapshot_dir

if __name__ == "__main__":
    since_param = sys.argv[1] if len(sys.argv) > 1 else None
    collect_snapshot(since=since_param)
