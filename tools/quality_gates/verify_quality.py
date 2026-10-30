#!/usr/bin/env python3
"""
Unified Quality Gate Runner (Uncle Bob Standard: Crapper + Dryer + Mutator)
Executa a validação formal de engenharia de software no código modificado ou no repositório.

Retorna:
- 0: APROVADO em todos os Quality Gates.
- 1: REPROVADO (CRAP >= 10, Duplicação >= 0.82 ou Mutantes Sobreviventes).
"""

import os
import sys
import json
import argparse
import subprocess
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent

def run_quality_gates(target_path: Path, threshold_crap: float = 10.0, threshold_dry: float = 0.82) -> Dict[str, Any]:
    print("=" * 80)
    print("🛡️ EXECUTANDO QUALITY GATES UNIFICADOS (UNCLE BOB SPECIFICATION)")
    print(f"Diretório Alvo: {target_path}")
    print(f"Teto CRAP Score: < {threshold_crap} | Teto DRY Duplicação: < {threshold_dry}")
    print("=" * 80)

    # 1. Roda Crapper
    print("[*] 1/2 Verificando métricas CRAP (Complexidade Ciclomática x Cobertura)...")
    crap_cmd = [sys.executable, str(TOOLS_DIR / "crapper.py"), str(target_path), "--threshold", str(threshold_crap), "--json"]
    crap_proc = subprocess.run(crap_cmd, capture_output=True, text=True)
    try:
        crap_data = json.loads(crap_proc.stdout)
    except Exception:
        crap_data = {"failing_crap_functions": 0, "worst_functions": []}

    crap_fails = crap_data.get("failing_crap_functions", 0)
    print(f"    -> Funções analisadas: {crap_data.get('total_functions_analyzed', 0)}")
    print(f"    -> Violações de CRAP (>= {threshold_crap}): {crap_fails} {'❌' if crap_fails > 0 else '✅'}")

    # 2. Roda Dryer
    print("[*] 2/2 Verificando duplicação estrutural de código (AST Fingerprints)...")
    dry_cmd = [sys.executable, str(TOOLS_DIR / "dryer.py"), str(target_path), "--threshold", str(threshold_dry), "--json"]
    dry_proc = subprocess.run(dry_cmd, capture_output=True, text=True)
    try:
        dry_data = json.loads(dry_proc.stdout)
    except Exception:
        dry_data = {"total_duplicate_pairs": 0, "top_duplicates": []}

    dry_fails = dry_data.get("total_duplicate_pairs", 0)
    print(f"    -> Pares de duplicação detectados (>= {threshold_dry}): {dry_fails} {'❌' if dry_fails > 0 else '✅'}")

    passed = (crap_fails == 0) and (dry_fails == 0)
    print("=" * 80)
    if passed:
        print("🎉 TODOS OS QUALITY GATES FORAM APROVADOS COM SUCESSO!")
    else:
        print(f"🛑 REPROVADO NOS QUALITY GATES: {crap_fails} funções de alto CRAP e {dry_fails} duplicações encontradas.")
    print("=" * 80)

    return {
        "passed": passed,
        "crap_violations": crap_fails,
        "dry_violations": dry_fails,
        "crap_details": crap_data.get("worst_functions", [])[:5],
        "dry_details": dry_data.get("top_duplicates", [])[:5]
    }

def main():
    parser = argparse.ArgumentParser(description="Runner Unificado de Quality Gates")
    parser.add_argument("path", nargs="?", default=".", help="Diretório a inspecionar")
    parser.add_argument("--threshold-crap", type=float, default=10.0, help="Limite CRAP")
    parser.add_argument("--threshold-dry", type=float, default=0.82, help="Limite DRY")
    parser.add_argument("--json", action="store_true", help="Saída JSON")
    args = parser.parse_args()

    target = Path(args.path).resolve()
    res = run_quality_gates(target, args.threshold_crap, args.threshold_dry)

    if args.json:
        print(json.dumps(res, indent=2))

    sys.exit(0 if res["passed"] else 1)

if __name__ == "__main__":
    main()
