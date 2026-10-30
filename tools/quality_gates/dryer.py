#!/usr/bin/env python3
"""
Dryer: Structural Code Duplication Detector (Uncle Bob Standard)
Implementa a fórmula oficial do dryer (Jaccard similarity of structural fingerprints):
    Score = shared fingerprints / all fingerprints seen in either form

Características:
- Normaliza código-fonte removendo comentários, strings literais e identificadores incidentais (nomes de variáveis locais);
- Constrói n-gram fingerprints sintáticos;
- Detecta código clonado mesmo com nomes de variáveis e métodos alterados;
- Padrão oficial: limite de similaridade >= 0.82 (configurável).
"""

import os
import sys
import re
import json
import argparse
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Set, Tuple, Any

KEYWORD_TOKENS = {
    "csharp": {
        "if", "else", "for", "foreach", "while", "do", "switch", "case", "break",
        "continue", "return", "throw", "try", "catch", "finally", "async", "await",
        "var", "new", "class", "public", "private", "protected", "internal", "static",
        "readonly", "using", "namespace", "get", "set", "null", "true", "false"
    },
    "typescript": {
        "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
        "return", "throw", "try", "catch", "finally", "async", "await", "const",
        "let", "var", "function", "class", "export", "import", "from", "default",
        "public", "private", "protected", "static", "null", "undefined", "true", "false"
    }
}

class MethodForm:
    def __init__(self, file_path: str, name: str, start_line: int, end_line: int, raw_body: str, language: str):
        self.file_path = file_path
        self.name = name
        self.start_line = start_line
        self.end_line = end_line
        self.raw_body = raw_body
        self.language = language
        self.normalized_tokens = self._normalize()
        self.fingerprints = self._build_fingerprints(k=4)

    def _normalize(self) -> List[str]:
        # Remove comentários
        clean = re.sub(r'//.*', '', self.raw_body)
        clean = re.sub(r'/\*.*?\*/', '', clean, flags=re.DOTALL)
        # Substitui strings por placeholder estático
        clean = re.sub(r'"([^"\\]|\\.)*"', '"STR"', clean)
        clean = re.sub(r"'([^'\\]|\\.)*'", "'STR'", clean)

        # Tokenização simples
        raw_tokens = re.findall(r'[a-zA-Z_]\w+|[^\s\w]', clean)
        normalized = []
        id_map = {}
        id_counter = 1
        keywords = KEYWORD_TOKENS.get(self.language, set())

        for token in raw_tokens:
            if token in keywords or not token.isidentifier():
                normalized.append(token)
            else:
                if token not in id_map:
                    id_map[token] = f"ID_{id_counter}"
                    id_counter += 1
                normalized.append(id_map[token])
        return normalized

    def _build_fingerprints(self, k: int = 4) -> Set[str]:
        if len(self.normalized_tokens) < k:
            return set([" ".join(self.normalized_tokens)])
        fps = set()
        for i in range(len(self.normalized_tokens) - k + 1):
            fps.add(" ".join(self.normalized_tokens[i:i+k]))
        return fps

def jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    if not set_a or not set_b:
        return 0.0
    intersection = len(set_a.intersection(set_b))
    union = len(set_a.union(set_b))
    return round(intersection / union, 3) if union > 0 else 0.0

def extract_csharp_methods(file_path: Path, root_dir: Path) -> List[MethodForm]:
    methods = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        pattern = re.compile(
            r'^\s*(?:public|private|protected|internal)(?:\s+static)?(?:\s+async)?(?:\s+virtual)?(?:\s+override)?\s+([\w<>[\]?]+)\s+(\w+)\s*\(([^)]*)\)',
            re.MULTILINE
        )

        for match in pattern.finditer(content):
            method_name = match.group(2)
            start_pos = match.start()
            start_line = content[:start_pos].count("\n") + 1

            open_brace = content.find("{", match.end())
            if open_brace == -1 or open_brace - match.end() > 250:
                continue

            depth = 1
            curr = open_brace + 1
            body_chars = []
            while curr < len(content) and depth > 0:
                c = content[curr]
                if c == "{": depth += 1
                elif c == "}": depth -= 1
                body_chars.append(c)
                curr += 1

            if depth == 0:
                end_line = start_line + content[open_brace:curr].count("\n")
                body = "".join(body_chars[:-1]).strip()
                # Considera apenas métodos com corpo substancial (> 4 linhas)
                if body.count("\n") >= 4 and len(body) >= 60:
                    rel_path = str(file_path.relative_to(root_dir) if file_path.is_relative_to(root_dir) else file_path)
                    methods.append(MethodForm(rel_path, method_name, start_line, end_line, body, "csharp"))
    except Exception:
        pass
    return methods

