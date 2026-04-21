import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { LanguageAdapter, ParsedDeps, SandboxInfo, EntryPoint } from './base.js';
import { emptyParsedDeps } from './base.js';

const RUN_SCRIPTS = ['start', 'serve', 'dev', 'develop'];
const BUILD_SCRIPTS = ['build', 'compile', 'bundle'];

export class NodeAdapter implements LanguageAdapter {
  readonly name = 'node' as const;

  detect(tree: string[], _files: Record<string, string>): number {
    let score = 0;
    if (tree.includes('package.json')) score += 0.5;
    if (tree.includes('package-lock.json') || tree.includes('yarn.lock') || tree.includes('pnpm-lock.yaml')) {
      score += 0.2;
    }
    const jstsCount = tree.filter(f => f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.mjs') || f.endsWith('.cjs')).length;
    if (jstsCount > 0) score += Math.min(jstsCount / 20, 0.3);
    return Math.min(score, 1.0);
  }

  private _pickPackageManager(tree: string[]): string {
    if (tree.includes('pnpm-lock.yaml')) return 'pnpm';
    if (tree.includes('yarn.lock')) return 'yarn';
    return 'npm';
  }

  parseDeps(workdir: string, tree: string[], files: Record<string, string>): ParsedDeps {
    const parsed = emptyParsedDeps();
    const pm = this._pickPackageManager(tree);
    parsed.packageManagers.push(pm);

    // Detect dep files
    for (const f of ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      if (tree.includes(f)) parsed.depFiles.push(f);
    }

    // Parse package.json
    const pkgContent = files['package.json'];
    if (pkgContent) {
      let pkg: Record<string, unknown> = {};
      try {
        pkg = JSON.parse(pkgContent) as Record<string, unknown>;
      } catch {
        return parsed;
      }

      // Collect dependencies
      const deps = pkg['dependencies'] as Record<string, string> | undefined;
      const devDeps = pkg['devDependencies'] as Record<string, string> | undefined;
      if (deps) parsed.declaredDeps.push(...Object.keys(deps));
      if (devDeps) parsed.declaredDeps.push(...Object.keys(devDeps));

      // Extract relevant scripts
      const scripts = pkg['scripts'] as Record<string, string> | undefined;
      if (scripts) {
        const relevantScripts = [...RUN_SCRIPTS, ...BUILD_SCRIPTS];
        for (const s of relevantScripts) {
          if (scripts[s]) {
            parsed.candidateEntryPoints.push({ kind: 'script', value: s, source: 'package.json' });
          }
        }
      }

      // main field
      const main = pkg['main'] as string | undefined;
      if (main) {
        parsed.candidateEntryPoints.push({ kind: 'main', value: main, source: 'package.json' });
      }

      // bin field
      const bin = pkg['bin'];
      if (typeof bin === 'string') {
        parsed.candidateEntryPoints.push({ kind: 'bin', value: bin, source: 'package.json' });
      } else if (bin && typeof bin === 'object') {
        for (const [, v] of Object.entries(bin as Record<string, string>)) {
          parsed.candidateEntryPoints.push({ kind: 'bin', value: v, source: 'package.json' });
        }
      }

      // App type heuristic
      const allDepNames = deps ? Object.keys(deps) : [];
      const webFrameworks = ['express', 'fastify', 'koa', 'next', 'nuxt', 'hapi', '@hapi/hapi', '@nestjs/core', 'nestjs'];
      if (allDepNames.some(d => webFrameworks.includes(d))) {
        parsed.appTypeHint = 'web';
      } else if (bin) {
        parsed.appTypeHint = 'cli';
      } else if (scripts && scripts['start']) {
        parsed.appTypeHint = 'web';
      }
    }

    return parsed;
  }

  bootstrapSandbox(workdir: string): SandboxInfo {
    const prefixDir = path.join(workdir, '.shirim-npm-prefix');
    const cacheDir = path.join(workdir, '.shirim-npm-cache');
    fs.mkdirSync(prefixDir, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });

    const notes: string[] = [];

    // Check if pnpm or yarn is needed and install if missing
    const pkgJsonPath = path.join(workdir, 'package.json');
    let pm = 'npm';
    if (fs.existsSync(path.join(workdir, 'pnpm-lock.yaml'))) {
      pm = 'pnpm';
    } else if (fs.existsSync(path.join(workdir, 'yarn.lock'))) {
      pm = 'yarn';
    }

    if (pm === 'pnpm' || pm === 'yarn') {
      const check = spawnSync(pm, ['--version'], { stdio: 'pipe' });
      if (check.status !== 0) {
        notes.push(`Installing ${pm} globally via npm...`);
        spawnSync('npm', ['install', '-g', pm], {
          stdio: 'pipe',
          env: {
            ...process.env,
            NPM_CONFIG_PREFIX: prefixDir,
            NPM_CONFIG_CACHE: cacheDir,
          },
        });
      }
    }

    const binDir = path.join(prefixDir, 'bin');

    return {
      env: {
        NPM_CONFIG_PREFIX: prefixDir,
        NPM_CONFIG_CACHE: cacheDir,
      },
      pathPrepend: [binDir],
      notes,
    };
  }

  installCmd(parsed: ParsedDeps): string {
    const pm = parsed.packageManagers[0] ?? 'npm';
    if (pm === 'pnpm') return 'pnpm install --frozen-lockfile';
    if (pm === 'yarn') return 'yarn install --frozen-lockfile';
    if (parsed.depFiles.includes('package-lock.json')) return 'npm ci';
    return 'npm install';
  }

  smokeRunCandidates(parsed: ParsedDeps): string[] {
    const candidates: string[] = [];
    for (const ep of parsed.candidateEntryPoints) {
      if (ep.kind === 'script') {
        const pm = parsed.packageManagers[0] ?? 'npm';
        if (ep.value === 'test') {
          candidates.push(`${pm} test`);
        } else if (ep.value === 'start') {
          candidates.push(`${pm} start`);
        }
      } else if (ep.kind === 'bin') {
        candidates.push(`node ${ep.value}`);
      } else if (ep.kind === 'main') {
        candidates.push(`node ${ep.value}`);
      }
    }
    return candidates;
  }
}
