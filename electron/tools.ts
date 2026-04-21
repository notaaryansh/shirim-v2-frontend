/**
 * Tool implementations exposed to the LLM.
 *
 * Every file-touching tool routes through safePath(); bash inherits its cwd
 * from workdir so the LLM can't wander outside.  Outputs are trimmed to keep
 * the LLM's context manageable.
 *
 * Port of shirim-v2-backend/app/agent/tools.py
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { SKIP_DIRS, safePath } from './sandbox.js';

// Per-tool output caps — keeps the LLM context from blowing up.
export const BASH_OUTPUT_CAP = 4000;
export const FILE_READ_CAP = 8000;
export const LIST_FILES_CAP = 150;

export interface ToolContext {
  workdir: string;
  sandboxEnv: Record<string, string>;
  pathPrepend: string[];
  secrets: Record<string, string>;
  defaultTimeout: number;
  maxTimeout: number;  // raised from 120 for rust first-build
}

export function createToolContext(
  workdir: string,
  sandboxEnv: Record<string, string> = {},
  pathPrepend: string[] = [],
  secrets: Record<string, string> = {},
): ToolContext {
  return { workdir, sandboxEnv, pathPrepend, secrets, defaultTimeout: 60, maxTimeout: 300 };
}

// -------------------- helpers --------------------

function trim(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const head = s.slice(0, cap - 200);
  const tail = s.slice(-150);
  return `${head}\n...[trimmed ${s.length - cap + 350} chars]...\n${tail}`;
}

/**
 * Simple Levenshtein distance for fuzzy matching in editFile.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use two rows to save memory.
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function getCloseMatches(needle: string, candidates: string[], n = 3, cutoff = 0.4): string[] {
  const scored: Array<{ line: string; ratio: number }> = [];
  for (const line of candidates) {
    const maxLen = Math.max(needle.length, line.length);
    if (maxLen === 0) continue;
    const ratio = 1 - levenshtein(needle, line) / maxLen;
    if (ratio >= cutoff) scored.push({ line, ratio });
  }
  scored.sort((a, b) => b.ratio - a.ratio);
  return scored.slice(0, n).map(s => s.line);
}

// -------------------- tool implementations --------------------

export function bash(
  ctx: ToolContext,
  command: string,
  timeout?: number,
  phase?: string,
): Promise<Record<string, unknown>> {
  const effectiveTimeout = Math.min(timeout ?? ctx.defaultTimeout, ctx.maxTimeout);

  return new Promise((resolve) => {
    const env: Record<string, string> = { ...process.env as Record<string, string>, ...ctx.sandboxEnv };
    if (ctx.pathPrepend.length > 0) {
      env['PATH'] = [...ctx.pathPrepend, env['PATH'] ?? ''].join(path.delimiter);
    }
    Object.assign(env, ctx.secrets);
    // Suppress dev-server browser auto-open during smoke tests.
    if (!env['BROWSER']) env['BROWSER'] = 'none';

    let stdout = '';
    let stderr = '';
    let finished = false;

    const proc = spawn(command, {
      shell: true,
      cwd: ctx.workdir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      // Kill the entire process group.
      try { process.kill(-proc.pid!, 'SIGTERM'); } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-proc.pid!, 'SIGKILL'); } catch { /* already dead */ }
      }, 3000);
      resolve({
        exit_code: -1,
        stdout: trim(stdout, BASH_OUTPUT_CAP),
        stderr: `<timeout after ${effectiveTimeout}s>`,
        phase,
        note: `Command ran for ${effectiveTimeout}s without crashing, then was killed. ` +
          'If this is a server/daemon, that means it STARTED SUCCESSFULLY — ' +
          'do NOT retry. Call report_success with this as the run_command.',
      });
    }, effectiveTimeout * 1000);

    proc.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exit_code: code ?? -1,
        stdout: trim(stdout, BASH_OUTPUT_CAP),
        stderr: trim(stderr, BASH_OUTPUT_CAP),
        phase,
      });
    });

    proc.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exit_code: -1,
        stdout: '',
        stderr: `<bash error: ${err.message}>`,
        phase,
      });
    });
  });
}

