import fs from 'fs';
import path from 'path';
import type { LanguageAdapter, ParsedDeps, SandboxInfo } from './base.js';
import { emptyParsedDeps } from './base.js';

const GO_WEB_FRAMEWORKS = [
  'github.com/gin-gonic/gin',
  'github.com/labstack/echo',
  'github.com/gorilla/mux',
  'github.com/go-chi/chi',
  'github.com/gofiber/fiber',
  'github.com/valyala/fasthttp',
  'net/http',
];

export class GoAdapter implements LanguageAdapter {
  readonly name = 'go' as const;

  detect(tree: string[], _files: Record<string, string>): number {
    let score = 0;
    if (tree.includes('go.mod')) score += 0.5;
    if (tree.includes('go.sum')) score += 0.1;
    const goCount = tree.filter(f => f.endsWith('.go')).length;
    if (goCount > 0) score += Math.min(goCount / 20, 0.4);
    return Math.min(score, 1.0);
  }

  parseDeps(workdir: string, tree: string[], files: Record<string, string>): ParsedDeps {
    const parsed = emptyParsedDeps();
    parsed.packageManagers.push('go');

    if (tree.includes('go.mod')) parsed.depFiles.push('go.mod');
    if (tree.includes('go.sum')) parsed.depFiles.push('go.sum');

    // Parse go.mod
    const goModContent = files['go.mod'];
    if (goModContent) {
      // Extract module name
      const moduleMatch = goModContent.match(/^module\s+(\S+)/m);
      if (moduleMatch) {
        parsed.extras['moduleName'] = moduleMatch[1];
      }

      // Extract require block
      const requireBlockRe = /require\s*\(([\s\S]*?)\)/g;
      let blockMatch: RegExpExecArray | null;
      while ((blockMatch = requireBlockRe.exec(goModContent)) !== null) {
        for (const line of blockMatch[1].split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('//')) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            parsed.declaredDeps.push(parts[0]);
          }
        }
      }

      // Single-line requires: require github.com/foo/bar v1.0.0
      const singleReqRe = /^require\s+(\S+)\s+\S+/gm;
      let singleMatch: RegExpExecArray | null;
      while ((singleMatch = singleReqRe.exec(goModContent)) !== null) {
        if (!parsed.declaredDeps.includes(singleMatch[1])) {
          parsed.declaredDeps.push(singleMatch[1]);
        }
      }
    }

    // Scan .go files for package main + func main()
    const mainPackages: Set<string> = new Set();
    for (const f of tree) {
      if (!f.endsWith('.go')) continue;
      const content = files[f];
      if (!content) continue;
      if (/^package\s+main\b/m.test(content) && /func\s+main\s*\(\s*\)/.test(content)) {
        const dir = path.dirname(f) || '.';
        mainPackages.add(dir);
        parsed.candidateEntryPoints.push({ kind: 'main_package', value: dir, source: f });
      }
    }

    // App type heuristic
    if (parsed.declaredDeps.some(d => GO_WEB_FRAMEWORKS.some(fw => d.includes(fw)))) {
      parsed.appTypeHint = 'web';
    } else if (mainPackages.size > 0) {
      parsed.appTypeHint = 'cli';
    }

    // Also scan source for net/http imports
    if (parsed.appTypeHint !== 'web') {
      for (const f of tree) {
        if (!f.endsWith('.go')) continue;
        const content = files[f];
        if (content && /\"net\/http\"/.test(content)) {
          parsed.appTypeHint = 'web';
          break;
        }
      }
    }

    return parsed;
  }

  bootstrapSandbox(workdir: string): SandboxInfo {
    const gopath = path.join(workdir, '.shirim-gopath');
    const gocache = path.join(workdir, '.shirim-gocache');
    const gomodcache = path.join(gopath, 'pkg', 'mod');

    fs.mkdirSync(gopath, { recursive: true });
    fs.mkdirSync(gocache, { recursive: true });
    fs.mkdirSync(gomodcache, { recursive: true });

    return {
      env: {
        GOPATH: gopath,
        GOMODCACHE: gomodcache,
        GOCACHE: gocache,
        GOFLAGS: '-modcacherw',
      },
      pathPrepend: [path.join(gopath, 'bin')],
      notes: [],
    };
  }

  installCmd(_parsed: ParsedDeps): string {
    return 'go mod download';
  }

  smokeRunCandidates(parsed: ParsedDeps): string[] {
    const candidates: string[] = [];
    const mainPkgs = parsed.candidateEntryPoints.filter(e => e.kind === 'main_package');

    if (mainPkgs.length > 0) {
      // cargo check equivalent
      candidates.push('go build ./...');
      for (const ep of mainPkgs) {
        const dir = ep.value === '.' ? '.' : `./${ep.value}`;
        candidates.push(`go run ${dir}`);
      }
    } else {
      candidates.push('go build ./...');
    }

    return candidates;
  }
}
