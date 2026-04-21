import { authFetch } from './auth';

export const API_BASE = 'http://localhost:8001';

export type SmartSummary = {
  tagline: string;
  description: string;
  features: string[];
  categories: string[];
  install_difficulty: 'easy' | 'medium' | 'hard';
  requirements: string[];
};

export type Repository = {
  id: number;
  name: string;
  repo: string;
  desc: string;
  language: string;
  stars: string;
  summary: SmartSummary | null;
};

export type CategoryBlock = { name: string; repos: Repository[] };
export type TabResponse = { tab: 'home' | 'discover'; categories: CategoryBlock[] };

export type RepoDetail = {
  id: number;
  name: string;
  repo: string;
  desc: string;
  language: string;
  stars: string;
  summary: SmartSummary;
  images: string[];
  github_url: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await authFetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.json() as Promise<T>;
}

export const fetchHome = () => getJson<TabResponse>(`${API_BASE}/api/home`);
export const fetchDiscover = () => getJson<TabResponse>(`${API_BASE}/api/discover`);
export const fetchRepoDetail = (ownerRepo: string) =>
  getJson<RepoDetail>(`${API_BASE}/api/repos/${ownerRepo}`);

/* ---------- Install flow ---------- */

export type StepStatus = 'pending' | 'active' | 'done' | 'failed';
export type OverallStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';
export type StepId = 'prepare' | 'analyze' | 'install' | 'test' | 'finalize';
export type AppType = 'cli' | 'web' | 'gui' | 'library';

export type InstallStep = {
  id: StepId;
  label: string;
  status: StepStatus;
};

export type InstallResult = {
  summary: string;
  run_command: string;
  entry_point: string;
  app_type: AppType;
  env_vars_used?: string[];
};

export type InstallProgress = {
  install_id: string;
  owner: string;
  repo: string;
  overall_status: OverallStatus;
  current_step_id: StepId | null;
  current_step_index: number | null;
  steps: InstallStep[];
  error: {
    reason: string;
    last_error: string | null;
    phase_where_failed: string | null;
  } | null;
  result: InstallResult | null;
  duration_ms: number;
};

export type InstallStartResponse = {
  install_id: string;
};

export type InstallCancelResponse = {
  ok: boolean;
  status?: string;
  already_terminal?: boolean;
};

export const kickInstall = (ownerRepo: string): Promise<InstallStartResponse> => {
  const [owner, repo] = ownerRepo.split('/');
  return window.shirim.install.start(owner, repo);
};

export const fetchInstallProgress = (installId: string): Promise<InstallProgress> =>
  window.shirim.install.getProgress(installId);

/** Cancel — stops the task, KEEPS the workdir on disk for debugging. */
export const cancelInstall = (installId: string): Promise<InstallCancelResponse> =>
  window.shirim.install.cancel(installId);

/** Delete — stops the task AND wipes the workdir. */
export const deleteInstall = (installId: string): Promise<void> =>
  window.shirim.install.delete(installId);

/* ---------- Run (launch installed app) ---------- */

export type RunStatus = 'starting' | 'running' | 'exited' | 'crashed' | 'stopped';

export type RunResponse = {
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
};

export type RunLogsResponse = {
  lines: string[];
};

export type RunStartOptions = {
  command?: string;       // override the stored run_command
  wait_for_url?: number;  // override the 30s default URL-detection window
};

export const startRun = (installId: string, options?: RunStartOptions): Promise<RunResponse> =>
  window.shirim.run.start(installId, options);

export const fetchRunState = (installId: string): Promise<RunResponse> =>
  window.shirim.run.getState(installId);

export const stopRun = (installId: string): Promise<RunResponse> =>
  window.shirim.run.stop(installId);

export const fetchRunLogs = (installId: string, limit = 200): Promise<RunLogsResponse> =>
  window.shirim.run.getLogs(installId, limit);

/* ---------- Secrets (API Keys vault) ---------- */

export type SecretEntry = {
  name: string;
  masked_value: string;
  length: number;
};

export type SecretsListResponse = {
  secrets: SecretEntry[];
};

export type SecretsCheckResponse = {
  status: Record<string, boolean>;
};

export const listSecrets = (): Promise<SecretsListResponse> =>
  window.shirim.secrets.list();

export const addSecret = (name: string, value: string): Promise<{ ok: boolean }> =>
  window.shirim.secrets.add(name, value);

export const deleteSecret = (name: string): Promise<void> =>
  window.shirim.secrets.delete(name);

export const revealSecret = (name: string): Promise<{ name: string; value: string }> =>
  window.shirim.secrets.reveal(name);

export const checkSecrets = (names: string[]): Promise<SecretsCheckResponse> =>
  window.shirim.secrets.check(names);

/* ---------- Edit with AI ---------- */

export type EditTurn = {
  turn_id: number;
  user_message: string;
  status: 'done' | 'error';
  files_changed: string[];
  tsc_ok: boolean | null;
  tsc_errors: string | null;
  agent_reply: string | null;
  duration_ms: number;
};

export type EditResponse = {
  session_id: string;
  turn: EditTurn;
};

export type EditSession = {
  session_id: string;
  install_id: string;
  app_context: {
    project_type: string;
    framework: string;
    styling: string;
    components_count: number;
  };
  turn_count: number;
  turns: EditTurn[];
};

export type EditUndoResponse = {
  ok: boolean;
  restored_to_before_turn: number;
};

export const sendEdit = (installId: string, message: string, sessionId?: string | null): Promise<EditResponse> =>
  window.shirim.edit.send(installId, message, sessionId);

export const getEditSession = (installId: string): Promise<EditSession> =>
  window.shirim.edit.getSession(installId);

export const undoEditTurn = (installId: string, turnId: number): Promise<EditUndoResponse> =>
  window.shirim.edit.undo(installId, turnId);

/* ---------- Search ---------- */

export type SearchResolvedAs = 'search' | 'url' | 'slug';

export type SearchResponse = {
  query: string;
  total_count: number;
  returned: number;
  filtered_out: number;
  resolved_as: SearchResolvedAs;
  repos: Repository[];
};

export const searchRepos = (query: string, limit = 50) => {
  const q = encodeURIComponent(query);
  return getJson<SearchResponse>(`${API_BASE}/api/search?q=${q}&limit=${limit}`);
};
