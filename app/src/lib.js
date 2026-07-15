import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

export function assertSafeSegment(value, label = 'identificador') {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error(`${label} inválido.`);
  }
  return value;
}

export function safeChild(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const result = path.resolve(resolvedRoot, ...segments);
  if (result !== resolvedRoot && !result.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Caminho fora da raiz permitida.');
  }
  return result;
}

export async function loadState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { workspaces: parsed.workspaces ?? [], repositories: parsed.repositories ?? [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { workspaces: [], repositories: [] };
    throw error;
  }
}

export async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const limit = options.outputLimit ?? 200_000;
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-limit); options.onOutput?.(chunk.toString()); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-limit); options.onOutput?.(chunk.toString()); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(Object.assign(new Error(stderr.trim() || stdout.trim() || `${command} terminou com código ${code}.`), { code, stdout, stderr }));
    });
  });
}
