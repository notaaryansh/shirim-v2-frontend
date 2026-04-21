import fs from 'fs';
import path from 'path';
import type { LanguageAdapter, ParsedDeps, SandboxInfo } from './base.js';
import { emptyParsedDeps } from './base.js';

const RUST_WEB_FRAMEWORKS = ['actix-web', 'rocket', 'axum', 'warp', 'hyper', 'tide', 'poem'];

export class RustAdapter implements LanguageAdapter {
  readonly name = 'rust' as const;

  detect(tree: string[], _files: Record<string, string>): number {
    let score = 0;
    if (tree.includes('Cargo.toml')) score += 0.5;
    if (tree.includes('Cargo.lock')) score += 0.1;
    const rsCount = tree.filter(f => f.endsWith('.rs')).length;
    if (rsCount > 0) score += Math.min(rsCount / 20, 0.4);
    return Math.min(score, 1.0);
  }

  parseDeps(workdir: string, tree: string[], files: Record<string, string>): ParsedDeps {
    const parsed = emptyParsedDeps();
    parsed.packageManagers.push('cargo');

    if (tree.includes('Cargo.toml')) parsed.depFiles.push('Cargo.toml');
    if (tree.includes('Cargo.lock')) parsed.depFiles.push('Cargo.lock');

    const cargoContent = files['Cargo.toml'];
    if (cargoContent) {
      this._parseCargoToml(cargoContent, parsed);
    }

    // Look for [[bin]] entries
    if (cargoContent) {
      const binRe = /\[\[bin\]\]\s*\n((?:[^\[]*\n)*)/g;
      let binMatch: RegExpExecArray | null;
      while ((binMatch = binRe.exec(cargoContent)) !== null) {
        const block = binMatch[1];
        const nameMatch = block.match(/name\s*=\s*"([^"]+)"/);
        const pathMatch = block.match(/path\s*=\s*"([^"]+)"/);
        if (nameMatch) {
          parsed.candidateEntryPoints.push({
            kind: 'bin',
            value: nameMatch[1],
            source: pathMatch ? pathMatch[1] : 'Cargo.toml',
          });
        }
      }
    }

    // Check for src/main.rs
    if (tree.includes('src/main.rs')) {
      parsed.candidateEntryPoints.push({ kind: 'main', value: 'src/main.rs', source: 'convention' });
    }

    // Check for src/bin/*.rs
    for (const f of tree) {
      if (f.startsWith('src/bin/') && f.endsWith('.rs')) {
        const binName = path.basename(f, '.rs');
        parsed.candidateEntryPoints.push({ kind: 'bin', value: binName, source: f });
      }
    }

    // App type heuristic
    if (parsed.declaredDeps.some(d => RUST_WEB_FRAMEWORKS.includes(d))) {
      parsed.appTypeHint = 'web';
    } else if (parsed.candidateEntryPoints.length > 0) {
      parsed.appTypeHint = 'cli';
    }

    return parsed;
  }

  private _parseCargoToml(content: string, parsed: ParsedDeps): void {
    // Extract [dependencies] section
    this._extractDepsSection(content, /\[dependencies\]\s*\n/, parsed);
    // Extract [dev-dependencies] section
    this._extractDepsSection(content, /\[dev-dependencies\]\s*\n/, parsed);
    // Extract [build-dependencies] section
    this._extractDepsSection(content, /\[build-dependencies\]\s*\n/, parsed);
  }

  private _extractDepsSection(content: string, sectionRe: RegExp, parsed: ParsedDeps): void {
    const match = sectionRe.exec(content);
    if (!match) return;

    const startIdx = match.index + match[0].length;
    const remaining = content.slice(startIdx);

    // Read until next section header or end of file
    const lines = remaining.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[')) break; // new section
      if (!trimmed || trimmed.startsWith('#')) continue;

      // Match: dep_name = "version" or dep_name = { version = "..." }
      const depMatch = trimmed.match(/^([\w-]+)\s*=/);
      if (depMatch) {
        parsed.declaredDeps.push(depMatch[1]);
      }
    }
  }

  bootstrapSandbox(workdir: string): SandboxInfo {
    const cargoHome = path.join(workdir, '.shirim-cargo-home');
    const targetDir = path.join(workdir, '.shirim-target');

    fs.mkdirSync(cargoHome, { recursive: true });
    fs.mkdirSync(targetDir, { recursive: true });

    return {
      env: {
        CARGO_HOME: cargoHome,
        CARGO_TARGET_DIR: targetDir,
      },
      pathPrepend: [path.join(cargoHome, 'bin')],
      notes: [],
    };
  }

  installCmd(_parsed: ParsedDeps): string {
    return 'cargo fetch';
  }

  smokeRunCandidates(parsed: ParsedDeps): string[] {
    const candidates: string[] = ['cargo check'];

    for (const ep of parsed.candidateEntryPoints) {
      if (ep.kind === 'bin') {
        candidates.push(`cargo run --bin ${ep.value} -- --help`);
      } else if (ep.kind === 'main') {
        candidates.push('cargo run -- --help');
      }
    }

    return candidates;
  }
}