export function readFile(ctx: ToolContext, filePath: string): Record<string, unknown> {
  const full = safePath(ctx.workdir, filePath);
  if (full === null) return { ok: false, error: `path escapes workdir: ${filePath}` };
  if (!fs.existsSync(full)) return { ok: false, error: `file not found: ${filePath}` };
  try {
    const stat = fs.statSync(full);
    if (!stat.isFile()) return { ok: false, error: `not a file: ${filePath}` };
  } catch {
    return { ok: false, error: `stat error: ${filePath}` };
  }
  try {
    const data = fs.readFileSync(full, 'utf-8');
    return { ok: true, path: filePath, size: data.length, content: trim(data, FILE_READ_CAP) };
  } catch (e: unknown) {
    return { ok: false, error: `read error: ${(e as Error).message}` };
  }
}

export function listFiles(ctx: ToolContext, dirPath = '.'): Record<string, unknown> {
  const full = safePath(ctx.workdir, dirPath);
  if (full === null) return { ok: false, error: `path escapes workdir: ${dirPath}` };
  if (!fs.existsSync(full)) return { ok: false, error: `not found: ${dirPath}` };
  try {
    const stat = fs.statSync(full);
    if (!stat.isDirectory()) return { ok: false, error: `not a directory: ${dirPath}` };
  } catch {
    return { ok: false, error: `stat error: ${dirPath}` };
  }
  const entries: string[] = [];
  const children = fs.readdirSync(full).sort();
  for (const name of children) {
    if (SKIP_DIRS.has(name)) continue;
    const childPath = path.join(full, name);
    let isDir = false;
    try { isDir = fs.statSync(childPath).isDirectory(); } catch { continue; }
    entries.push(`${isDir ? 'd' : 'f'} ${name}`);
    if (entries.length >= LIST_FILES_CAP) {
      entries.push(`... [truncated at ${LIST_FILES_CAP}]`);
      break;
    }
  }
  return { ok: true, path: dirPath, entries };
}

export function editFile(
  ctx: ToolContext,
  filePath: string,
  oldString: string,
  newString: string,
): Record<string, unknown> {
  const full = safePath(ctx.workdir, filePath);
  if (full === null) return { ok: false, error: `path escapes workdir: ${filePath}` };
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return { ok: false, error: `file not found: ${filePath}` };
  }
  let text: string;
  try {
    text = fs.readFileSync(full, 'utf-8');
  } catch (e: unknown) {
    return { ok: false, error: `read error: ${(e as Error).message}` };
  }

  // Count occurrences.
  let count = 0;
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(oldString, searchFrom);
    if (idx === -1) break;
    count++;
    searchFrom = idx + 1;
  }

  if (count === 0) {
    const needle = oldString.split('\n')[0] ?? '';
    const lines = text.split('\n');
    const matches = getCloseMatches(needle, lines, 3, 0.4);
    const hinted = matches.map(m => {
      const idx = lines.indexOf(m);
      return `L${idx + 1}: ${m}`;
    });
    return {
      ok: false,
      error: `old_string not found in ${filePath}`,
      closest_matches: hinted,
      hint: 're-read the file with read_file and copy an exact substring',
    };
  }

  if (count > 1) {
    const lineNumbers: number[] = [];
    let offset = 0;
    while (true) {
      const idx = text.indexOf(oldString, offset);
      if (idx === -1) break;
      lineNumbers.push(text.slice(0, idx).split('\n').length);
      offset = idx + 1;
    }
    return {
      ok: false,
      error: `old_string matched ${count} times in ${filePath} — add surrounding context to make it unique`,
      match_lines: lineNumbers,
    };
  }

  const newText = text.replace(oldString, newString);
  try {
    fs.writeFileSync(full, newText, 'utf-8');
  } catch (e: unknown) {
    return { ok: false, error: `write error: ${(e as Error).message}` };
  }

  const line = text.slice(0, text.indexOf(oldString)).split('\n').length;
  const newLines = newText.split('\n');
  const start = Math.max(0, line - 2);
  const end = Math.min(newLines.length, line + 3);
  const preview: string[] = [];
  for (let i = start; i < end; i++) {
    preview.push(`L${i + 1}: ${newLines[i]}`);
  }
  return { ok: true, path: filePath, line, preview };
}

