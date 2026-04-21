/**
 * Process spawning + URL detection module.
 * Port of shirim-v2-backend/app/agent/launcher.py
 */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import crypto from 'crypto';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const LOG_TAIL_SIZE = 400;
const URL_DETECT_TIMEOUT = 30.0;

/* ------------------------------------------------------------------ */
/*  URL / port detection regexes                                       */
/* ------------------------------------------------------------------ */

const _URL_RE =
  /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d{2,5})?(?:\/\S*)?)/;

const _PORT_NEAR_KEYWORD_RE =
  /(?:listen(?:ing)?|serv(?:e|ing|er)|running|starting|ready|bound|address|http|accepting).{0,60}?(?<![0-9.])(\d{4,5})(?![0-9])/i;

const _BARE_PORT_RE =
  /(?:^|[\s=:])port[\s=:]+(\d{4,5})\b/i;

/* ------------------------------------------------------------------ */
/*  Command normalisation regexes                                      */
/* ------------------------------------------------------------------ */

const _TIMEOUT_PREFIX_RE = /^\s*timeout\s+\d+\s+/;
const _OR_TRUE_SUFFIX_RE = /\s*\|\|\s*true\s*$/;
const _HELP_FLAG_RE = /\s+(?:--help|-h|-V|--version|-v)\s*$/;

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type RunStatus = 'starting' | 'running' | 'exited' | 'crashed' | 'stopped';

export interface RunResponse {
  run_id: string;
  install_id: string;
  command: string;
  pid: number | null;
  url: string | null;
  port: number | null;
  status: RunStatus;
  started_at: number;
  finished_at: number | null;
  exit_code: number | null;
}

export interface RunHandle {
  runId: string;
  installId: string;
  command: string;
  cwd: string;
  pid: number | null;
  status: RunStatus;
  url: string | null;
  port: number | null;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  logTail: string[];
  process: ChildProcess | null;
  stopFlag: boolean;
}

/* ------------------------------------------------------------------ */
/*  In-memory registries                                               */
/* ------------------------------------------------------------------ */

const _runs: Map<string, RunHandle> = new Map();
const _activeByInstall: Map<string, string> = new Map();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function normaliseCommand(cmd: string): string {
  let c = cmd.trim();
  c = c.replace(_TIMEOUT_PREFIX_RE, '');
  c = c.replace(_OR_TRUE_SUFFIX_RE, '');
  c = c.replace(_HELP_FLAG_RE, '');
  return c.trim();
}

export function extractUrlPort(line: string): [string | null, number | null] {
  // Pattern 1: full URL
  const urlMatch = _URL_RE.exec(line);
  if (urlMatch) {
    try {
      const parsed = new URL(urlMatch[1]);
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
      const normalised = `http://localhost:${port}/`;
      return [normalised, port];
    } catch {
      // fall through
    }
  }

  // Pattern 2: port near keyword
  const keywordMatch = _PORT_NEAR_KEYWORD_RE.exec(line);
  if (keywordMatch) {
    const port = parseInt(keywordMatch[1], 10);
    if (port >= 1024 && port <= 65535) {
      return [`http://localhost:${port}/`, port];
    }
  }

  // Pattern 3: bare port
  const bareMatch = _BARE_PORT_RE.exec(line);
  if (bareMatch) {
    const port = parseInt(bareMatch[1], 10);
    if (port >= 1024 && port <= 65535) {
      return [`http://localhost:${port}/`, port];
    }
  }

  return [null, null];
}

export function toResponse(h: RunHandle): RunResponse {
  return {
    run_id: h.runId,
    install_id: h.installId,
    command: h.command,
    pid: h.pid,
    url: h.url,
    port: h.port,
    status: h.status,
    started_at: h.startedAt,
    finished_at: h.finishedAt,
    exit_code: h.exitCode,
  };
}

function pushLogLine(handle: RunHandle, line: string): void {
  handle.logTail.push(line);
  if (handle.logTail.length > LOG_TAIL_SIZE) {
    handle.logTail.shift();
  }
}

/* ------------------------------------------------------------------ */
/*  Core API                                                           */
/* ------------------------------------------------------------------ */

export function getRun(runId: string): RunHandle | undefined {
  return _runs.get(runId);
}

export function getRunForInstall(installId: string): RunHandle | undefined {
  const runId = _activeByInstall.get(installId);
  if (runId == null) return undefined;
  return _runs.get(runId);
}

export async function stopRunsForInstall(installId: string, grace = 5): Promise<void> {
  const runId = _activeByInstall.get(installId);
  if (runId != null) {
    await stopRun(runId, grace);
  }
}

