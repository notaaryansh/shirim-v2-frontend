/**
 * AgentRun — the install/run/fix LLM loop.
 *
 * Port of shirim-v2-backend/app/agent/runner.py
 *
 * The loop calls the backend's LLM proxy endpoint for each turn and executes
 * tools locally in the Electron main process.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { allAdapters, getAdapter } from './adapters/index.js';
import type { LanguageAdapter, ParsedDeps, Language } from './adapters/base.js';
import { analyze, type AnalysisResult } from './analyzer.js';
import { getMainWindow } from './main.js';
import { computeProgress } from './progress.js';
import {
  BASE_SYSTEM_PROMPT,
  LANGUAGE_APPENDICES,
  FALLBACK_SYSTEM_PROMPT,
  buildInitialUserMessage,
  buildFallbackUserMessage,
} from './prompts.js';
import { INSTALLS_DIR, cloneRepo, cleanupInstall } from './sandbox.js';
import {
  TOOL_SCHEMAS,
  bash,
  readFile,
  listFiles,
  editFile,
  createFile,
  createToolContext,
  type ToolContext,
} from './tools.js';
import * as vault from './vault.js';

const MAX_ITERATIONS = 40;
const WALL_CLOCK_SECONDS = 8 * 60;
const API_BASE = 'http://localhost:8001';

// ---------------------------------------------------------------------------
// AgentRun type
// ---------------------------------------------------------------------------

export interface LogEntry {
  ts: number;
  type: string;
  phase?: string;
  [key: string]: unknown;
}

export interface AgentRun {
  installId: string;
  owner: string;
  repo: string;
  ref?: string;
  workdir: string;
  status: string; // pending|cloning|analyzing|sandboxing|running|success|failure|timeout|cancelled|error
  phase: string | null;
  analysis: AnalysisResult | null;
  result: Record<string, unknown> | null;
  logs: LogEntry[];
  startedAt: number;
  finishedAt: number;
  abortController: AbortController;
  authToken: string;
}

// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------

const _installs = new Map<string, AgentRun>();

export function getInstall(installId: string): AgentRun | undefined {
  return _installs.get(installId);
}

export function getAllInstalls(): AgentRun[] {
  return Array.from(_installs.values());
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logEvent(run: AgentRun, type: string, payload: Record<string, unknown> = {}): void {
  const entry: LogEntry = { ts: Date.now() / 1000, type };
  if (run.phase) entry.phase = run.phase;
  Object.assign(entry, payload);
  run.logs.push(entry);

  // Push progress to renderer.
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    const progress = computeProgress(run);
    win.webContents.send(`install:progress:${run.installId}`, progress);
  }
}

// ---------------------------------------------------------------------------
// LLM proxy call
// ---------------------------------------------------------------------------

async function callLlm(
  messages: Record<string, unknown>[],
  toolSchemas: Record<string, unknown>[],
  authToken: string,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/api/v1/agent/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ messages, tool_schemas: toolSchemas }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM proxy error ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'bash':
      return bash(ctx, args.command as string, args.timeout as number | undefined, args.phase as string | undefined);
    case 'read_file':
      return readFile(ctx, (args.path as string) || '');
    case 'list_files':
      return listFiles(ctx, (args.path as string) || '.');
    case 'edit_file':
      return editFile(ctx, (args.path as string) || '', (args.old_string as string) || '', (args.new_string as string) || '');
    case 'create_file':
      return createFile(ctx, (args.path as string) || '', (args.content as string) || '');
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}

// ---------------------------------------------------------------------------
// Assistant message serialization
// ---------------------------------------------------------------------------

function assistantMessageDict(msg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { role: 'assistant', content: msg.content };
  const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
  if (toolCalls) {
    out.tool_calls = toolCalls.map((call) => {
      const fn = call.function as Record<string, unknown>;
      return {
        id: call.id,
        type: 'function',
        function: { name: fn.name, arguments: fn.arguments },
      };
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stuck detection helpers
// ---------------------------------------------------------------------------

function sha1Short(s: string): string {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

function safeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 300) {
      out[k] = v.slice(0, 280) + `...[+${v.length - 280}]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function trimForLog(result: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'string' && v.length > 600) {
      out[k] = v.slice(0, 580) + `...[+${v.length - 580}]`;
    } else if (Array.isArray(v) && v.length > 20) {
      out[k] = [...v.slice(0, 20), `...[+${v.length - 20}]`];
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// LLM loop
// ---------------------------------------------------------------------------

async function llmLoop(
  run: AgentRun,
  ctx: ToolContext,
  adapter: LanguageAdapter | null,
  parsed: ParsedDeps | null,
  language: string,
): Promise<void> {
  let systemPrompt: string;
  let userMsg: string;

  if (adapter !== null && parsed !== null && run.analysis) {
    systemPrompt = BASE_SYSTEM_PROMPT + '\n\n' + (LANGUAGE_APPENDICES[language as keyof typeof LANGUAGE_APPENDICES] ?? '');
    userMsg = buildInitialUserMessage(
      run.owner, run.repo, run.workdir, language,
      parsed, run.analysis,
      [],
      Object.keys(ctx.secrets),
      adapter.installCmd(parsed),
      adapter.smokeRunCandidates(parsed),
    );
  } else {
    systemPrompt = FALLBACK_SYSTEM_PROMPT;
    userMsg = buildFallbackUserMessage(
      run.owner, run.repo, run.workdir,
      run.analysis!,
      Object.keys(ctx.secrets),
    );
  }

  const messages: Record<string, unknown>[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMsg },
  ];

  const recentCmdHashes: string[] = [];
  const recentStderrHashes: string[] = [];
  const REPEAT_CMD_LIMIT = 4;
  const REPEAT_STDERR_LIMIT = 3;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    if (run.abortController.signal.aborted) {
      run.status = 'cancelled';
      logEvent(run, 'cancelled', { reason: 'cancel requested by user' });
      return;
    }
    if (Date.now() / 1000 - run.startedAt > WALL_CLOCK_SECONDS) {
      run.status = 'timeout';
      logEvent(run, 'timeout', { reason: `wall clock > ${WALL_CLOCK_SECONDS}s` });
      return;
    }

    logEvent(run, 'iter', { n: iteration });

    let resp: Record<string, unknown>;
    try {
      resp = await callLlm(messages, TOOL_SCHEMAS, run.authToken);
    } catch (e: unknown) {
      run.status = 'error';
      logEvent(run, 'error', { msg: `LLM call failed: ${(e as Error).message}` });
      return;
    }

    const choices = resp.choices as Array<Record<string, unknown>>;
    const msg = choices[0].message as Record<string, unknown>;
    messages.push(assistantMessageDict(msg));

    if (msg.content) {
      logEvent(run, 'thought', { text: (msg.content as string).slice(0, 800) });
    }

    const toolCalls = msg.tool_calls as Array<Record<string, unknown>> | undefined;
    if (!toolCalls || toolCalls.length === 0) {
      logEvent(run, 'warning', { msg: 'agent stopped without calling a tool' });
      run.status = 'failure';
      logEvent(run, 'failure', { reason: 'agent produced no tool calls' });
      return;
    }

    for (const call of toolCalls) {
      const fn = call.function as Record<string, unknown>;
      const name = fn.name as string;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse((fn.arguments as string) || '{}');
      } catch {
        args = {};
      }

      logEvent(run, 'tool_call', { name, args: safeArgs(args) });

      // Terminal tools
      if (name === 'report_success') {
        run.status = 'success';
        run.result = args;
        logEvent(run, 'success', args);
        return;
      }
      if (name === 'report_failure') {
        run.status = 'failure';
        run.result = args;
        logEvent(run, 'failure', args);
        return;
      }

      // Phase tracking
      if (name === 'bash' && args.phase) {
        run.phase = args.phase as string;
      }

      let toolResult: Record<string, unknown>;
      try {
        toolResult = await executeTool(ctx, name, args);
      } catch (e: unknown) {
        toolResult = { ok: false, error: `${(e as Error).constructor.name}: ${(e as Error).message}` };
      }

      logEvent(run, 'tool_result', { name, result: trimForLog(toolResult) });

      // Stuck detection
      if (name === 'bash') {
        const cmd = (args.command as string) || '';
        recentCmdHashes.push(sha1Short(cmd));

        const stderr = ((toolResult.stderr as string) || '').trim();
        if (stderr) {
          recentStderrHashes.push(sha1Short(stderr));
        } else {
          recentStderrHashes.length = 0;
        }

        if (
          recentCmdHashes.length >= REPEAT_CMD_LIMIT &&
          new Set(recentCmdHashes.slice(-REPEAT_CMD_LIMIT)).size === 1
        ) {
          run.status = 'failure';
          logEvent(run, 'failure', {
            reason: `stuck: same command repeated ${REPEAT_CMD_LIMIT} times`,
            phase_where_failed: run.phase,
            command: cmd.slice(0, 200),
          });
          return;
        }

        if (
          recentStderrHashes.length >= REPEAT_STDERR_LIMIT &&
          new Set(recentStderrHashes.slice(-REPEAT_STDERR_LIMIT)).size === 1
        ) {
          run.status = 'failure';
          logEvent(run, 'failure', {
            reason: `stuck: same stderr repeated ${REPEAT_STDERR_LIMIT} times in ${run.phase} phase`,
            phase_where_failed: run.phase,
          });
          return;
        }
      } else {
        recentCmdHashes.length = 0;
        recentStderrHashes.length = 0;
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        name,
        content: JSON.stringify(toolResult),
      });

      if (run.abortController.signal.aborted) {
        run.status = 'cancelled';
        logEvent(run, 'cancelled', { reason: 'cancel requested by user' });
        return;
      }
    }
  }

  run.status = 'timeout';
  logEvent(run, 'timeout', { reason: `exceeded MAX_ITERATIONS=${MAX_ITERATIONS}` });
}

// ---------------------------------------------------------------------------
// Result file
// ---------------------------------------------------------------------------

function writeResultFile(run: AgentRun): void {
  if (!fs.existsSync(run.workdir)) return;
  const out = {
    install_id: run.installId,
    owner: run.owner,
    repo: run.repo,
    status: run.status,
    phase_at_end: run.phase,
    analysis: run.analysis,
    result: run.result,
    log_count: run.logs.length,
    duration_ms: Math.round((run.finishedAt - run.startedAt) * 1000),
  };
  let name: string;
  if (run.status === 'success') name = 'install.json';
  else if (run.status === 'cancelled') name = 'cancelled.json';
  else name = 'failure.json';
  try {
    fs.writeFileSync(path.join(run.workdir, name), JSON.stringify(out, null, 2));
  } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function runInner(run: AgentRun): Promise<void> {
  // Stage 1 — clone
  run.status = 'cloning';
  logEvent(run, 'status', { msg: `cloning ${run.owner}/${run.repo}` });
  await cloneRepo(run.owner, run.repo, run.workdir, run.ref, run.abortController.signal);

  if (run.abortController.signal.aborted) {
    run.status = 'cancelled';
    logEvent(run, 'cancelled', { reason: 'cancel requested by user' });
    return;
  }

  // Stage 2 — deterministic analysis
  run.status = 'analyzing';
  logEvent(run, 'status', { msg: 'analyzing repo' });
  run.analysis = analyze(run.workdir, allAdapters());
  const language = run.analysis.language;

  if (!language || language === 'unknown') {
    logEvent(run, 'warning', { msg: 'no language adapter matched — falling back to LLM exploration' });
    logEvent(run, 'analysis_complete', {
      language: 'unknown',
      dep_files: run.analysis.dep_files,
      entry_point_count: 0,
    });
    run.status = 'running';
    const ctx = createToolContext(run.workdir, {}, [], vault.load());
    await llmLoop(run, ctx, null, null, 'unknown');
    return;
  }

  logEvent(run, 'analysis_complete', {
    language,
    dep_files: run.analysis.dep_files,
    entry_point_count: run.analysis.candidate_entry_points.length,
  });

  // Stage 3 — sandbox setup
  run.status = 'sandboxing';
  logEvent(run, 'status', { msg: `setting up ${language} sandbox` });
  const adapter = getAdapter(language as Language);
  const parsed = adapter.parseDeps(run.workdir, run.analysis.tree_sample, {});
  let sandboxInfo;
  try {
    sandboxInfo = adapter.bootstrapSandbox(run.workdir);
  } catch (e: unknown) {
    run.status = 'failure';
    logEvent(run, 'failure', { reason: `sandbox setup failed: ${(e as Error).message}` });
    return;
  }
  for (const note of sandboxInfo.notes) {
    logEvent(run, 'sandbox', { note });
  }

  if (run.abortController.signal.aborted) {
    run.status = 'cancelled';
    logEvent(run, 'cancelled', { reason: 'cancel requested by user' });
    return;
  }

  // Stage 4 — LLM loop
  run.status = 'running';
  const ctx = createToolContext(run.workdir, sandboxInfo.env, sandboxInfo.pathPrepend, vault.load());
  await llmLoop(run, ctx, adapter, parsed, language);
}

export async function startInstall(
  installId: string,
  owner: string,
  repo: string,
  authToken: string,
  ref?: string,
): Promise<AgentRun> {
  // Dedup: if an active run exists, return it.
  const existing = _installs.get(installId);
  if (existing && !['success', 'failure', 'timeout', 'cancelled', 'error'].includes(existing.status)) {
    return existing;
  }

  const run: AgentRun = {
    installId,
    owner,
    repo,
    ref,
    workdir: path.join(INSTALLS_DIR, installId),
    status: 'pending',
    phase: null,
    analysis: null,
    result: null,
    logs: [],
    startedAt: Date.now() / 1000,
    finishedAt: 0,
    abortController: new AbortController(),
    authToken,
  };

  _installs.set(installId, run);

  // Fire and forget — don't await.
  (async () => {
    try {
      await runInner(run);
    } catch (e: unknown) {
      if ((e as Error).message === 'clone cancelled') {
        run.status = 'cancelled';
        logEvent(run, 'cancelled', { reason: 'task cancelled' });
      } else {
        run.status = 'error';
        logEvent(run, 'error', { msg: `${(e as Error).constructor.name}: ${(e as Error).message}` });
      }
    } finally {
      run.finishedAt = Date.now() / 1000;
      writeResultFile(run);
      logEvent(run, 'done', { status: run.status });
    }
  })();

  return run;
}

export function cancelInstall(installId: string): { ok: boolean; status?: string; already_terminal?: boolean } {
  const run = _installs.get(installId);
  if (!run) return { ok: false };
  if (['success', 'failure', 'timeout', 'cancelled', 'error'].includes(run.status)) {
    return { ok: true, status: run.status, already_terminal: true };
  }
  run.abortController.abort();
  return { ok: true, status: 'cancelled' };
}

export function deleteInstall(installId: string): void {
  cancelInstall(installId);
  cleanupInstall(installId);
  _installs.delete(installId);
}

export function refreshToken(installId: string, token: string): void {
  const run = _installs.get(installId);
  if (run) run.authToken = token;
}