export function createFile(ctx: ToolContext, filePath: string, content: string): Record<string, unknown> {
  const full = safePath(ctx.workdir, filePath);
  if (full === null) return { ok: false, error: `path escapes workdir: ${filePath}` };
  if (fs.existsSync(full)) {
    return { ok: false, error: `file already exists: ${filePath}`, hint: 'use edit_file to modify existing files' };
  }
  try {
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  } catch (e: unknown) {
    return { ok: false, error: `write error: ${(e as Error).message}` };
  }
  return { ok: true, path: filePath, size: content.length };
}

// -------------------- JSON schemas for OpenAI tool calling --------------------

export const TOOL_SCHEMAS: Record<string, unknown>[] = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command in the working directory. Output is trimmed to 4KB. Use this for install commands, smoke runs, and any shell inspection. Prepend `timeout N` for potentially long commands unless you\'ve passed an explicit `timeout` argument.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          phase: {
            type: 'string',
            enum: ['install', 'run', 'fix'],
            description: 'Tag this command with the current loop phase. Used for log stream + stuck detection.',
          },
          timeout: {
            type: 'integer',
            description: 'Override the default 60s timeout. Max 300s (use the full 300 only for Rust first-builds).',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the working directory. Trimmed to 8KB.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List the contents of a directory inside the working directory.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: "Relative path. Defaults to '.'." } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Make a targeted, diff-only edit: replace a unique substring in a file. ' +
        '`old_string` must match EXACTLY ONCE. If it matches zero times the tool ' +
        'returns closest_matches so you can retry with a corrected substring. ' +
        'If it matches multiple times the tool returns match_lines so you can ' +
        'add surrounding context and retry. Do NOT use this to rewrite whole ' +
        'files — for new files use create_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact substring to find. Must be unique.' },
          new_string: { type: 'string', description: 'Replacement text.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_file',
      description:
        'Create a new file with the given content. Fails if the file already ' +
        'exists — use edit_file for existing files. Use this for .env placeholder, ' +
        'missing __init__.py, or other small config files the repo needs.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_success',
      description:
        'Terminal tool: call this once you\'ve confirmed the repo installs and ' +
        'runs. The loop ends immediately after this call and install.json is written.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: '2-3 sentence plain-English description of what the app does.' },
          run_command: { type: 'string', description: 'The exact shell command that starts the app.' },
          entry_point: { type: 'string', description: 'The entry point (file, module, or binary name).' },
          app_type: { type: 'string', enum: ['cli', 'web', 'gui', 'library'] },
          env_vars_used: {
            type: 'array',
            items: { type: 'string' },
            description: "List of env var names the app needs at runtime (e.g. ['OPENAI_API_KEY']).",
          },
        },
        required: ['summary', 'run_command', 'entry_point', 'app_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'report_failure',
      description: 'Terminal tool: call this if you cannot make the repo run. Loop ends and failure.json is written.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          last_error: { type: 'string', description: 'The most recent stderr / exception message you saw.' },
          phase_where_failed: { type: 'string', enum: ['install', 'run', 'fix'] },
        },
        required: ['reason', 'phase_where_failed'],
      },
    },
  },
];

/** Map of tool name → implementation function. */
export const TOOL_IMPLS: Record<string, (ctx: ToolContext, ...args: unknown[]) => unknown> = {
  bash: (ctx, command, timeout, phase) =>
    bash(ctx, command as string, timeout as number | undefined, phase as string | undefined),
  read_file: (ctx, filePath) => readFile(ctx, filePath as string),
  list_files: (ctx, dirPath) => listFiles(ctx, dirPath as string | undefined),
  edit_file: (ctx, filePath, oldStr, newStr) =>
    editFile(ctx, filePath as string, oldStr as string, newStr as string),
  create_file: (ctx, filePath, content) =>
    createFile(ctx, filePath as string, content as string),
};
