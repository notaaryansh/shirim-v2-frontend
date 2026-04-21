import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { LanguageAdapter, ParsedDeps, SandboxInfo } from './base.js';
import { emptyParsedDeps } from './base.js';

const PY_DEP_FILES = ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'setup.cfg'];
const WEB_FRAMEWORKS_RE = /\b(fastapi|flask|django|starlette|sanic|tornado|aiohttp|bottle|falcon|quart|litestar)\b/i;
const ENTRY_POINT_CANDIDATES = ['__main__.py', 'main.py', 'app.py', 'server.py', 'cli.py', 'manage.py', 'run.py'];

export class PythonAdapter implements LanguageAdapter {
  readonly name = 'python' as const;

  detect(tree: string[], _files: Record<string, string>): number {
    let score = 0;
    for (const f of PY_DEP_FILES) {
      if (tree.includes(f)) {
        score += 0.4;
        break;
      }
    }
    const pyCount = tree.filter(f => f.endsWith('.py')).length;
    if (pyCount > 0) score += Math.min(pyCount / 20, 0.4);
    if (tree.includes('Pipfile.lock')) score += 0.1;
    if (tree.includes('poetry.lock')) score += 0.1;
    return Math.min(score, 1.0);
  }

  parseDeps(workdir: string, tree: string[], files: Record<string, string>): ParsedDeps {
    const parsed = emptyParsedDeps();

    // Detect dep files
    for (const f of PY_DEP_FILES) {
      if (tree.includes(f)) parsed.depFiles.push(f);
    }
    if (tree.includes('Pipfile.lock')) parsed.depFiles.push('Pipfile.lock');
    if (tree.includes('poetry.lock')) parsed.depFiles.push('poetry.lock');

    // Package manager heuristic
    if (tree.includes('Pipfile')) {
      parsed.packageManagers.push('pipenv');
    } else if (tree.includes('poetry.lock') || this._hasPoetrySection(files['pyproject.toml'])) {
      parsed.packageManagers.push('poetry');
    } else {
      parsed.packageManagers.push('pip');
    }

    // Parse requirements.txt
    const reqContent = files['requirements.txt'];
    if (reqContent) {
      for (const line of reqContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
        // Strip version specifiers: e.g. "flask>=2.0" -> "flask"
        const depName = trimmed.split(/[>=<!\[;@\s]/)[0].trim();
        if (depName) parsed.declaredDeps.push(depName);
      }
    }

    // Parse pyproject.toml with regex
    const pyprojectContent = files['pyproject.toml'];
    if (pyprojectContent) {
      this._parsePyprojectDeps(pyprojectContent, parsed);
    }

    // Heuristic entry points
    for (const ep of ENTRY_POINT_CANDIDATES) {
      if (tree.includes(ep)) {
        parsed.candidateEntryPoints.push({ kind: 'file', value: ep, source: 'heuristic' });
      }
    }

    // Also check for package-style __main__.py in subdirs
    for (const f of tree) {
      if (f.endsWith('/__main__.py') && !parsed.candidateEntryPoints.some(e => e.value === f)) {
        const pkg = path.dirname(f);
        parsed.candidateEntryPoints.push({ kind: 'module', value: pkg, source: 'heuristic' });
      }
    }

    // Web framework detection via deps
    const allDepsStr = parsed.declaredDeps.join(' ');
    if (WEB_FRAMEWORKS_RE.test(allDepsStr)) {
      parsed.appTypeHint = 'web';
    }

    // Scan file contents for web frameworks if app type still unknown
    if (parsed.appTypeHint === 'unknown') {
      for (const [fname, content] of Object.entries(files)) {
        if (fname.endsWith('.py') && WEB_FRAMEWORKS_RE.test(content)) {
          parsed.appTypeHint = 'web';
          break;
        }
      }
    }

    // README code fence scanning for entry point hints
    const readme = files['README.md'] ?? files['README.rst'] ?? files['readme.md'];
    if (readme) {
      const fenceRe = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;
      let match: RegExpExecArray | null;
      while ((match = fenceRe.exec(readme)) !== null) {
        const block = match[1];
        const runMatch = block.match(/python[3]?\s+([\w./-]+\.py)/);
        if (runMatch && !parsed.candidateEntryPoints.some(e => e.value === runMatch[1])) {
          parsed.candidateEntryPoints.push({ kind: 'file', value: runMatch[1], source: 'README' });
        }
      }
    }

    // CLI detection if no web hint
    if (parsed.appTypeHint === 'unknown') {
      const cliIndicators = ['click', 'typer', 'argparse', 'fire'];
      if (parsed.declaredDeps.some(d => cliIndicators.includes(d.toLowerCase()))) {
        parsed.appTypeHint = 'cli';
      }
    }

    return parsed;
  }

  private _hasPoetrySection(content: string | undefined): boolean {
    if (!content) return false;
    return /\[tool\.poetry\b/.test(content);
  }

  private _parsePyprojectDeps(content: string, parsed: ParsedDeps): void {
    // Extract [project] dependencies = [...]
    const projectDepsRe = /\[project\]\s[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/;
    const projectMatch = projectDepsRe.exec(content);
    if (projectMatch) {
      this._extractDepsFromArray(projectMatch[1], parsed);
    }

    // Extract [tool.poetry.dependencies]
    const poetryDepsRe = /\[tool\.poetry\.dependencies\]\s*\n((?:[^\[]*\n)*)/;
    const poetryMatch = poetryDepsRe.exec(content);
    if (poetryMatch) {
      for (const line of poetryMatch[1].split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const depName = trimmed.slice(0, eqIdx).trim();
          if (depName !== 'python') parsed.declaredDeps.push(depName);
        }
      }
    }
  }

  private _extractDepsFromArray(arrayContent: string, parsed: ParsedDeps): void {
    const depLineRe = /["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = depLineRe.exec(arrayContent)) !== null) {
      const depStr = match[1];
      const depName = depStr.split(/[>=<!\[;@\s]/)[0].trim();
      if (depName) parsed.declaredDeps.push(depName);
    }
  }

  bootstrapSandbox(workdir: string): SandboxInfo {
    const venvDir = path.join(workdir, '.shirim-venv');
    const notes: string[] = [];

    if (!fs.existsSync(venvDir)) {
      notes.push('Creating Python virtual environment...');
      const result = spawnSync('python3', ['-m', 'venv', venvDir], {
        stdio: 'pipe',
        cwd: workdir,
      });
      if (result.status !== 0) {
        notes.push(`Warning: venv creation failed: ${result.stderr?.toString() ?? 'unknown error'}`);
      }
    }

    const binDir = path.join(venvDir, 'bin');

    return {
      env: {
        VIRTUAL_ENV: venvDir,
      },
      pathPrepend: [binDir],
      notes,
    };
  }

  installCmd(parsed: ParsedDeps): string {
    const pm = parsed.packageManagers[0] ?? 'pip';
    if (pm === 'pipenv') return 'pipenv install';
    if (pm === 'poetry') return 'poetry install';
    if (parsed.depFiles.includes('requirements.txt')) {
      return 'pip install -r requirements.txt';
    }
    if (parsed.depFiles.includes('pyproject.toml')) {
      return 'pip install .';
    }
    if (parsed.depFiles.includes('setup.py')) {
      return 'pip install .';
    }
    return 'pip install .';
  }

  smokeRunCandidates(parsed: ParsedDeps): string[] {
    const candidates: string[] = [];
    for (const ep of parsed.candidateEntryPoints) {
      if (ep.kind === 'file') {
        candidates.push(`python3 ${ep.value}`);
      } else if (ep.kind === 'module') {
        candidates.push(`python3 -m ${ep.value.replace(/\//g, '.')}`);
      }
    }
    return candidates;
  }
}