def extract_typescript_methods(file_path: Path, root_dir: Path) -> List[MethodForm]:
    methods = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()

        pattern = re.compile(
            r'^\s*(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:public|private|protected|static)?\s*(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(?:public|private|protected|static)?\s*(\w+)\s*\([^)]*\)\s*(?::\s*[\w<>[\]]+)?\s*\{)',
            re.MULTILINE
        )

        for match in pattern.finditer(content):
            fn_name = match.group(1) or match.group(2) or match.group(3) or "anonymous"
            start_pos = match.start()
            start_line = content[:start_pos].count("\n") + 1

            open_brace = content.find("{", match.end() - 2)
            if open_brace == -1 or open_brace - match.end() > 250:
                continue

            depth = 1
            curr = open_brace + 1
            body_chars = []
            while curr < len(content) and depth > 0:
                c = content[curr]
                if c == "{": depth += 1
                elif c == "}": depth -= 1
                body_chars.append(c)
                curr += 1

            if depth == 0:
                end_line = start_line + content[open_brace:curr].count("\n")
                body = "".join(body_chars[:-1]).strip()
                if body.count("\n") >= 4 and len(body) >= 60:
                    rel_path = str(file_path.relative_to(root_dir) if file_path.is_relative_to(root_dir) else file_path)
                    methods.append(MethodForm(rel_path, fn_name, start_line, end_line, body, "typescript"))
    except Exception:
        pass
    return methods

def find_duplicates(target_path: Path, threshold: float = 0.82, max_files: int = 400) -> List[Dict[str, Any]]:
    root = target_path if target_path.is_dir() else target_path.parent
    files = []
    if target_path.is_file():
        files.append(target_path)
    else:
        for p in target_path.rglob("*"):
            if any(s in p.parts for s in ["bin", "obj", "node_modules", ".git", "Migrations", "dist"]):
                continue
            if p.suffix in [".cs", ".ts", ".tsx", ".js"]:
                files.append(p)
                if len(files) >= max_files:
                    break

    all_methods: List[MethodForm] = []
    for f in files:
        if f.suffix == ".cs":
            all_methods.extend(extract_csharp_methods(f, root))
        elif f.suffix in [".ts", ".tsx", ".js"]:
            all_methods.extend(extract_typescript_methods(f, root))

    duplicate_pairs = []
    # Comparação pairwise por linguagem
    by_lang = defaultdict(list)
    for m in all_methods:
        by_lang[m.language].append(m)

    for lang, methods_list in by_lang.items():
        n = len(methods_list)
        for i in range(n):
            for j in range(i + 1, n):
                m_a = methods_list[i]
                m_b = methods_list[j]
                # Se for no mesmo arquivo e mesmo método, ignora
                if m_a.file_path == m_b.file_path and m_a.start_line == m_b.start_line:
                    continue
                # Se os tamanhos em tokens forem muito discrepantes (> 50%), pula
                len_a = len(m_a.normalized_tokens)
                len_b = len(m_b.normalized_tokens)
                if len_a == 0 or len_b == 0 or (min(len_a, len_b) / max(len_a, len_b) < 0.6):
                    continue

                sim = jaccard_similarity(m_a.fingerprints, m_b.fingerprints)
                if sim >= threshold:
                    duplicate_pairs.append({
                        "similarity": sim,
                        "method_a": {
                            "file": m_a.file_path,
                            "method": m_a.name,
                            "lines": f"{m_a.start_line}-{m_a.end_line}",
                            "tokens": len_a
                        },
                        "method_b": {
                            "file": m_b.file_path,
                            "method": m_b.name,
                            "lines": f"{m_b.start_line}-{m_b.end_line}",
                            "tokens": len_b
                        }
                    })

    duplicate_pairs.sort(key=lambda x: x["similarity"], reverse=True)
    return duplicate_pairs

def main():
    parser = argparse.ArgumentParser(description="Dryer: Detector de Duplicação Estrutural de Código (Uncle Bob)")
    parser.add_argument("path", nargs="?", default=".", help="Diretório ou arquivo a analisar")
    parser.add_argument("--threshold", type=float, default=0.82, help="Limite de similaridade Jaccard (padrão: 0.82)")
    parser.add_argument("--top", type=int, default=10, help="Quantidade de pares de duplicação a exibir")
    parser.add_argument("--json", action="store_true", help="Saída em formato JSON")
    args = parser.parse_args()

    target = Path(args.path).resolve()
    pairs = find_duplicates(target, threshold=args.threshold)

    if args.json:
        print(json.dumps({
            "threshold": args.threshold,
            "total_duplicate_pairs": len(pairs),
            "top_duplicates": pairs[:args.top]
        }, indent=2))
        return

    print("=" * 80)
    print(f"🔍 DRYER REPORT: Candidate Duplicate Code (Jaccard Threshold >= {args.threshold})")
    print(f"Alvo: {target}")
    print(f"Total de pares duplicados encontrados: {len(pairs)}")
    print("=" * 80)

    if not pairs:
        print("✅ QUALITY GATE APROVADO: Nenhuma duplicação estrutural >= 0.82 encontrada!")
        sys.exit(0)

    for idx, p in enumerate(pairs[:args.top], 1):
        a = p["method_a"]
        b = p["method_b"]
        print(f"[{idx}] Similaridade: {p['similarity']*100:.1f}%")
        print(f"    ├─ Método A: {a['method']} ({a['file']}:{a['lines']})")
        print(f"    └─ Método B: {b['method']} ({b['file']}:{b['lines']})")
        print("-" * 80)

    print(f"⚠️ QUALITY GATE FALHOU: {len(pairs)} pares de duplicação violam o princípio DRY!")
    sys.exit(1)

if __name__ == "__main__":
    main()
