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

export const fetchHome = () => getJson<TabResponse>(`${API_BASE}/api/home`);
export const fetchDiscover = () => getJson<TabResponse>(`${API_BASE}/api/discover`);
export const fetchRepoDetail = (ownerRepo: string) =>
  getJson<RepoDetail>(`${API_BASE}/api/repos/${ownerRepo}`);
