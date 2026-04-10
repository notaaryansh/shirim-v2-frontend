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

export const kickInstall = (ownerRepo: string) =>
  postJson<InstallStartResponse>(`${API_BASE}/api/v1/install/${ownerRepo}`);

export const fetchInstallProgress = (installId: string) =>
  getJson<InstallProgress>(`${API_BASE}/api/v1/install/${installId}/progress`);

/** POST /cancel — stops the task, KEEPS the workdir on disk for debugging. */
export const cancelInstall = (installId: string) =>
  postJson<InstallCancelResponse>(`${API_BASE}/api/v1/install/${installId}/cancel`);

/** DELETE — stops the task AND wipes the workdir. Use when the user dismisses a
 *  failed / cancelled install and has no intent to retry from the same install_id. */
export const deleteInstall = async (installId: string): Promise<void> => {
  const res = await authFetch(`${API_BASE}/api/v1/install/${installId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    throw new Error(`${res.status} ${res.statusText} @ /api/v1/install/${installId}`);
  }
};

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