export async function startRun(
  installId: string,
  command: string,
  cwd: string,
  sandboxEnv: Record<string, string> = {},
  pathPrepend: string[] = [],
  secrets: Record<string, string> = {},
  waitForUrl: number = URL_DETECT_TIMEOUT,
): Promise<RunHandle> {
  // Dedup: if an existing run is starting or running, return it
  const existingId = _activeByInstall.get(installId);
  if (existingId != null) {
    const existing = _runs.get(existingId);
    if (existing && (existing.status === 'starting' || existing.status === 'running')) {
      return existing;
    }
  }

  const normCmd = normaliseCommand(command);

  // Build env
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  Object.assign(env, sandboxEnv);
  Object.assign(env, secrets);
  env['PYTHONUNBUFFERED'] = '1';
  env['BROWSER'] = 'none';

  if (pathPrepend.length > 0) {
    const separator = process.platform === 'win32' ? ';' : ':';
    const existing = env['PATH'] ?? '';
    env['PATH'] = pathPrepend.join(separator) + separator + existing;
  }

  const runId = crypto.randomUUID();
  const handle: RunHandle = {
    runId,
    installId,
    command: normCmd,
    cwd,
    pid: null,
    status: 'starting',
    url: null,
    port: null,
    startedAt: Date.now() / 1000,
    finishedAt: null,
    exitCode: null,
    logTail: [],
    process: null,
    stopFlag: false,
  };

  _runs.set(runId, handle);
  _activeByInstall.set(installId, runId);

  // Spawn
  const proc = spawn(normCmd, {
    shell: true,
    detached: true,
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  handle.process = proc;
  handle.pid = proc.pid ?? null;

  // Line-buffered reader for a readable stream
  function attachLineReader(stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;
    let buffer = '';
    stream.setEncoding('utf-8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        pushLogLine(handle, line);
        if (handle.url == null) {
          const [url, port] = extractUrlPort(line);
          if (url != null) {
            handle.url = url;
            handle.port = port;
            if (handle.status === 'starting') {
              handle.status = 'running';
            }
          }
        }
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) {
        pushLogLine(handle, buffer);
        if (handle.url == null) {
          const [url, port] = extractUrlPort(buffer);
          if (url != null) {
            handle.url = url;
            handle.port = port;
          }
        }
        buffer = '';
      }
    });
  }

  attachLineReader(proc.stdout);
  attachLineReader(proc.stderr);

  // Process exit
  proc.on('close', (code: number | null, signal: string | null) => {
    handle.finishedAt = Date.now() / 1000;
    handle.exitCode = code;

    if (handle.stopFlag) {
      handle.status = 'stopped';
    } else if (code === 0) {
      handle.status = 'exited';
    } else {
      handle.status = 'crashed';
    }
  });

  proc.on('error', (err: Error) => {
    pushLogLine(handle, `spawn error: ${err.message}`);
    handle.status = 'crashed';
    handle.finishedAt = Date.now() / 1000;
  });

  // Wait for URL detection, process exit, or timeout
  if (waitForUrl > 0) {
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + waitForUrl * 1000;
      const interval = setInterval(() => {
        if (handle.url != null || handle.status === 'exited' || handle.status === 'crashed' || handle.status === 'stopped' || Date.now() >= deadline) {
          clearInterval(interval);
          // If we timed out but process is still alive, mark as running anyway
          if (handle.status === 'starting' && handle.process && handle.exitCode == null) {
            handle.status = 'running';
          }
          resolve();
        }
      }, 100);
    });
  }

  return handle;
}

export async function stopRun(runId: string, grace = 5): Promise<RunHandle | undefined> {
  const handle = _runs.get(runId);
  if (!handle) return undefined;

  handle.stopFlag = true;
  const proc = handle.process;

  if (!proc || proc.exitCode != null || handle.status === 'exited' || handle.status === 'crashed' || handle.status === 'stopped') {
    if (handle.status === 'starting' || handle.status === 'running') {
      handle.status = 'stopped';
      handle.finishedAt = Date.now() / 1000;
    }
    return handle;
  }

  // SIGTERM the process group
  try {
    if (proc.pid != null) {
      process.kill(-proc.pid, 'SIGTERM');
    }
  } catch {
    // process may already be dead
  }

  // Wait for graceful exit
  const exited = await new Promise<boolean>((resolve) => {
    const deadline = Date.now() + grace * 1000;
    const interval = setInterval(() => {
      if (proc.exitCode != null || Date.now() >= deadline) {
        clearInterval(interval);
        resolve(proc.exitCode != null);
      }
    }, 100);
  });

  // SIGKILL if still alive
  if (!exited) {
    try {
      if (proc.pid != null) {
        process.kill(-proc.pid, 'SIGKILL');
      }
    } catch {
      // process may already be dead
    }
  }

  // Give a moment for the close event to fire
  if ((handle.status as string) !== 'stopped' && (handle.status as string) !== 'exited' && (handle.status as string) !== 'crashed') {
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    if (handle.status === 'starting' || handle.status === 'running') {
      handle.status = 'stopped';
      handle.finishedAt = Date.now() / 1000;
    }
  }

  return handle;
}

/**
 * Kill ALL active runs. Called on app quit to ensure no orphaned processes
 * keep ports occupied after the Electron app closes.
 */
export function stopAllRuns(): void {
  for (const [_runId, handle] of _runs) {
    if (handle.status === 'starting' || handle.status === 'running') {
      handle.stopFlag = true;
      const proc = handle.process;
      if (proc && proc.pid != null && proc.exitCode == null) {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already dead */ }
      }
      handle.status = 'stopped';
      handle.finishedAt = Date.now() / 1000;
    }
  }
}
