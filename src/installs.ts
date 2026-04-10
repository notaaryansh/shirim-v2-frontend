import type { AppType, RepoDetail } from './api';

export type InstalledEntry = {
  install_id: string;
  owner_repo: string;       // "vercel/next.js" — primary key
  name: string;
  desc: string;
  language: string;
  stars: string;
  installed_at: number;     // Date.now()
  image_url: string | null; // snapshot of first README image (for the row thumbnail)
  result: {
    summary: string;
    run_command: string;
    entry_point: string;
    app_type: AppType;
    env_vars_used?: string[];
  };
};

const KEY = 'shirim-installed-repos';

function read(): InstalledEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as InstalledEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: InstalledEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(entries));
  window.dispatchEvent(new CustomEvent('shirim-installs-changed'));
}

/** Returns installs newest-first. */
export function getInstalls(): InstalledEntry[] {
  return read().sort((a, b) => b.installed_at - a.installed_at);
}

/** Upsert by owner_repo — reinstalling the same repo updates timestamp + result. */
export function addInstall(entry: InstalledEntry): void {
  const existing = read();
  const filtered = existing.filter(e => e.owner_repo !== entry.owner_repo);
  filtered.push(entry);
  write(filtered);
}

export function removeInstall(owner_repo: string): void {
  const filtered = read().filter(e => e.owner_repo !== owner_repo);
  write(filtered);
}

/** Build an entry skeleton from the project + detail objects. Result fields are
 *  placeholders and should be overwritten with the real install result before saving. */
export function snapshotFromDetail(
  repo: { name: string; desc: string; language: string; stars: string; repo: string },
  detail: RepoDetail | null,
  install_id: string,
): InstalledEntry {
  return {
    install_id,
    owner_repo: repo.repo,
    name: repo.name,
    desc: repo.desc,
    language: repo.language,
    stars: repo.stars,
    installed_at: Date.now(),
    image_url: detail?.images?.[0] ?? null,
    result: {
      summary: detail?.summary.description ?? '',
      run_command: '',
      entry_point: '',
      app_type: 'cli',
      env_vars_used: [],
    },
  };
}

/** "just now", "2m ago", "1h ago", "3d ago". Good enough for the Installed list. */
export function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}
