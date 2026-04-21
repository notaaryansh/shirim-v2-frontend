/**
 * Clone + path-safety helpers for agent workdirs.
 * Port of shirim-v2-backend/app/agent/sandbox.py
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const INSTALLS_DIR = path.join(os.homedir(), '.shirim', 'installs');
fs.mkdirSync(INSTALLS_DIR, { recursive: true });

/** Dirs the repo-walker + tools should never descend into. */
export const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn',
  '.shirim-venv', '.venv', 'venv', 'env',
  'node_modules', '__pycache__', '.pytest_cache', '.mypy_cache', '.tox',
  'dist', 'build', 'target',
  '.idea', '.vscode',
  '.shirim-gopath', '.shirim-gocache', '.shirim-cargo-home',
  '.shirim-target', '.shirim-npm-prefix',
]);

/**
 * Resolve `rel` inside `workdir` and reject any path traversal.
 * Returns the absolute path or null if it escapes workdir.
 */
export function safePath(workdir: string, rel: string): string | null {
  try {
    const full = path.resolve(workdir, rel);
    const workdirAbs = path.resolve(workdir);
    if (full === workdirAbs) return full;
    if (!full.startsWith(workdirAbs + path.sep)) return null;
    return full;
  } catch {
    return null;
  }
}

/**
 * Return a sorted list of relative file paths, skipping SKIP_DIRS and
 * nested hidden directories.
 */
export function walkRepoTree(workdir: string, maxFiles = 600): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      const rel = path.relative(workdir, path.join(dir, entry.name));
      const parts = rel.split(path.sep);
      if (parts.some(p => SKIP_DIRS.has(p))) continue;
      // Allow dot-prefixed root files but skip nested hidden dirs.
      const hasHidden = parts.some((p, i) =>
        i > 0 && p.startsWith('.') &&
        p !== '.env' && p !== '.env.example' && p !== '.env.sample'
      );
      if (hasHidden) continue;

      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        results.push(parts.join('/'));
      }
    }
  }

  walk(workdir);
  return results;
}

export const CLONE_TIMEOUT_SECONDS = 90;

/**
 * Shallow-clone github.com/{owner}/{repo} into workdir.
 * Supports cancellation via AbortSignal.
 */
export function cloneRepo(
  owner: string,
  repo: string,
  workdir: string,
  ref?: string,
  signal?: AbortSignal,
  timeout: number = CLONE_TIMEOUT_SECONDS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up any existing partial clone.
    if (fs.existsSync(workdir)) {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(workdir), { recursive: true });

    const url = `https://github.com/${owner}/${repo}.git`;
    const args = [
      '-c', 'http.postBuffer=524288000',
      'clone',
      '--depth=1',
      '--no-tags',
      '--single-branch',
    ];
    if (ref) args.push('--branch', ref);
    args.push(url, workdir);

    const env = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0' };

    const proc = spawn('git', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stderr = '';
    let finished = false;

    const cleanup = () => {
      if (fs.existsSync(workdir)) {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    };

    const kill = () => {
      try { process.kill(-proc.pid!, 'SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-proc.pid!, 'SIGKILL'); } catch { /* already dead */ }
      }, 3000);
    };

    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    // Timeout handler.
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      kill();
      cleanup();
      reject(new Error(`git clone timed out after ${timeout}s for ${owner}/${repo}`));
    }, timeout * 1000);

    // Cancellation handler.
    if (signal) {
      const onAbort = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        kill();
        cleanup();
        reject(new Error('clone cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`git clone failed for ${owner}/${repo}: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
  });
}

/** Delete the workdir for an install. Returns true if anything was removed. */
export function cleanupInstall(installId: string): boolean {
  const workdir = path.join(INSTALLS_DIR, installId);
  if (!fs.existsSync(workdir)) return false;
  fs.rmSync(workdir, { recursive: true, force: true });
  return true;
}
