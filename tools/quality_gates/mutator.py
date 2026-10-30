#!/usr/bin/env python3
"""
Mutator: Mutation Testing Engine (Uncle Bob Standard)
Aplica mutações deliberadas no código para validar a eficácia real da suíte de testes.

Regras do Uncle Bob:
- O teste DEVE falhar quando o código é quebrado (Mutante MORTO = ✅ Teste eficaz).
- Se os testes continuarem passando após o código quebrar (Mutante SOBREVIVEU = ❌ Teste inútil/cego).
- Taxa de mutação aceitável: >= 80% dos mutantes devem ser mortos pela suíte de testes.
"""

import os
import sys
import re
import json
import shutil
import argparse
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Tuple

MUTATION_OPERATORS = [
    # Comparações de borda (Boundary mutations)
    (r'<=', ' < '),
    (r'>=', ' > '),
    (r'(?<![<>!=])<(?![=<])', ' <= '),
    (r'(?<![<>!=])>(?![=>])', ' >= '),
    # Igualdade
    (r'==', ' != '),
    (r'!=', ' == '),
    # Operadores lógicos
    (r'&&', ' || '),
    (r'\|\|', ' && '),
    # Booleanos
    (r'\btrue\b', 'false'),
    (r'\bfalse\b', 'true'),
    # Aritméticos
    (r'\s+\+\s+', ' - '),
    (r'\s+-\s+', ' + '),
    (r'\s+\*\s+', ' / ')
]

class MutationSite:
    def __init__(self, file_path: str, line_number: int, original_line: str, mutated_line: str, op_desc: str):
        self.file_path = file_path
        self.line_number = line_number
        self.original_line = original_line
        self.mutated_line = mutated_line
        self.op_desc = op_desc
        self.status = "UNTESTED" # KILLED, SURVIVED, UNTESTED

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file": self.file_path,
            "line": self.line_number,
            "original": self.original_line.strip(),
            "mutated": self.mutated_line.strip(),
            "operator": self.op_desc,
            "status": self.status
        }

def find_mutation_sites(file_path: Path, max_sites: int = 25) -> List[MutationSite]:
    sites = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()

        for idx, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                continue

            for pattern, replacement in MUTATION_OPERATORS:
                if re.search(pattern, line):
                    mutated = re.sub(pattern, replacement, line, count=1)
                    if mutated != line:
                        desc = f"Replace {pattern} with {replacement.strip()}"
                        sites.append(MutationSite(str(file_path), idx, line, mutated, desc))
                        if len(sites) >= max_sites:
                            return sites
    except Exception:
        pass
    return sites

def execute_live_mutation(target_file: Path, site: MutationSite, test_command: str) -> bool:
    """Aplica a mutação no arquivo temporariamente, roda os testes e restaura."""
    backup_file = target_file.with_suffix(target_file.suffix + ".mutant.bak")
    shutil.copyfile(target_file, backup_file)
    try:
        with open(target_file, "r", encoding="utf-8") as f:
            lines = f.readlines()
        
        # Substitui a linha pela mutada
        if 0 <= site.line_number - 1 < len(lines):
            lines[site.line_number - 1] = site.mutated_line
        
        with open(target_file, "w", encoding="utf-8") as f:
            f.writelines(lines)

        # Executa o comando de teste com timeout
        res = subprocess.run(test_command, shell=True, capture_output=True, timeout=60)
        # Se o teste falhou (código de saída != 0), o mutante foi MORTO (sucesso do teste!)
        # Se o teste passou (código == 0), o mutante SOBREVIVEU (falha do teste!)
        return res.returncode != 0
    except subprocess.TimeoutExpired:
        # Timeout em mutação é considerado mutante morto (provavelmente causou loop infinito)
        return True
    finally:
        # Restaura o arquivo original
        if backup_file.exists():
            shutil.move(backup_file, target_file)

def main():
    parser = argparse.ArgumentParser(description="Mutator: Testes de Mutação (Uncle Bob Standard)")
    parser.add_argument("file", help="Arquivo de código a testar mutação")
    parser.add_argument("--test-cmd", type=str, default="", help="Comando de teste (ex: 'dotnet test', 'npm test')")
    parser.add_argument("--max-mutants", type=int, default=10, help="Quantidade máxima de mutantes a testar")
    parser.add_argument("--json", action="store_true", help="Saída em formato JSON")
    args = parser.parse_args()

    target_file = Path(args.file).resolve()
    if not target_file.is_file():
        print(f"Erro: Arquivo '{target_file}' não encontrado.")
        sys.exit(1)

    sites = find_mutation_sites(target_file, max_sites=args.max_mutants)
    if not sites:
        print("Nenhum ponto de mutação identificado neste arquivo.")
        sys.exit(0)

    killed = 0
    survived = 0

    if args.test_cmd:
        print(f"[*] Executando testes de mutação com: '{args.test_cmd}'...")
        for idx, site in enumerate(sites, 1):
            is_killed = execute_live_mutation(target_file, site, args.test_cmd)
            if is_killed:
                site.status = "KILLED"
                killed += 1
            else:
                site.status = "SURVIVED"
                survived += 1
            print(f"    Mutante #{idx} (Linha {site.line_number}): {'✅ KILLED' if is_killed else '❌ SURVIVED'}")

    score = round((killed / (killed + survived) * 100), 1) if (killed + survived) > 0 else 0.0

    if args.json:
        print(json.dumps({
            "target": str(target_file),
            "total_mutants": len(sites),
            "killed": killed,
            "survived": survived,
            "mutation_score": score,
            "mutants": [s.to_dict() for s in sites]
        }, indent=2))
        return

    print("=" * 80)
    print(f"🧪 MUTATOR REPORT: Mutation Testing Quality Gate")
    print(f"Arquivo: {target_file.name}")
    print(f"Mutantes analisados: {len(sites)} | Mortos: {killed} | Sobreviventes: {survived} | Score: {score}%")
    print("=" * 80)

    for idx, s in enumerate(sites, 1):
        status_flag = "✅ MORTO" if s.status == "KILLED" else ("❌ SOBREVIVEU" if s.status == "SURVIVED" else "ℹ️ PENDENTE")
        print(f"[{idx}] Linha {s.line_number} | {status_flag}")
        print(f"    Original: {s.original_line.strip()}")
        print(f"    Mutado:   {s.mutated_line.strip()}")
        print("-" * 80)

    if args.test_cmd and survived > 0:
        print(f"⚠️ QUALITY GATE FALHOU: {survived} mutantes sobreviveram! Seus testes não protegem o código.")
        sys.exit(1)
    elif args.test_cmd:
        print("✅ QUALITY GATE APROVADO: Todos os mutantes foram mortos pelos testes!")
        sys.exit(0)

if __name__ == "__main__":
    main()
