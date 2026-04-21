import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Home, Compass, Download, Settings, ChevronLeft, ChevronRight, ChevronDown, Search, Play, Square, RefreshCw, Trash2, FolderOpen, ExternalLink, X, AlertTriangle, Check, Workflow as WorkflowIcon, GraduationCap } from 'lucide-react';
import {
  fetchHome, fetchDiscover, fetchRepoDetail,
  kickInstall, fetchInstallProgress, cancelInstall, deleteInstall,
  searchRepos,
  startRun, fetchRunState, stopRun, fetchRunLogs,
  listSecrets, addSecret, deleteSecret, revealSecret,
  sendEdit, getEditSession, undoEditTurn,
  type EditTurn,
  type Repository, type RepoDetail, type InstallProgress, type InstallStep, type StepStatus,
  type RunResponse, type RunStatus, type SecretEntry,
} from './api';
import {
  getInstalls, addInstall, removeInstall, snapshotFromDetail, formatRelative,
  type InstalledEntry,
} from './installs';
import {
  getCachedDetail, hasCachedDetail, setCachedDetail, preloadImages,
} from './detailCache';
import {
  isAuthenticated, setSession, setUser, signOut, sendOtp, verifyOtp, fetchMe, getUser,
} from './auth';
import WorkflowsPage from './WorkflowsPage';
import TutorialPage from './TutorialPage';
import HomeOverview from './HomeOverview';
import './index.css';

/* ------------------------- README DATA FETCHER -------------------------
 * For each {owner}/{repo}, fetch README.md from raw.githubusercontent.com,
 * extract:
 *   - all non-badge images (markdown + HTML)
 *   - the first H1 title
 *   - the first non-empty paragraph for use as a description
 * Memoized in-memory and in localStorage so re-renders / reloads don't refetch.
 */

type ReadmeData = {
  images: string[];
  title: string | null;
  description: string | null;
};

const README_DATA_CACHE: Record<string, ReadmeData | null> = {};
const README_PENDING: Record<string, Promise<ReadmeData | null>> = {};

const BADGE_PATTERNS = [
  'shields.io',
  'travis-ci',
  'circleci',
  'codecov.io',
  'badgen.net',
  'badge.svg',
  'badge.png',
  'github.com/sponsors',
  'githubusercontent.com/u/',
  'opencollective',
  'discord.com/api',
  'app.netlify.com',
  'forthebadge',
];

function isLikelyBadge(url: string): boolean {
  const lower = url.toLowerCase();
  return BADGE_PATTERNS.some(p => lower.includes(p));
}

function resolveImageUrl(url: string, ownerRepo: string, branch: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  const cleaned = url.replace(/^[.\/]+/, '');
  return `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${cleaned}`;
}

function extractTitle(md: string): string | null {
  const match = md.match(/^#\s+(.+)$/m);
  return match ? match[1].trim().replace(/[`*_]/g, '') : null;
}

function extractDescription(md: string): string | null {
  // Strip HTML comments and obvious HTML wrappers, but keep text content.
  let cleaned = md.replace(/<!--[\s\S]*?-->/g, '');
  cleaned = cleaned.replace(/<\/?(?:p|div|span|center|a|sub|sup|br)[^>]*>/gi, '');
  // Drop image markdown entirely.
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  // Drop HTML <img>, <picture>, <source> tags entirely.
  cleaned = cleaned.replace(/<(?:img|picture|source)[^>]*>/gi, '');
  // Drop link wrappers but keep their text label.
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('>')) continue;
    if (line.startsWith('-') || line.startsWith('*')) continue;
    if (line.startsWith('|')) continue;
    if (line.startsWith('```')) continue;
    if (/^[-=_*]{3,}$/.test(line)) continue;   // horizontal rules
    if (line.length < 40) continue;             // skip noisy short lines
    return line.replace(/\s+/g, ' ').slice(0, 600);
  }
  return null;
}

function extractImages(md: string, ownerRepo: string, branch: string): string[] {
  const matches: { index: number; url: string }[] = [];
  let m: RegExpExecArray | null;

  const mdRe = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
  while ((m = mdRe.exec(md)) !== null) matches.push({ index: m.index, url: m[1] });

  const htmlRe = /<img[^>]+src=["']([^"']+)["']/gi;
  while ((m = htmlRe.exec(md)) !== null) matches.push({ index: m.index, url: m[1] });

  matches.sort((a, b) => a.index - b.index);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const { url } of matches) {
    if (isLikelyBadge(url)) continue;
    const resolved = resolveImageUrl(url, ownerRepo, branch);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

async function fetchReadmeData(ownerRepo: string): Promise<ReadmeData | null> {
  if (ownerRepo in README_DATA_CACHE) return README_DATA_CACHE[ownerRepo];
  if (ownerRepo in README_PENDING) return README_PENDING[ownerRepo];

  const cacheKey = `shirim-readme-data:${ownerRepo}`;
  try {
    const persisted = localStorage.getItem(cacheKey);
    if (persisted !== null) {
      const value: ReadmeData | null = persisted === '__null__' ? null : JSON.parse(persisted);
      README_DATA_CACHE[ownerRepo] = value;
      return value;
    }
  } catch {}

  const promise = (async (): Promise<ReadmeData | null> => {
    for (const branch of ['main', 'master']) {
      try {
        const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${branch}/README.md`);
        if (!res.ok) continue;
        const md = await res.text();

        const data: ReadmeData = {
          images: extractImages(md, ownerRepo, branch),
          title: extractTitle(md),
          description: extractDescription(md),
        };
        README_DATA_CACHE[ownerRepo] = data;
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
        return data;
      } catch {}
    }

    README_DATA_CACHE[ownerRepo] = null;
    try { localStorage.setItem(cacheKey, '__null__'); } catch {}
    return null;
  })();

  README_PENDING[ownerRepo] = promise;
  const result = await promise;
  delete README_PENDING[ownerRepo];
  return result;
}

/* Mock project data removed — projects now come from the backend via fetchHome / fetchDiscover. */

/* ------------------------- DISCOVER: REPLACE X WITH -------------------------
 * Placeholder data for the Discover tab. Each section is a "Replace {tool}
 * with:" group showing 3-4 open-source alternatives. Clicking a mini card
 * opens the normal product detail page.
 */

type ReplacementSection = {
  id: string;
  title: string;
  description: string;
  repos: Repository[];
};

const REPLACEMENTS: ReplacementSection[] = [
  {
    id: 'notion',
    title: 'Replace Notion with:',
    description: 'Open-source knowledge bases and workspaces that keep your data on your own machine.',
    repos: [
      { id: 9001, name: 'logseq',   repo: 'logseq/logseq',           desc: 'Privacy-first, open-source knowledge base with a local-first architecture.',           language: 'Clojure',    stars: '34k',  summary: null },
      { id: 9002, name: 'appflowy', repo: 'AppFlowy-IO/AppFlowy',    desc: 'Open-source Notion alternative built in Rust and Flutter. You own your data.',           language: 'Rust',       stars: '55k',  summary: null },
      { id: 9003, name: 'affine',   repo: 'toeverything/AFFiNE',     desc: 'Next-gen knowledge base that brings planning, sorting and creating together.',           language: 'TypeScript', stars: '38k',  summary: null },
      { id: 9004, name: 'anytype',  repo: 'anyproto/anytype-ts',     desc: 'Offline-first, end-to-end encrypted personal knowledge graph.',                          language: 'TypeScript', stars: '5.1k', summary: null },
    ],
  },
  {
    id: 'figma',
    title: 'Replace Figma with:',
    description: 'Collaborative design and diagramming tools you can self-host.',
    repos: [
      { id: 9101, name: 'excalidraw', repo: 'excalidraw/excalidraw', desc: 'Virtual whiteboard for sketching hand-drawn-feeling diagrams.',    language: 'TypeScript', stars: '82k', summary: null },
      { id: 9102, name: 'penpot',     repo: 'penpot/penpot',         desc: 'The open-source design tool for design and code collaboration.',    language: 'Clojure',    stars: '34k', summary: null },
      { id: 9103, name: 'drawio',     repo: 'jgraph/drawio',         desc: 'Production-grade diagramming that runs entirely in the browser.',   language: 'JavaScript', stars: '42k', summary: null },
    ],
  },
  {
    id: 'slack',
    title: 'Replace Slack with:',
    description: 'Team chat platforms that you host yourself, with no per-seat pricing.',
    repos: [
      { id: 9201, name: 'mattermost',  repo: 'mattermost/mattermost',        desc: 'High trust messaging for the DevSecOps lifecycle.',                language: 'Go',         stars: '30k', summary: null },
      { id: 9202, name: 'rocket.chat', repo: 'RocketChat/Rocket.Chat',       desc: 'The communications platform that puts data protection first.',    language: 'TypeScript', stars: '40k', summary: null },
      { id: 9203, name: 'zulip',       repo: 'zulip/zulip',                  desc: 'Threaded team chat with a distinctive topic-based model.',         language: 'Python',     stars: '22k', summary: null },
    ],
  },
  {
    id: 'dropbox',
    title: 'Replace Dropbox with:',
    description: 'Self-hosted file sync and cloud storage without the subscription.',
    repos: [
      { id: 9301, name: 'nextcloud',   repo: 'nextcloud/server',      desc: 'The most popular self-hosted cloud collaboration platform.',  language: 'PHP',        stars: '28k', summary: null },
      { id: 9302, name: 'seafile',     repo: 'haiwen/seafile',        desc: 'High performance file syncing and sharing with file encryption.', language: 'C',       stars: '13k', summary: null },
      { id: 9303, name: 'filebrowser', repo: 'filebrowser/filebrowser', desc: 'Web-based file manager for your server with a clean UI.',   language: 'Go',         stars: '26k', summary: null },
    ],
  },
  {
    id: 'chatgpt',
    title: 'Replace ChatGPT with:',
    description: 'Local-first chat frontends that run against your own models or API keys.',
    repos: [
      { id: 9401, name: 'open-webui', repo: 'open-webui/open-webui', desc: 'User-friendly AI interface that supports Ollama and OpenAI APIs.',   language: 'Svelte',     stars: '51k', summary: null },
      { id: 9402, name: 'lobe-chat',  repo: 'lobehub/lobe-chat',     desc: 'Modern-design ChatGPT/LLMs UI/framework with plugin support.',       language: 'TypeScript', stars: '46k', summary: null },
      { id: 9403, name: 'librechat',  repo: 'danny-avila/LibreChat', desc: 'Enhanced ChatGPT clone with multi-model support and self-hosting.',  language: 'TypeScript', stars: '18k', summary: null },
      { id: 9404, name: 'chatbot-ui', repo: 'mckaywrigley/chatbot-ui', desc: 'An open-source AI chat app for everyone with a clean interface.',   language: 'TypeScript', stars: '28k', summary: null },
    ],
  },
];


/* ------------------------- RUN (LAUNCH) STATE -------------------------
 * In-memory state for running installed apps. Keyed by install_id.
 * Lost on window reload (same as the backend's v1 run registry). */

type RunEntry = {
  run: RunResponse;
  openedUrl: boolean;
};

type RunErrorState = {
  installId: string;
  installName: string;
  status: RunStatus;
  exitCode: number | null;
  command: string;
  logs: string[];
};

/** Compute the disk size of an install directory using `du -sh` via Node's
 *  child_process. Works on macOS/Linux. Returns human-readable size like "124MB".
 *  Results are cached in memory so tab-switching doesn't cause a brief "—" flash. */
const _sizeCache = new Map<string, string>();

function computeInstallSize(installId: string): Promise<string | null> {
  const cached = _sizeCache.get(installId);
  if (cached) return Promise.resolve(cached);

  return new Promise(resolve => {
    try {
      const req = (window as any).require;
      if (!req) { resolve(null); return; }
      const { exec } = req('child_process');
      const os = req('os');
      const path = req('path');
      const dir = path.join(os.homedir(), '.shirim', 'installs', installId);
      exec(`du -sh "${dir}" 2>/dev/null`, { encoding: 'utf8' }, (err: any, stdout: string) => {
        if (err || !stdout) { resolve(null); return; }
        const raw = stdout.split('\t')[0].trim();
        const size = raw.replace(/([KMGT])$/i, '$1B');
        _sizeCache.set(installId, size);
        resolve(size);
      });
    } catch {
      resolve(null);
    }
  });
}

function getCachedSize(installId: string): string | null {
  return _sizeCache.get(installId) ?? null;
}

/** Format elapsed time: "42s" under 60s, "2:05" at 60s+. */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** Open a URL in the user's default browser. Uses Electron's shell.openExternal
 *  when available; falls back to window.open for plain browser dev. */
function openExternal(url: string): void {
  try {
    const req = (window as any).require;
    if (req) {
      const { shell } = req('electron');
      shell.openExternal(url);
      return;
    }
  } catch { /* not in Electron */ }
  window.open(url, '_blank', 'noopener,noreferrer');
}


/** App-level install state — hoisted out of InstallModal so polling survives
 *  the modal being closed. Keyed by "owner/repo". */
type ActiveInstall = {
  install_id: string;            // empty string until kickoff resolves
  repo: Repository;
  detail: RepoDetail | null;
  startedAt: number;
  progress: InstallProgress | null;
  pollError: string | null;
  kickoffError: string | null;
  saved: boolean;                // true after the success payload is persisted to localStorage
  cancelling: boolean;           // user hit Cancel, awaiting terminal state from the runner
};

function isTerminalInstall(a: ActiveInstall): boolean {
  return !!a.kickoffError ||
    a.progress?.overall_status === 'success' ||
    a.progress?.overall_status === 'failure' ||
    a.progress?.overall_status === 'cancelled';
}

function isRunningInstall(a: ActiveInstall): boolean {
  return !a.kickoffError && (
    !a.progress ||
    a.progress.overall_status === 'running' ||
    a.progress.overall_status === 'pending'
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<'Home' | 'Discover' | 'Installed' | 'Workflows' | 'Tutorial' | 'Settings'>('Home');
  const [selectedProject, setSelectedProject] = useState<Repository | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchHint, setShowSearchHint] = useState(false);
  const [activeSearch, setActiveSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [searchResults, setSearchResults] = useState<Repository[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeInstalls, setActiveInstalls] = useState<Record<string, ActiveInstall>>({});
  const [viewingInstallKey, setViewingInstallKey] = useState<string | null>(null);
  const pollTimersRef = useRef<Record<string, number>>({});
  const discoverPrefetchedRef = useRef(false);
  const [activeRuns, setActiveRuns] = useState<Record<string, RunEntry>>({});
  const [runError, setRunError] = useState<RunErrorState | null>(null);
  const runPollTimersRef = useRef<Record<string, number>>({});
  type RunningApp = { installId: string; url: string; name: string };
  const [runningApps, setRunningApps] = useState<RunningApp[]>([]);
  const [focusedAppId, setFocusedAppId] = useState<string | null>(null);
  const focusedApp = runningApps.find(a => a.installId === focusedAppId) ?? null;
  const [installedRepos, setInstalledRepos] = useState<InstalledEntry[]>(() => getInstalls());
  // Home's Popular / Discover sections are sourced from hardcoded constants
  // (HOME_POPULAR / REPLACEMENTS). We still hit the backend to surface any
  // dataError / dataLoading state, but nothing actually consumes the response
  // anymore — kept to preserve the existing UX around backend availability.
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean>(isAuthenticated());
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('shirim-theme') : null;
    return stored === 'light' ? 'light' : 'dark';
  });

  // Apply the chosen theme to <html data-theme=...> and persist it.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('shirim-theme', theme);
  }, [theme]);

  // Fetch curated projects from the backend (Home + Discover in parallel).
  // Home's Popular / Recently Run are then overridden with hardcoded frontend
  // lists so we have precise control over what the user sees on the landing tab.
  const loadProjects = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      // Response is intentionally unused — hardcoded constants drive Home/Discover.
      // We still run the fetches to detect backend availability for the error banner.
      await Promise.all([fetchHome(), fetchDiscover()]);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDataLoading(false);
    }
  };

  /* ------------------------- INSTALL ORCHESTRATION -------------------------
   * Install state lives at the app level so that closing the modal doesn't
   * cancel the polling loop. Multiple repos can install in parallel. The
   * Installed tab shows in-progress installs in a dedicated section, and the
   * sidebar's "Installed" nav item pulses a small white dot while any install
   * is still running.
   */

  const pollInstall = (key: string, installId: string) => {
    const tick = async () => {
      try {
        const p = await fetchInstallProgress(installId);
        let shouldSave = false;
        setActiveInstalls(prev => {
          const entry = prev[key];
          if (!entry) return prev;
          if (p.overall_status === 'success' && p.result && !entry.saved) {
            shouldSave = true;
          }
          return {
            ...prev,
            [key]: {
              ...entry,
              progress: p,
              pollError: null,
              saved: entry.saved || p.overall_status === 'success',
            },
          };
        });

        if (shouldSave && p.result) {
          const entry = activeInstalls[key];
          const currentEntry = entry ?? {
            repo: { repo: p.owner + '/' + p.repo, name: p.repo, desc: '', language: '', stars: '0', id: 0, summary: null } as Repository,
            detail: null as RepoDetail | null,
          };
          if (currentEntry.repo.repo) {
            const installEntry = snapshotFromDetail(
              {
                name: currentEntry.repo.name,
                desc: currentEntry.repo.desc,
                language: currentEntry.repo.language,
                stars: currentEntry.repo.stars,
                repo: currentEntry.repo.repo,
              },
              currentEntry.detail,
              p.install_id,
            );
            installEntry.result = {
              summary: p.result.summary,
              run_command: p.result.run_command,
              entry_point: p.result.entry_point,
              app_type: p.result.app_type,
              env_vars_used: p.result.env_vars_used ?? [],
            };
            addInstall(installEntry);
          }
        }

        if (p.overall_status === 'success' || p.overall_status === 'failure' || p.overall_status === 'cancelled') {
          delete pollTimersRef.current[key];
          return;
        }

        pollTimersRef.current[key] = window.setTimeout(tick, 1000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Polling failed';

        // 404 means the install session was lost (e.g. uvicorn restarted and
        // the in-memory registry was cleared). Stop polling — don't retry
        // infinitely against a dead install_id.
        if (msg.includes('404')) {
          delete pollTimersRef.current[key];
          setActiveInstalls(prev => {
            const entry = prev[key];
            if (!entry) return prev;
            return {
              ...prev,
              [key]: {
                ...entry,
                kickoffError: 'Install session lost — the backend was restarted. Close this and re-install.',
                pollError: null,
              },
            };
          });
          return;
        }

        // Transient network error — retry with backoff.
        setActiveInstalls(prev => {
          const entry = prev[key];
          if (!entry) return prev;
          return {
            ...prev,
            [key]: { ...entry, pollError: msg },
          };
        });
        pollTimersRef.current[key] = window.setTimeout(tick, 2500);
      }
    };
    tick();
  };

  const startInstall = async (project: Repository, detail: RepoDetail | null) => {
    if (!project.repo) return;
    const key = project.repo;

    const existing = activeInstalls[key];
    if (existing && !isTerminalInstall(existing)) {
      setViewingInstallKey(key);
      return;
    }

    setActiveInstalls(prev => ({
      ...prev,
      [key]: {
        install_id: '',
        repo: project,
        detail,
        startedAt: Date.now(),
        progress: null,
        pollError: null,
        kickoffError: null,
        saved: false,
        cancelling: false,
      },
    }));
    setViewingInstallKey(key);

    if (pollTimersRef.current[key]) {
      window.clearTimeout(pollTimersRef.current[key]);
      delete pollTimersRef.current[key];
    }

    try {
      const { install_id } = await kickInstall(project.repo);
      setActiveInstalls(prev => {
        const entry = prev[key];
        if (!entry) return prev;
        return { ...prev, [key]: { ...entry, install_id } };
      });
      pollInstall(key, install_id);
    } catch (err) {
      setActiveInstalls(prev => {
        const entry = prev[key];
        if (!entry) return prev;
        return {
          ...prev,
          [key]: { ...entry, kickoffError: err instanceof Error ? err.message : 'Failed to start install' },
        };
      });
    }
  };

  const retryInstall = (key: string) => {
    const entry = activeInstalls[key];
    if (!entry) return;
    if (pollTimersRef.current[key]) {
      window.clearTimeout(pollTimersRef.current[key]);
      delete pollTimersRef.current[key];
    }
    setActiveInstalls(prev => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    setTimeout(() => startInstall(entry.repo, entry.detail), 0);
  };

  const dismissInstall = (key: string) => {
    const entry = activeInstalls[key];
    if (pollTimersRef.current[key]) {
      window.clearTimeout(pollTimersRef.current[key]);
      delete pollTimersRef.current[key];
    }
    // If this was a non-success dismissal (failure / cancelled), wipe the
    // backend workdir so we don't accumulate orphaned scratch directories.
    // Success workdirs stay on disk — the user may want to run the artifact.
    if (entry?.install_id && entry.progress && entry.progress.overall_status !== 'success') {
      void deleteInstall(entry.install_id).catch(() => { /* best-effort cleanup */ });
    }
    setActiveInstalls(prev => {
      const { [key]: _removed, ...rest } = prev;
      return rest;
    });
    setViewingInstallKey(cur => (cur === key ? null : cur));
  };

  // User clicked Cancel — tell the backend to abort, keep polling so we see
  // the terminal state transition (the runner may take up to one bash-command
  // duration to observe the cancel flag).
  const cancelActiveInstall = async (key: string) => {
    const entry = activeInstalls[key];
    if (!entry || !entry.install_id) return;
    setActiveInstalls(prev => {
      const cur = prev[key];
      if (!cur) return prev;
      return { ...prev, [key]: { ...cur, cancelling: true } };
    });
    try {
      await cancelInstall(entry.install_id);
    } catch (err) {
      setActiveInstalls(prev => {
        const cur = prev[key];
        if (!cur) return prev;
        return {
          ...prev,
          [key]: {
            ...cur,
            cancelling: false,
            pollError: err instanceof Error ? err.message : 'Cancel request failed',
          },
        };
      });
    }
  };

  useEffect(() => {
    return () => {
      Object.values(pollTimersRef.current).forEach(id => window.clearTimeout(id));
      pollTimersRef.current = {};
    };
  }, []);

  const anyInstallRunning = Object.values(activeInstalls).some(isRunningInstall);

  /* ------------------------- RUN (LAUNCH) ORCHESTRATION -------------------------
   * Manages launching installed apps, polling for URL detection, opening in
   * the system browser, handling crashes with a log-tail error dialog, and
   * stopping processes via SIGTERM.
   */

  const clearRunPollTimer = (installId: string) => {
    if (runPollTimersRef.current[installId]) {
      window.clearInterval(runPollTimersRef.current[installId]);
      delete runPollTimersRef.current[installId];
    }
  };

  const processRunResponse = async (
    installId: string,
    entry: InstalledEntry | undefined,
    r: RunResponse,
  ) => {
    setActiveRuns(prev => {
      const existing = prev[installId];
      return { ...prev, [installId]: { run: r, openedUrl: !!existing?.openedUrl } };
    });

    if (r.status === 'running' && r.url) {
      setActiveRuns(prev => {
        const cur = prev[installId];
        if (cur && !cur.openedUrl) {
          // Add to running apps list + focus it.
          const newApp = { installId, url: r.url!, name: entry?.name ?? installId };
          setRunningApps(prev => {
            if (prev.some(a => a.installId === installId)) return prev;
            return [...prev, newApp];
          });
          setFocusedAppId(installId);
          return { ...prev, [installId]: { ...cur, openedUrl: true } };
        }
        return prev;
      });
      clearRunPollTimer(installId);
      return;
    }

    if (r.status === 'starting') {
      if (!runPollTimersRef.current[installId]) {
        runPollTimersRef.current[installId] = window.setInterval(async () => {
          try {
            const rr = await fetchRunState(installId);
            processRunResponse(installId, entry, rr);
          } catch { /* transient network error — keep trying */ }
        }, 1000);
      }
      return;
    }

    // Terminal: exited / crashed / stopped
    clearRunPollTimer(installId);
    setActiveRuns(prev => {
      const { [installId]: _removed, ...rest } = prev;
      return rest;
    });
    // Remove from the running apps tab bar.
    setRunningApps(prev => prev.filter(a => a.installId !== installId));
    if (focusedAppId === installId) setFocusedAppId(null);

    if (r.status === 'crashed' || r.status === 'exited') {
      let logs: string[] = [];
      try {
        const res = await fetchRunLogs(installId, 200);
        logs = res.lines;
      } catch { /* best-effort */ }
      setRunError({
        installId,
        installName: entry?.name ?? installId,
        status: r.status,
        exitCode: r.exit_code,
        command: r.command,
        logs,
      });
    }
  };

  const startInstallRun = async (entry: InstalledEntry) => {
    if (activeRuns[entry.install_id]) return;

    setActiveRuns(prev => ({
      ...prev,
      [entry.install_id]: {
        run: {
          run_id: '',
          install_id: entry.install_id,
          command: entry.result.run_command,
          pid: null,
          url: null,
          port: null,
          status: 'starting',
          started_at: Date.now() / 1000,
          finished_at: null,
          exit_code: null,
        },
        openedUrl: false,
      },
    }));

    try {
      const r = await startRun(entry.install_id);
      await processRunResponse(entry.install_id, entry, r);
    } catch (err) {
      clearRunPollTimer(entry.install_id);
      setActiveRuns(prev => {
        const { [entry.install_id]: _removed, ...rest } = prev;
        return rest;
      });
      setRunError({
        installId: entry.install_id,
        installName: entry.name,
        status: 'crashed',
        exitCode: null,
        command: entry.result.run_command,
        logs: [err instanceof Error ? err.message : 'Failed to start run'],
      });
    }
  };

  const stopInstallRun = async (installId: string) => {
    try {
      const r = await stopRun(installId);
      await processRunResponse(installId, undefined, r);
    } catch {
      clearRunPollTimer(installId);
      setActiveRuns(prev => {
        const { [installId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  // Cleanup run poll timers on unmount.
  useEffect(() => {
    return () => {
      Object.values(runPollTimersRef.current).forEach(id => window.clearInterval(id));
      runPollTimersRef.current = {};
    };
  }, []);

  // Keep installedRepos in sync with localStorage so ProductPage can
  // reactively know when a repo is already installed (→ show "Launch" not "Install").
  useEffect(() => {
    const onChange = () => setInstalledRepos(getInstalls());
    window.addEventListener('shirim-installs-changed', onChange);
    return () => window.removeEventListener('shirim-installs-changed', onChange);
  }, []);

  // Derive the matching InstalledEntry for the currently-viewed product page.
  const matchedInstall = selectedProject?.repo
    ? installedRepos.find(e => e.owner_repo === selectedProject.repo) ?? null
    : null;

  // Only fetch project data once the user is authenticated — avoids pointless 401s.
  useEffect(() => {
    if (authed) loadProjects();
  }, [authed]);

  // On sign-in (cold launch or after sign-out → sign-in), walk the existing
  // detail cache and warm the browser's HTTP image cache for every repo we
  // already have metadata for. This means Home / Discover / Search clicks
  // render with zero network activity for both text AND images on subsequent
  // sessions, not just the first one where the prefetch ran.
  useEffect(() => {
    if (!authed) return;
    try {
      const raw = window.localStorage.getItem('shirim-detail-cache');
      if (!raw) return;
      const map = JSON.parse(raw) as Record<string, { images?: string[] }>;
      for (const entry of Object.values(map)) {
        if (entry?.images) preloadImages(entry.images);
      }
    } catch {
      // best-effort — ignore parse errors
    }
  }, [authed]);

  // Background prefetch: the first time the user visits Discover (per session),
  // fire fetchRepoDetail for every repo in REPLACEMENTS and store the responses
  // in the localStorage detail cache. Subsequent clicks open instantly with no
  // loading state. Concurrency-limited to 3 in-flight to avoid hammering the
  // backend.
  useEffect(() => {
    if (!authed) return;
    if (activeView !== 'Discover') return;
    if (discoverPrefetchedRef.current) return;
    discoverPrefetchedRef.current = true;

    const toFetch = REPLACEMENTS
      .flatMap(section => section.repos)
      .filter((repo): repo is Repository & { repo: string } =>
        !!repo.repo && !hasCachedDetail(repo.repo)
      );
    if (toFetch.length === 0) return;

    let cancelled = false;
    let index = 0;
    const worker = async () => {
      while (!cancelled && index < toFetch.length) {
        const i = index++;
        const repo = toFetch[i];
        try {
          const d = await fetchRepoDetail(repo.repo);
          if (cancelled) return;
          setCachedDetail(repo.repo, d);
          // Warm the browser's HTTP cache with the carousel images so clicks
          // render instantly with zero image-download latency.
          preloadImages(d.images);
        } catch {
          // best-effort — silently skip failures, user can still trigger a
          // live fetch by clicking
        }
      }
    };
    // Start 3 concurrent workers
    void Promise.all([worker(), worker(), worker()]);

    return () => { cancelled = true; };
  }, [authed, activeView]);

  // On launch, if the user appears to be signed in, validate the session against
  // /api/v1/auth/me. This refreshes the cached user and catches stale tokens early
  // (e.g. revoked on another device) instead of waiting for the first data fetch.
  useEffect(() => {
    if (!isAuthenticated()) return;
    fetchMe()
      .then(user => setUser(user))
      .catch(() => setAuthed(false));
    // Only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for token expiry broadcast from authFetch and flip back to the auth screen.
  useEffect(() => {
    const onExpired = () => setAuthed(false);
    window.addEventListener('shirim-auth-expired', onExpired);
    return () => window.removeEventListener('shirim-auth-expired', onExpired);
  }, []);

  // Debounce the "press enter to search" hint — only surface it 400ms after the
  // user stops typing, and only while their query is uncommitted.
  useEffect(() => {
    if (searchQuery.length === 0 || searchQuery === activeSearch) {
      setShowSearchHint(false);
      return;
    }
    setShowSearchHint(false);
    const t = setTimeout(() => setShowSearchHint(true), 400);
    return () => clearTimeout(t);
  }, [searchQuery, activeSearch]);

  // Commit the current query → hits /api/search, stores results, paginates client-side.
  const commitSearch = async () => {
    const q = searchQuery.trim();
    if (q.length === 0) {
      setActiveSearch('');
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    setActiveSearch(q);
    setCurrentPage(0);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const r = await searchRepos(q, 50);
      setSearchResults(r.repos);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    setCurrentPage(0);
    setSearchResults([]);
    setSearchError(null);
  };

  // Client-side pagination over the fetched search results.
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(searchResults.length / PAGE_SIZE));
  const pageResults = searchResults.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', backgroundColor: 'var(--bg)', color: 'var(--text-primary)', overflow: 'hidden' }}>

      {/* DRAG REGION — makes the top strip draggable like a native titlebar */}
      <div style={{
        height: '32px',
        flexShrink: 0,
        WebkitAppRegion: 'drag',
        backgroundColor: 'var(--titlebar-bg)',
        borderBottom: '1px solid var(--border)'
      } as CSSProperties} />

      {!authed ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: 'var(--bg)' }}>
          <AuthScreen onAuthSuccess={() => setAuthed(true)} />
        </div>
      ) : focusedApp ? (
        <AppViewer
          app={focusedApp}
          onStop={async () => {
            await stopInstallRun(focusedApp.installId);
            setRunningApps(prev => prev.filter(a => a.installId !== focusedApp.installId));
            setFocusedAppId(null);
          }}
          onHide={() => setFocusedAppId(null)}
        />
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* Running apps tab bar — Chrome-style tabs for background apps */}
      {runningApps.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 16px',
          backgroundColor: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          overflowX: 'auto'
        }}>
          {runningApps.map(app => (
            <div
              key={app.installId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface-2)',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-pixel)',
                whiteSpace: 'nowrap',
                transition: 'background-color 120ms ease-out'
              }}
            >
              <div
                className="pulse-dot"
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent)',
                  flexShrink: 0
                }}
              />
              <span
                onClick={() => setFocusedAppId(app.installId)}
                style={{ cursor: 'pointer' }}
              >
                {app.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void (async () => {
                    await stopInstallRun(app.installId);
                    setRunningApps(prev => prev.filter(a => a.installId !== app.installId));
                  })();
                }}
                title="Stop"
                style={{
                  width: '16px',
                  height: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '3px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 0,
                  flexShrink: 0
                }}
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

      {/* 1. LEFT SIDEBAR */}
      <div style={{ 
        width: '260px', 
        backgroundColor: 'var(--surface)', 
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 16px',
        flexShrink: 0
      }}>
        {/* Logo */}
        <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--accent)', letterSpacing: '-0.02em', marginBottom: '40px', paddingLeft: '8px' }}>
          SHIRIM
        </div>

        {/* Main Nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <NavItem icon={<Home size={18} />} label="Home" active={activeView === 'Home'} onClick={() => { setActiveView('Home'); setSelectedProject(null); }} />
          <NavItem icon={<Compass size={18} />} label="Discover" active={activeView === 'Discover'} onClick={() => { setActiveView('Discover'); setSelectedProject(null); }} />
          <NavItem
            icon={<Download size={18} />}
            label="Installed"
            active={activeView === 'Installed'}
            onClick={() => { setActiveView('Installed'); setSelectedProject(null); }}
            busy={anyInstallRunning}
          />
          <NavItem
            icon={<WorkflowIcon size={18} />}
            label="Workflows"
            active={activeView === 'Workflows'}
            onClick={() => { setActiveView('Workflows'); setSelectedProject(null); }}
          />
          <NavItem
            icon={<GraduationCap size={18} />}
            label="Tutorial"
            active={activeView === 'Tutorial'}
            onClick={() => { setActiveView('Tutorial'); setSelectedProject(null); }}
          />
        </div>

        {/* Bottom Nav */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <NavItem icon={<Settings size={18} />} label="Settings" active={activeView === 'Settings'} onClick={() => { setActiveView('Settings'); setSelectedProject(null); }} />
        </div>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {selectedProject ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ProductPage
              project={selectedProject}
              onBack={() => setSelectedProject(null)}
              onInstall={(repo, detail) => startInstall(repo, detail)}
              installedEntry={matchedInstall}
              onLaunch={startInstallRun}
            />
          </div>
        ) : (
        <>
        {/* Top Header / Search — hidden on Installed and Settings */}
        {(activeView === 'Home' || activeView === 'Discover') && (
        <div style={{ padding: '32px 40px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ 
                flex: 1, 
                display: 'flex', 
                alignItems: 'center', 
                backgroundColor: 'var(--surface-2)', 
                border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--border)'}`,
                boxShadow: searchFocused ? '0 0 0 3px var(--accent-glow)' : 'none',
                borderRadius: '100px',
                padding: '12px 20px',
                transition: 'all 120ms ease-out'
              }}>
              <Search size={18} color="var(--text-muted)" style={{ marginRight: '12px' }} />
              <input
                placeholder="search for apps, tools, repos..."
                value={searchQuery}
                onChange={(e) => {
                  const next = e.target.value;
                  setSearchQuery(next);
                  // When the user starts typing a new query, auto-clear the
                  // previous results so the old results view disappears
                  // without needing an explicit Clear button.
                  if (activeSearch && next !== activeSearch) {
                    setActiveSearch('');
                    setSearchResults([]);
                    setSearchError(null);
                    setCurrentPage(0);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitSearch();
                  if (e.key === 'Escape') clearSearch();
                }}
                style={{
                  background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-pixel)', fontSize: '15px', width: '100%'
                }}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
              />
              {dataLoading && !dataError && (
                <span className="spinner" style={{
                  marginLeft: '10px',
                  flexShrink: 0,
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center'
                }}>
                  <RefreshCw size={14} />
                </span>
              )}
              <span style={{
                color: 'var(--text-muted)',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                letterSpacing: '0.02em',
                overflow: 'hidden',
                maxWidth: showSearchHint ? '220px' : '0px',
                marginLeft: showSearchHint ? '12px' : '0px',
                opacity: showSearchHint ? 1 : 0,
                transform: showSearchHint ? 'translateX(0)' : 'translateX(6px)',
                transition: 'max-width 260ms ease-out, margin-left 260ms ease-out, opacity 200ms ease-out, transform 260ms ease-out',
                pointerEvents: 'none'
              }}>
                press <kbd style={{
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  margin: '0 2px'
                }}>enter</kbd> to search
              </span>
            </div>
          </div>

          {/* Results subtitle — shown below the search bar whenever a search is active. */}
          {activeSearch && !searchLoading && !searchError && (
            <div style={{
              marginTop: '12px',
              marginLeft: '22px',
              fontSize: '12px',
              color: 'var(--text-muted)'
            }}>
              Found <span style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{searchResults.length}</span> {searchResults.length === 1 ? 'result' : 'results'}
            </div>
          )}

        </div>
        )}

        {/* View Router */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeView === 'Installed' && (
            <InstalledPage
              activeInstalls={activeInstalls}
              onOpenInstall={(key) => setViewingInstallKey(key)}
              activeRuns={activeRuns}
              onRun={startInstallRun}
              onStop={stopInstallRun}
              onSelectRepo={(repo) => setSelectedProject(repo)}
            />
          )}
          {activeView === 'Workflows' && <WorkflowsPage />}
          {activeView === 'Tutorial' && <TutorialPage />}
          {activeView === 'Settings' && <SettingsPage theme={theme} setTheme={setTheme} />}
          {(activeView === 'Home' || activeView === 'Discover') && dataError && (
            <BackendErrorState message={dataError} onRetry={loadProjects} />
          )}
          {(activeView === 'Home' || activeView === 'Discover') && !dataError && activeSearch && (
            <SearchResults
              results={pageResults}
              loading={searchLoading}
              error={searchError}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onSelect={(p) => setSelectedProject(p)}
            />
          )}
          {activeView === 'Home' && !dataError && !activeSearch && (
            <HomeOverview
              onSelectProject={(repo) => setSelectedProject(repo)}
              onNavDiscover={() => setActiveView('Discover')}
            />
          )}

          {activeView === 'Discover' && !dataError && !activeSearch && (
            <div style={{ padding: '24px 40px 48px' }}>
              {REPLACEMENTS.map(section => (
                <ReplacementCard
                  key={section.id}
                  section={section}
                  onSelect={(repo) => setSelectedProject(repo)}
                />
              ))}
            </div>
          )}
        </div>
        </>
        )}

      </div>

      </div>
      </div>
      )}

      {/* App-level install modal — rendered here so it survives view changes
          and so closing it doesn't cancel the underlying polling loop. */}
      {viewingInstallKey && activeInstalls[viewingInstallKey] && (
        <InstallModal
          install={activeInstalls[viewingInstallKey]}
          onClose={() => setViewingInstallKey(null)}
          onRetry={() => retryInstall(viewingInstallKey)}
          onDismiss={() => dismissInstall(viewingInstallKey)}
          onCancel={() => cancelActiveInstall(viewingInstallKey)}
        />
      )}

      {/* Run crash/exit error dialog — shows log tail + Retry. */}
      {runError && (
        <RunErrorDialog
          state={runError}
          onClose={() => setRunError(null)}
          onRetry={() => {
            const e = getInstalls().find(i => i.install_id === runError.installId);
            setRunError(null);
            if (e) startInstallRun(e);
          }}
        />
      )}
    </div>
  );
}


/* ------------------------- AUTH SCREEN ------------------------- */

const GoogleIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const GitHubIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const XIcon = ({ size = 18 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const OTP_LENGTH = 6;

function AuthScreen({ onAuthSuccess }: { onAuthSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [otpError, setOtpError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [emailFocused, setEmailFocused] = useState(false);

  // Resend cooldown ticker
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleSendOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email) return;
    setIsLoading(true);
    setSendError(null);
    setOtpError(null);
    try {
      await sendOtp(email);
      setStep('otp');
      setResendCooldown(60);
      setSendSuccess('OTP sent to your email');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    const otpValue = otp.join('');
    if (otpValue.length !== OTP_LENGTH) return;
    setIsLoading(true);
    setOtpError(null);
    try {
      const data = await verifyOtp(email, otpValue);
      setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in,
                user: data.user,
              });
      onAuthSuccess();
    } catch (err) {
      setOtpError(err instanceof Error ? err.message : 'Invalid OTP');
      setOtp(Array(OTP_LENGTH).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    setOtpError(null);
    if (value && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
    if (value && index === OTP_LENGTH - 1 && newOtp.every(d => d !== '')) {
      setTimeout(() => {
        // Use the latest state via a direct call — handleVerifyOtp reads `otp` but we just updated it
        // via newOtp. Since setOtp is async, we pass via closure.
        const full = newOtp.join('');
        if (full.length === OTP_LENGTH) {
          (async () => {
            setIsLoading(true);
            setOtpError(null);
            try {
              const data = await verifyOtp(email, full);
              setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in,
                user: data.user,
              });
              onAuthSuccess();
            } catch (err) {
              setOtpError(err instanceof Error ? err.message : 'Invalid OTP');
              setOtp(Array(OTP_LENGTH).fill(''));
              inputRefs.current[0]?.focus();
            } finally {
              setIsLoading(false);
            }
          })();
        }
      }, 100);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pastedData) return;
    const newOtp = [...otp];
    for (let i = 0; i < pastedData.length; i++) newOtp[i] = pastedData[i];
    setOtp(newOtp);
    if (pastedData.length === OTP_LENGTH) {
      setTimeout(() => {
        (async () => {
          setIsLoading(true);
          setOtpError(null);
          try {
            const data = await verifyOtp(email, pastedData);
            setSession({
                access_token: data.access_token,
                refresh_token: data.refresh_token,
                expires_in: data.expires_in,
                user: data.user,
              });
            onAuthSuccess();
          } catch (err) {
            setOtpError(err instanceof Error ? err.message : 'Invalid OTP');
            setOtp(Array(OTP_LENGTH).fill(''));
            inputRefs.current[0]?.focus();
          } finally {
            setIsLoading(false);
          }
        })();
      }, 100);
    } else {
      inputRefs.current[pastedData.length]?.focus();
    }
  };

  const handleBack = () => {
    setStep('email');
    setOtp(Array(OTP_LENGTH).fill(''));
    setOtpError(null);
    setSendSuccess(null);
  };

  const handleResend = () => {
    if (resendCooldown > 0) return;
    setOtp(Array(OTP_LENGTH).fill(''));
    setOtpError(null);
    handleSendOtp();
  };

  const socialProviders = [
    { name: 'Google', Icon: GoogleIcon },
    { name: 'GitHub', Icon: GitHubIcon },
    { name: 'X', Icon: XIcon },
  ];

  return (
    <div style={{
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '48px 24px'
    }}>
      <div className="fade-in" style={{ width: '100%', maxWidth: '380px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            fontSize: '28px',
            fontWeight: 'bold',
            color: 'var(--accent)',
            letterSpacing: '-0.02em',
            fontFamily: 'var(--font-pixel)'
          }}>
            SHIRIM
          </div>
        </div>

        {/* Card */}
        <div style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '32px'
        }}>
          {step === 'email' ? (
            <>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 500,
                color: 'var(--text-primary)',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                Sign in to continue
              </h2>

              {sendError && (
                <div style={{
                  backgroundColor: 'var(--surface-2)',
                  border: '1px solid var(--error)',
                  color: 'var(--error)',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  fontSize: '12px',
                  marginBottom: '16px',
                  textAlign: 'center',
                  wordBreak: 'break-word'
                }}>
                  {sendError}
                </div>
              )}

              <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  required
                  style={{
                    backgroundColor: 'var(--surface-2)',
                    border: `1px solid ${emailFocused ? 'var(--accent)' : 'var(--border)'}`,
                    boxShadow: emailFocused ? '0 0 0 3px var(--accent-glow)' : 'none',
                    borderRadius: '6px',
                    padding: '12px 16px',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '14px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    transition: 'all 120ms ease-out'
                  }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !email}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px 22px',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                    color: 'var(--on-accent)',
                    fontFamily: 'var(--font-pixel)',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    cursor: isLoading || !email ? 'not-allowed' : 'pointer',
                    opacity: isLoading || !email ? 0.5 : 1,
                    width: '100%',
                    transition: 'opacity 120ms ease-out'
                  }}>
                  {isLoading ? (
                    <>
                      <span className="spinner" style={{ display: 'inline-flex' }}>
                        <RefreshCw size={14} />
                      </span>
                      Sending...
                    </>
                  ) : (
                    <>
                      Continue with Email
                      <ChevronRight size={14} />
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div style={{
                position: 'relative',
                margin: '24px 0',
                height: '1px',
                backgroundColor: 'var(--border)'
              }}>
                <span style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  backgroundColor: 'var(--surface)',
                  padding: '0 12px',
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em'
                }}>
                  or
                </span>
              </div>

              {/* Social providers (all disabled) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {socialProviders.map(({ name, Icon }) => (
                  <button
                    key={name}
                    disabled
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'transparent',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '13px',
                      opacity: 0.55,
                      cursor: 'not-allowed'
                    }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <Icon size={16} />
                      Continue with {name}
                    </span>
                    <span style={{
                      fontSize: '9px',
                      padding: '3px 8px',
                      borderRadius: '3px',
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em'
                    }}>
                      Coming Soon
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            /* OTP STEP */
            <div>
              <h2 style={{
                fontSize: '20px',
                fontWeight: 500,
                color: 'var(--text-primary)',
                textAlign: 'center',
                marginBottom: '6px'
              }}>
                Enter verification code
              </h2>
              <p style={{
                fontSize: '13px',
                color: 'var(--text-muted)',
                textAlign: 'center',
                marginBottom: '24px'
              }}>
                OTP sent to{' '}
                <span style={{ color: 'var(--text-primary)' }}>{email}</span>
              </p>

              {sendSuccess && !otpError && (
                <div style={{
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  textAlign: 'center',
                  marginBottom: '14px'
                }}>
                  {sendSuccess}
                </div>
              )}

              {/* OTP input row */}
              <div
                key={otpError ?? 'ok'}
                className={otpError ? 'otp-shake' : undefined}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '8px',
                  marginBottom: '10px'
                }}>
                {otp.map((digit, index) => (
                  <input
                    key={index}
                    ref={(el) => { inputRefs.current[index] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={index === 0 ? handleOtpPaste : undefined}
                    autoFocus={index === 0}
                    style={{
                      width: '44px',
                      height: '54px',
                      textAlign: 'center',
                      fontSize: '20px',
                      fontFamily: 'var(--font-pixel)',
                      fontWeight: 500,
                      backgroundColor: 'var(--surface-2)',
                      border: `1px solid ${otpError ? 'var(--error)' : 'var(--border)'}`,
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      outline: 'none',
                      transition: 'border-color 120ms ease-out'
                    }}
                  />
                ))}
              </div>

              {otpError && (
                <div style={{
                  fontSize: '12px',
                  color: 'var(--error)',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}>
                  {otpError}
                </div>
              )}

              <button
                onClick={handleVerifyOtp}
                disabled={isLoading || otp.some(d => !d)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '12px 22px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                  color: 'var(--on-accent)',
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  cursor: isLoading || otp.some(d => !d) ? 'not-allowed' : 'pointer',
                  opacity: isLoading || otp.some(d => !d) ? 0.5 : 1,
                  width: '100%',
                  marginTop: '4px',
                  marginBottom: '12px'
                }}>
                {isLoading ? (
                  <>
                    <span className="spinner" style={{ display: 'inline-flex' }}>
                      <RefreshCw size={14} />
                    </span>
                    Verifying...
                  </>
                ) : (
                  'Verify OTP'
                )}
              </button>

              <button
                onClick={handleBack}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  width: '100%',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  fontFamily: 'var(--font-pixel)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  marginBottom: '16px'
                }}>
                <ChevronLeft size={14} />
                Back to email
              </button>

              <div style={{
                fontSize: '12px',
                color: 'var(--text-muted)',
                textAlign: 'center'
              }}>
                Didn't receive the code?{' '}
                {resendCooldown > 0 ? (
                  <span>
                    Resend in{' '}
                    <span style={{
                      display: 'inline-block',
                      width: '24px',
                      textAlign: 'left',
                      fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-secondary)'
                    }}>
                      {resendCooldown}s
                    </span>
                  </span>
                ) : (
                  <button
                    onClick={handleResend}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-pixel)',
                      fontSize: '12px',
                      padding: 0
                    }}>
                    Resend OTP
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p style={{
          textAlign: 'center',
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginTop: '24px',
          lineHeight: 1.6
        }}>
          By continuing, you agree to our{' '}
          <a href="#" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="#" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}


function NavItem({
  icon,
  label,
  active,
  onClick,
  busy = false,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '10px 12px',
        borderRadius: '6px',
        color: active ? 'var(--accent)' : 'var(--text-secondary)',
        backgroundColor: active ? 'var(--accent-glow)' : 'transparent',
        cursor: 'pointer',
        transition: 'all 120ms ease-out',
        position: 'relative'
      }}
      onMouseEnter={(e) => {
        if(!active) {
          e.currentTarget.style.color = 'var(--text-primary)';
        }
      }}
      onMouseLeave={(e) => {
        if(!active) {
          e.currentTarget.style.color = 'var(--text-secondary)';
        }
      }}>
      {icon}
      <span style={{ fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {label}
        {busy && (
          <span
            className="pulse-dot"
            title="Install in progress"
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              boxShadow: '0 0 6px rgba(255,255,255,0.55)',
              flexShrink: 0,
              transform: 'translateY(-5px)'
            }}
          />
        )}
      </span>
    </div>
  );
}


function ProjectCard({ project, onClick }) {
  const [hover, setHover] = useState(false);
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!project.repo) return;
    let cancelled = false;
    fetchReadmeData(project.repo).then(data => {
      if (!cancelled && data && data.images.length > 0) setImgUrl(data.images[0]);
    });
    return () => { cancelled = true; };
  }, [project.repo]);

  return (
    <div
      className="glow-hover"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        backgroundColor: hover ? 'var(--card-hover)' : 'var(--surface-2)',
        border: `1px solid ${hover ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
        cursor: 'pointer',
        overflow: 'hidden'
      }}
    >
      {/* Banner — README image if found, themed fallback otherwise */}
      <div style={{
        width: '100%',
        height: '100px',
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {imgUrl ? (
          <>
            <img
              src={imgUrl}
              alt=""
              onError={() => setImgUrl(null)}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover'
              }}
            />
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(180deg, transparent 55%, var(--image-shade) 100%)'
            }} />
          </>
        ) : (
          <FallbackBanner name={project.name} />
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '16px 20px 18px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{project.name}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)', fontSize: '12px' }}>
            <span style={{ color: 'var(--accent)' }}>★</span> {project.stars}
          </div>
        </div>

        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '12px',
          lineHeight: '1.5',
          marginBottom: '12px',
          flex: 1,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        } as CSSProperties}>
          {project.desc}
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            backgroundColor: 'var(--surface)', padding: '4px 8px', borderRadius: '4px',
            fontSize: '11px', color: 'var(--text-secondary)'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--accent-dim)' }} />
            {project.language}
          </div>
        </div>
      </div>
    </div>
  );
}


/* ------------------------- REPLACEMENT CARD (DISCOVER) ------------------------- */

function ReplacementCard({
  section,
  onSelect,
}: {
  section: ReplacementSection;
  onSelect: (repo: Repository) => void;
}) {
  return (
    <div
      className="fade-in"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '28px',
        marginBottom: '24px'
      }}>
      {/* Title */}
      <h2 style={{
        fontSize: '22px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        letterSpacing: '-0.01em',
        marginBottom: '6px'
      }}>
        {section.title}
      </h2>

      {/* Description */}
      <p style={{
        fontSize: '13px',
        color: 'var(--text-muted)',
        lineHeight: 1.6,
        marginBottom: '22px',
        maxWidth: '640px'
      }}>
        {section.description}
      </p>

      {/* Horizontally scrollable single-row strip.
          Shows 2 full cards + a 15% peek of the 3rd so users get an instant
          visual cue that the strip is scrollable. Vertical padding gives
          cards room to lift on hover without being clipped. */}
      <div
        className="hide-scrollbar"
        style={{
          overflowX: 'auto',
          overflowY: 'hidden',
          containerType: 'inline-size',
          paddingTop: '10px',
          paddingBottom: '10px'
        } as CSSProperties}>
        <div style={{
          display: 'grid',
          gridTemplateRows: '220px',
          gridAutoFlow: 'column',
          gridAutoColumns: 'calc((100cqw - 32px) / 2.15)',
          gap: '16px'
        }}>
          {section.repos.map(repo => (
            <ProjectCard
              key={repo.id}
              project={repo}
              onClick={() => onSelect(repo)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}


function FallbackBanner({ name }: { name: string }) {
  // Themed fallback shown when no README image was found.
  // Diagonal stripe pattern + a centered "label tag" with the project name.
  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: 'var(--surface)',
      backgroundImage: `repeating-linear-gradient(
        45deg,
        transparent 0px,
        transparent 9px,
        var(--surface-2) 9px,
        var(--surface-2) 10px
      )`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative'
    }}>
      <div style={{
        fontSize: '12px',
        fontFamily: 'var(--font-pixel)',
        color: 'var(--text-secondary)',
        backgroundColor: 'var(--surface)',
        padding: '6px 14px',
        border: '1px solid var(--border)',
        borderRadius: '4px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100% - 32px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {name}
      </div>
    </div>
  );
}


/* ------------------------- SEARCH RESULTS PAGE ------------------------- */

function SearchResults({
  results,
  loading,
  error,
  currentPage,
  totalPages,
  onPageChange,
  onSelect,
}: {
  results: Repository[];
  loading: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onSelect: (p: Repository) => void;
}) {
  return (
    <div style={{ padding: '18px 40px 40px' }}>
      {/* Loading state */}
      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '12px', padding: '60px 20px',
          color: 'var(--text-muted)', fontSize: '13px'
        }}>
          <span className="spinner" style={{ display: 'inline-flex' }}>
            <RefreshCw size={16} />
          </span>
          Searching…
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '14px',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface-2)'
        }}>
          <AlertTriangle size={18} color="var(--error)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', flex: 1 }}>
            Search failed
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'var(--font-pixel)' }}>
              {error}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && results.length === 0 && (
        <div style={{
          padding: '80px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '13px'
        }}>
          <div style={{ fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            No results found
          </div>
          <div>Try a different keyword or clear the search to browse categories.</div>
        </div>
      )}

      {/* Results list — vertically stacked full-width cards */}
      {!loading && !error && results.length > 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          marginBottom: '24px'
        }}>
          {results.map(proj => (
            <div key={proj.id} style={{ height: '220px' }}>
              <ProjectCard project={proj} onClick={() => onSelect(proj)} />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && results.length > 0 && totalPages > 1 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '16px',
          marginTop: '8px',
          paddingTop: '16px',
          borderTop: '1px solid var(--border)'
        }}>
          <PaginationButton
            disabled={currentPage === 0}
            onClick={() => onPageChange(currentPage - 1)}>
            <ChevronLeft size={14} />
            Prev
          </PaginationButton>

          <div style={{
            fontSize: '12px',
            color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.05em'
          }}>
            Page <span style={{ color: 'var(--text-primary)' }}>{currentPage + 1}</span>
            {' '}of {totalPages}
          </div>

          <PaginationButton
            disabled={currentPage >= totalPages - 1}
            onClick={() => onPageChange(currentPage + 1)}>
            Next
            <ChevronRight size={14} />
          </PaginationButton>
        </div>
      )}
    </div>
  );
}

function PaginationButton({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '8px 14px',
        borderRadius: '6px',
        border: `1px solid ${hover && !disabled ? 'var(--border-active)' : 'var(--border)'}`,
        backgroundColor: hover && !disabled ? 'var(--surface)' : 'transparent',
        color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 120ms ease-out'
      }}>
      {children}
    </button>
  );
}


/* ------------------------- APP VIEWER (EMBEDDED IFRAME) ------------------------- */

function AppViewer({
  app,
  onStop,
  onHide,
}: {
  app: { installId: string; url: string; name: string };
  onStop: () => void;
  onHide: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    await onStop();
  };

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '10px 20px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        flexShrink: 0
      }}>
        {/* Back / hide button */}
        <button
          onClick={onHide}
          title="Hide (app keeps running)"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            padding: '6px 12px 6px 8px',
            borderRadius: '6px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            cursor: 'pointer'
          }}>
          <ChevronLeft size={14} />
          Back
        </button>

        {/* App name + running indicator */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="pulse-dot" style={{
            width: '6px', height: '6px', borderRadius: '50%',
            backgroundColor: 'var(--accent)',
            flexShrink: 0
          }} />
          <span style={{
            fontSize: '13px',
            color: 'var(--text-primary)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {app.name}
          </span>
          <span style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-pixel)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {app.url}
          </span>
        </div>

        {/* Edit with AI toggle */}
        <button
          onClick={() => setAiPanelOpen(!aiPanelOpen)}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: aiPanelOpen ? 'var(--accent-glow)' : 'transparent',
            border: `1px solid ${aiPanelOpen ? 'var(--accent)' : 'var(--border)'}`,
            color: aiPanelOpen ? 'var(--accent)' : 'var(--text-secondary)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            cursor: 'pointer',
            transition: 'all 120ms ease-out'
          }}>
          ✦ Edit with AI
        </button>

        {/* Open externally */}
        <button
          onClick={() => openExternal(app.url)}
          title="Open in browser"
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            padding: '6px 12px',
            borderRadius: '6px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            cursor: 'pointer'
          }}>
          <ExternalLink size={12} />
          Browser
        </button>

        {/* Stop button */}
        <button
          onClick={handleStop}
          disabled={stopping}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: 'var(--error)',
            color: '#ffffff',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            fontWeight: 'bold',
            cursor: stopping ? 'not-allowed' : 'pointer',
            opacity: stopping ? 0.6 : 1
          }}>
          {stopping ? (
            <>
              <span className="spinner" style={{ display: 'inline-flex' }}>
                <RefreshCw size={11} />
              </span>
              Stopping…
            </>
          ) : (
            <>
              <Square size={11} />
              Stop
            </>
          )}
        </button>
      </div>

      {/* Body: iframe + optional AI panel */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <iframe
          src={app.url}
          title={`${app.name} — ${app.url}`}
          style={{
            flex: aiPanelOpen ? '1 1 72%' : '1 1 100%',
            border: 'none',
            backgroundColor: '#ffffff',
            transition: 'flex 200ms ease-out'
          }}
        />
        {aiPanelOpen && (
          <AiEditPanel
            installId={app.installId}
            onClose={() => setAiPanelOpen(false)}
          />
        )}
      </div>
    </div>
  );
}


/* ------------------------- BACKEND ERROR STATE ------------------------- */

/* ------------------------- AI EDIT PANEL (CHAT SIDEBAR) ------------------------- */

function AiEditPanel({ installId, onClose }: {
  installId: string;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<EditTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dropNotice, setDropNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragCounterRef = useRef(0);

  // Load existing session on mount
  useEffect(() => {
    getEditSession(installId)
      .then(session => {
        setSessionId(session.session_id);
        setTurns(session.turns);
      })
      .catch(() => { /* no session yet */ });
  }, [installId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    // Add a placeholder turn immediately (user message shown, agent_reply pending)
    const placeholderId = turns.length;
    setTurns(prev => [...prev, {
      turn_id: placeholderId,
      user_message: message,
      status: 'done',
      files_changed: [],
      tsc_ok: null,
      tsc_errors: null,
      agent_reply: null,
      duration_ms: 0,
    }]);
    setInput('');
    setLoading(true);

    try {
      const res = await sendEdit(installId, message, sessionId);
      setSessionId(res.session_id);
      // Replace the placeholder with the real response
      setTurns(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...res.turn,
          user_message: message,
        };
        return updated;
      });
    } catch (err) {
      setTurns(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          status: 'error',
          agent_reply: err instanceof Error ? err.message : 'Something went wrong. Try again.',
        };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async (turnId: number) => {
    try {
      await undoEditTurn(installId, turnId);
      setTurns(prev => prev.slice(0, turnId));
    } catch {
      // best-effort
    }
  };

  // Drag-and-drop: copy files to the project's public/ folder
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    try {
      const req = (window as any).require;
      if (!req) return;
      const fs = req('fs');
      const path = req('path');
      const os = req('os');

      const publicDir = path.join(os.homedir(), '.shirim', 'installs', installId, 'public');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }

      const added: string[] = [];
      for (const file of files) {
        const srcPath = (file as any).path;
        if (!srcPath) continue;
        const dest = path.join(publicDir, file.name);
        fs.copyFileSync(srcPath, dest);
        added.push(file.name);
      }

      if (added.length > 0) {
        // Touch a source file to trigger Vite's HMR, which causes Remotion
        // Studio (and other dev servers) to re-scan the project and pick up
        // the newly added assets in public/.
        try {
          const installDir = path.join(os.homedir(), '.shirim', 'installs', installId);
          const candidates = ['src/Root.tsx', 'src/index.tsx', 'src/App.tsx', 'src/main.tsx'];
          for (const c of candidates) {
            const p = path.join(installDir, c);
            if (fs.existsSync(p)) {
              const now = new Date();
              fs.utimesSync(p, now, now);
              break;
            }
          }
        } catch { /* best-effort HMR trigger */ }

        const names = added.join(', ');
        const label = added.length === 1
          ? `I added "${added[0]}"`
          : `I added ${added.length} files (${names})`;
        setInput(label + ' — ');
        setDropNotice(`✓ ${added.length === 1 ? added[0] : `${added.length} files`} added to project`);
        setTimeout(() => setDropNotice(null), 4000);
      }
    } catch (err) {
      console.error('Failed to copy files:', err);
    }
  };

  const hasMessages = turns.length > 0;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      style={{
        width: '28%',
        minWidth: '280px',
        maxWidth: '380px',
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--border)',
        backgroundColor: 'var(--bg)',
        flexShrink: 0,
        position: 'relative'
      }}>

      {/* Drop zone overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          backgroundColor: 'var(--accent-glow)',
          border: '2px dashed var(--accent)',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          pointerEvents: 'none'
        }}>
          <Download size={28} color="var(--accent)" />
          <div style={{
            fontSize: '14px',
            fontWeight: 500,
            color: 'var(--accent)'
          }}>
            Drop files to add to project
          </div>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}>
            Files will be copied to the public/ folder
          </div>
        </div>
      )}
      {/* Floating close button (no header) */}
      <button onClick={onClose} style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: 5,
        width: '24px', height: '24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '5px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-muted)',
        cursor: 'pointer',
        padding: 0,
        opacity: 0.6,
        transition: 'opacity 120ms ease-out'
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}>
        <X size={12} />
      </button>

      {/* Messages area */}
      <div className="hide-scrollbar" style={{
        flex: 1,
        overflowY: 'auto',
        padding: '18px',
        paddingTop: '40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '18px'
      }}>
        {/* Empty state */}
        {!hasMessages && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '16px',
            padding: '40px 16px',
            color: 'var(--text-muted)'
          }}>
            <div style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              letterSpacing: '-0.01em'
            }}>
              What would you like to change?
            </div>
            <div style={{ fontSize: '12px', lineHeight: 1.6 }}>
              Describe what you see on screen and what you'd like different.
            </div>
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '8px',
              marginTop: '8px', width: '100%', maxWidth: '240px'
            }}>
              {['Make the text bigger', 'Change the background to dark blue', 'Add a fade transition between scenes'].map((ex, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(ex); }}
                  style={{
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--surface-2)',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    fontFamily: 'var(--font-pixel)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'border-color 120ms ease-out, background-color 120ms ease-out'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-active)'; e.currentTarget.style.backgroundColor = 'var(--card-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.backgroundColor = 'var(--surface-2)'; }}>
                  "{ex}"
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation turns */}
        {turns.map(turn => (
          <AiChatTurn
            key={turn.turn_id}
            turn={turn}
            isLoading={loading && turn.agent_reply === null}
            onUndo={() => handleUndo(turn.turn_id)}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Drop notice */}
      {dropNotice && (
        <div className="fade-in" style={{
          padding: '8px 18px',
          fontSize: '11px',
          color: 'var(--accent)',
          backgroundColor: 'var(--accent-glow)',
          borderTop: '1px solid var(--border)',
          fontFamily: 'var(--font-pixel)',
          letterSpacing: '0.03em'
        }}>
          {dropNotice}
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: '14px 18px',
        borderTop: '1px solid var(--border)',
        backgroundColor: 'var(--surface)'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '10px',
          backgroundColor: 'var(--surface-2)',
          border: `1px solid ${inputFocused ? 'var(--accent)' : 'var(--border)'}`,
          boxShadow: inputFocused ? '0 0 0 3px var(--accent-glow)' : 'none',
          borderRadius: '10px',
          padding: '10px 14px',
          transition: 'all 120ms ease-out'
        }}>
          <textarea
            placeholder="Type a change..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-expand: reset height to auto so scrollHeight recalculates,
              // then set to scrollHeight (capped by maxHeight via CSS).
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
                // Reset height after sending
                (e.target as HTMLTextAreaElement).style.height = 'auto';
              }
            }}
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '13px',
              resize: 'none',
              maxHeight: '140px',
              overflowY: 'auto',
              lineHeight: 1.5
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            style={{
              width: '30px',
              height: '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px',
              border: 'none',
              background: !input.trim() || loading
                ? 'var(--surface)'
                : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
              color: !input.trim() || loading ? 'var(--text-muted)' : 'var(--on-accent)',
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
              padding: 0
            }}>
            {loading ? (
              <span className="spinner" style={{ display: 'inline-flex' }}>
                <RefreshCw size={12} />
              </span>
            ) : (
              <ChevronRight size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function AiChatTurn({
  turn,
  isLoading,
  onUndo,
}: {
  turn: EditTurn;
  isLoading: boolean;
  onUndo: () => void;
}) {
  const filesCount = turn.files_changed.length;
  const durationLabel = turn.duration_ms > 0
    ? `${(turn.duration_ms / 1000).toFixed(1)}s`
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* User message — quiet, right-aligned, no bubble */}
      <div style={{
        textAlign: 'right',
        fontSize: '14px',
        color: 'var(--text-secondary)',
        lineHeight: 1.55,
        wordBreak: 'break-word',
        paddingLeft: '20%'
      }}>
        {turn.user_message}
      </div>

      {/* AI response — card treatment */}
      <div style={{
        backgroundColor: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '14px 16px',
        fontSize: '13px',
        lineHeight: 1.6,
        color: 'var(--text-primary)',
        wordBreak: 'break-word'
      }}>
        {/* Typing indicator */}
        {isLoading && !turn.agent_reply && (
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center', padding: '4px 0' }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="pulse-dot"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--text-muted)',
                  animationDelay: `${i * 200}ms`
                }}
              />
            ))}
          </div>
        )}

        {/* Agent reply */}
        {turn.agent_reply && (
          <div>{turn.agent_reply}</div>
        )}

        {/* Inline metadata line — always visible, not expandable */}
        {turn.status === 'done' && turn.agent_reply && (
          <div style={{
            marginTop: '10px',
            paddingTop: '10px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-pixel)',
            flexWrap: 'wrap'
          }}>
            {filesCount > 0 && (
              <span>{filesCount} {filesCount === 1 ? 'file' : 'files'} updated</span>
            )}
            {filesCount > 0 && durationLabel && (
              <span style={{ color: 'var(--border-active)' }}>·</span>
            )}
            {durationLabel && (
              <span>{durationLabel}</span>
            )}
            {turn.tsc_ok === false && (
              <>
                <span style={{ color: 'var(--border-active)' }}>·</span>
                <span style={{ color: 'var(--building)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertTriangle size={10} /> type issues
                </span>
              </>
            )}
            <span style={{ color: 'var(--border-active)' }}>·</span>
            <button
              onClick={onUndo}
              style={{
                background: 'none', border: 'none', padding: 0,
                color: 'var(--text-muted)', fontSize: '11px',
                cursor: 'pointer', fontFamily: 'var(--font-pixel)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                textDecorationColor: 'transparent',
                transition: 'text-decoration-color 180ms ease-out'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecorationColor = 'var(--text-muted)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecorationColor = 'transparent'; }}>
              ↩ Undo
            </button>
          </div>
        )}

        {/* Error state */}
        {turn.status === 'error' && turn.agent_reply && (
          <div style={{
            marginTop: '8px',
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px', color: 'var(--error)'
          }}>
            <AlertTriangle size={12} />
            Failed
          </div>
        )}
      </div>
    </div>
  );
}


function BackendErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      padding: '80px 40px',
      textAlign: 'center',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px'
    }}>
      <AlertTriangle size={32} color="var(--error)" />
      <div style={{ fontSize: '16px', color: 'var(--text-primary)' }}>
        Can't reach the backend
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', maxWidth: '520px', lineHeight: 1.6 }}>
        Make sure the Python backend is running at <code style={{ color: 'var(--text-secondary)' }}>localhost:8001</code>.
        <br />
        Start it with <code style={{ color: 'var(--text-secondary)' }}>uvicorn app.main:app --port 8001</code> from your backend folder.
      </div>
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-pixel)',
        opacity: 0.7,
        maxWidth: '520px',
        wordBreak: 'break-all'
      }}>
        {message}
      </div>
      <button onClick={onRetry} style={{
        marginTop: '8px',
        padding: '10px 20px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '13px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  );
}


/* ------------------------- PRODUCT (DETAIL) PAGE ------------------------- */

function ProductPage({
  project,
  onBack,
  onInstall,
  installedEntry,
  onLaunch,
}: {
  project: Repository;
  onBack: () => void;
  onInstall: (repo: Repository, detail: RepoDetail | null) => void;
  installedEntry?: InstalledEntry | null;
  onLaunch?: (entry: InstalledEntry) => void;
}) {
  // Seed from cache synchronously if we have it — this makes cache-hit navigations
  // instant (no loading state flash) even before the useEffect fires.
  const cachedSeed = project.repo ? getCachedDetail(project.repo) : null;
  const [detail, setDetail] = useState<RepoDetail | null>(cachedSeed);
  const [detailLoading, setDetailLoading] = useState<boolean>(!!project.repo && !cachedSeed);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = async () => {
    if (!project.repo) {
      setDetailLoading(false);
      return;
    }
    // Cache hit: render immediately, no network call, no loading state.
    const cached = getCachedDetail(project.repo);
    if (cached) {
      setDetail(cached);
      setDetailLoading(false);
      setDetailError(null);
      preloadImages(cached.images);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await fetchRepoDetail(project.repo);
      setDetail(d);
      setCachedDetail(project.repo, d);
      preloadImages(d.images);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [project.repo]);

  const summary = detail?.summary ?? null;
  const description = summary?.description || project.desc;
  const tagline = summary?.tagline || '';
  const githubUrl = detail?.github_url ?? (project.repo ? `https://github.com/${project.repo}` : null);
  const images = detail?.images ?? [];

  return (
    <div style={{ padding: '24px 40px 64px', maxWidth: '960px', margin: '0 auto' }}>
      {/* Back button */}
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text-secondary)',
          padding: '8px 14px 8px 10px',
          borderRadius: '6px',
          fontFamily: 'var(--font-pixel)',
          fontSize: '13px',
          cursor: 'pointer',
          marginBottom: '24px',
          transition: 'all 120ms ease-out'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.borderColor = 'var(--border-active)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.borderColor = 'var(--border)';
        }}
      >
        <ChevronLeft size={16} />
        Back
      </button>

      {/* Title block — name + repo slug subheading */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '6px' }}>
          {project.name}
        </h1>
        {project.repo && (
          <div style={{ fontSize: '14px', color: 'var(--text-muted)', fontFamily: 'var(--font-pixel)' }}>
            {project.repo}
          </div>
        )}
      </div>

      {/* Carousel (accent styled) */}
      <ImageCarousel images={images} fallbackName={project.name} loading={detailLoading} accent />

      {/* Tagline + description */}
      <div style={{ marginTop: '28px', maxWidth: '760px' }}>
        {tagline && (
          <div style={{
            fontSize: '17px',
            fontStyle: 'italic',
            color: 'var(--accent)',
            marginBottom: '14px',
            lineHeight: 1.5
          }}>
            {tagline}
          </div>
        )}
        <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {description}
        </p>
      </div>

      {/* Action buttons — Install (accent) + View on GitHub (ghost) + difficulty badge */}
      <div style={{ display: 'flex', gap: '12px', marginTop: '28px', alignItems: 'center', flexWrap: 'wrap' }}>
        {installedEntry && onLaunch ? (
          <button
            onClick={() => onLaunch(installedEntry)}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
              color: 'var(--on-accent)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer',
              boxShadow: '0 0 0 1px var(--accent), 0 6px 20px var(--accent-glow)'
            }}>
            <Play size={14} fill="currentColor" />
            Launch
          </button>
        ) : (
          <button
            onClick={() => onInstall(project, detail)}
            disabled={!project.repo}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
              color: 'var(--on-accent)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: project.repo ? 'pointer' : 'not-allowed',
              opacity: project.repo ? 1 : 0.45,
              boxShadow: '0 0 0 1px var(--accent), 0 6px 20px var(--accent-glow)'
            }}>
            <Download size={14} />
            Install
          </button>
        )}

        {githubUrl && (
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '12px 18px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '14px',
              textDecoration: 'none',
              cursor: 'pointer'
            }}>
            View on GitHub
            <ExternalLink size={12} style={{ opacity: 0.6 }} />
          </a>
        )}

        {summary && (
          <div style={{ marginLeft: 'auto' }}>
            <DifficultyBadge level={summary.install_difficulty} />
          </div>
        )}
      </div>

      {/* Inline detail error state (backend unreachable for this repo) */}
      {detailError && (
        <div style={{
          marginTop: '32px',
          padding: '20px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          gap: '16px'
        }}>
          <AlertTriangle size={20} color="var(--error)" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>
              Couldn't load details from the backend
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-pixel)' }}>
              {detailError}
            </div>
          </div>
          <button onClick={loadDetail} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            cursor: 'pointer',
            flexShrink: 0
          }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {/* Categories */}
      {summary && summary.categories.length > 0 && (
        <SummarySection title="Categories">
          <ChipRow items={summary.categories} />
        </SummarySection>
      )}

      {/* Features */}
      {summary && summary.features.length > 0 && (
        <SummarySection title="Features">
          <BulletList items={summary.features} />
        </SummarySection>
      )}

      {/* Requirements */}
      {summary && summary.requirements.length > 0 && (
        <SummarySection title="Requirements">
          <BulletList items={summary.requirements} />
        </SummarySection>
      )}

      {/* Details table */}
      <div style={{
        marginTop: '48px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        paddingBottom: '8px',
        borderBottom: '1px solid var(--border)'
      }}>
        Details
      </div>
      <DetailRow label="Repository" value={project.repo ?? '—'} />
      <DetailRow label="Language" value={project.language} />
      <DetailRow label="Stars" value={project.stars} />
      {summary && <DetailRow label="Categories" value={summary.categories.join(', ') || '—'} />}
      {summary && <DetailRow label="Install difficulty" value={summary.install_difficulty} />}
    </div>
  );
}

function DifficultyBadge({ level }: { level: 'easy' | 'medium' | 'hard' }) {
  const color =
    level === 'easy' ? 'var(--running)' :
    level === 'medium' ? 'var(--building)' :
    'var(--error)';
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px', borderRadius: '4px',
      border: `1px solid ${color}`,
      color,
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em'
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        backgroundColor: color
      }} />
      {level}
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: '40px' }}>
      <div style={{
        fontSize: '11px',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        paddingBottom: '10px',
        borderBottom: '1px solid var(--border)',
        marginBottom: '14px'
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {items.map((item, i) => (
        <li key={i} style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          paddingLeft: '18px',
          position: 'relative'
        }}>
          <span style={{
            position: 'absolute',
            left: 0,
            top: '9px',
            width: '4px',
            height: '4px',
            borderRadius: '50%',
            backgroundColor: 'var(--accent-dim)'
          }} />
          {item}
        </li>
      ))}
    </ul>
  );
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
      {items.map((item, i) => (
        <div key={i} style={{
          fontSize: '11px',
          color: 'var(--text-secondary)',
          padding: '5px 10px',
          borderRadius: '4px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface)',
          letterSpacing: '0.03em'
        }}>
          {item}
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: '24px',
      padding: '14px 0',
      borderBottom: '1px solid var(--border)',
      fontSize: '13px'
    }}>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word', maxWidth: '60%' }}>{value}</div>
    </div>
  );
}


/* ------------------------- INSTALL MODAL ------------------------- */

const FALLBACK_STEPS: InstallStep[] = [
  { id: 'prepare',  label: 'Preparing',  status: 'active' },
  { id: 'analyze',  label: 'Analyzing',  status: 'pending' },
  { id: 'install',  label: 'Installing', status: 'pending' },
  { id: 'test',     label: 'Testing',    status: 'pending' },
  { id: 'finalize', label: 'Finalizing', status: 'pending' },
];

function InstallStepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'done':
      return <Check size={14} color="var(--accent)" />;
    case 'active':
      return (
        <span className="spinner" style={{ display: 'inline-flex' }}>
          <RefreshCw size={14} color="var(--accent)" />
        </span>
      );
    case 'failed':
      return <X size={14} color="var(--error)" />;
    case 'pending':
    default:
      return (
        <div style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: 'var(--text-muted)',
          margin: '3px'
        }} />
      );
  }
}

function InstallModal({
  install,
  onClose,
  onRetry,
  onDismiss,
  onCancel,
}: {
  install: ActiveInstall;
  onClose: () => void;         // hide modal, keep install running in the background
  onRetry: () => void;         // start over with a fresh install_id
  onDismiss: () => void;       // remove from activeInstalls entirely (terminal states only)
  onCancel: () => void;        // POST /api/v1/install/{id}/cancel, stay on modal
}) {
  const { repo: project, progress, kickoffError, pollError, startedAt, cancelling } = install;
  const isTerminal = progress?.overall_status === 'success' || progress?.overall_status === 'failure' || progress?.overall_status === 'cancelled' || !!kickoffError;

  // Force a re-render every second so the elapsed timer ticks up smoothly.
  // Stops once the install reaches a terminal state.
  const [, tick] = useState(0);
  useEffect(() => {
    if (isTerminal) return;
    const id = window.setInterval(() => tick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [isTerminal]);

  // ESC to close — always allowed, even while running. Install keeps going in the background.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const stepsToRender: InstallStep[] = progress?.steps ?? FALLBACK_STEPS;
  // While running, always use the local clock so the timer ticks every second.
  // On terminal state, lock to the backend's final duration_ms for accuracy.
  const elapsedMs = isTerminal
    ? (progress?.duration_ms ?? (Date.now() - startedAt))
    : (Date.now() - startedAt);
  const elapsedLabel = formatElapsed(elapsedMs);

  let title = `Installing ${project.repo ?? project.name}`;
  if (progress?.overall_status === 'success') title = 'Installed';
  else if (progress?.overall_status === 'cancelled') title = 'Install cancelled';
  else if (progress?.overall_status === 'failure') title = 'Install failed';
  else if (kickoffError) title = 'Install failed';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        top: '32px',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        zIndex: 100
      }}>
      <div className="fade-in" style={{
        width: '100%',
        maxWidth: '520px',
        maxHeight: 'calc(100vh - 128px)',
        overflowY: 'auto',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '28px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px', gap: '16px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{
              fontSize: '18px',
              fontWeight: 500,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {title}
            </h2>
            {project.repo && (
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {project.repo}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            title="Close (install keeps running in the background)"
            style={{
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              flexShrink: 0,
              padding: 0
            }}>
            <X size={14} />
          </button>
        </div>

        {/* Status sub-line */}
        <div style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '20px',
          marginTop: '10px'
        }}>
          {cancelling
            ? 'Cancelling…'
            : kickoffError
              ? 'Kickoff failed'
              : progress
                ? progress.overall_status
                : 'starting…'}
          {' · '}
          <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{elapsedLabel} elapsed</span>
          {pollError && !isTerminal && (
            <>
              {' · '}
              <span style={{ color: 'var(--error)' }}>reconnecting…</span>
            </>
          )}
        </div>

        {/* Hint: closing doesn't cancel */}
        {!isTerminal && !kickoffError && !cancelling && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '18px',
            lineHeight: 1.5
          }}>
            You can close this window — the install will keep running in the background.
            Reopen it from the <span style={{ color: 'var(--text-secondary)' }}>Installed</span> tab.
          </div>
        )}

        {/* Cancelling notice */}
        {cancelling && !isTerminal && (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            padding: '8px 12px',
            marginBottom: '18px',
            lineHeight: 1.5
          }}>
            Cancel request sent. Waiting for the runner to shut down — this may take a few seconds while the current step completes.
          </div>
        )}

        {/* Step list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          {stepsToRender.map(step => {
            const color =
              step.status === 'done'   ? 'var(--text-primary)' :
              step.status === 'active' ? 'var(--accent)' :
              step.status === 'failed' ? 'var(--error)' :
              'var(--text-muted)';
            return (
              <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <InstallStepIcon status={step.status} />
                </div>
                <div style={{ fontSize: '14px', color, fontFamily: 'var(--font-pixel)' }}>
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Cancel button — visible while the install is running and not already cancelling. */}
        {!isTerminal && !kickoffError && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '18px',
            paddingTop: '18px',
            borderTop: '1px solid var(--border)'
          }}>
            <button
              onClick={onCancel}
              disabled={cancelling || !install.install_id}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 18px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: cancelling ? 'var(--text-muted)' : 'var(--error)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '13px',
                cursor: cancelling || !install.install_id ? 'not-allowed' : 'pointer',
                opacity: cancelling || !install.install_id ? 0.55 : 1,
                transition: 'all 120ms ease-out'
              }}>
              {cancelling ? (
                <>
                  <span className="spinner" style={{ display: 'inline-flex' }}>
                    <RefreshCw size={12} />
                  </span>
                  Cancelling…
                </>
              ) : (
                <>
                  <X size={12} />
                  Cancel install
                </>
              )}
            </button>
          </div>
        )}

        {/* Kickoff error panel */}
        {kickoffError && (
          <div style={{
            marginTop: '20px',
            paddingTop: '20px',
            borderTop: '1px solid var(--border)'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '14px'
            }}>
              <AlertTriangle size={18} color="var(--error)" style={{ flexShrink: 0 }} />
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                Couldn't start the install
              </div>
            </div>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-pixel)',
              padding: '12px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              marginBottom: '14px',
              wordBreak: 'break-word'
            }}>
              {kickoffError}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <GhostButton onClick={onDismiss}>Close</GhostButton>
              <button onClick={onRetry} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )}

        {/* Success result panel */}
        {progress?.overall_status === 'success' && progress.result && (
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '10px'
            }}>
              Result
            </div>
            {progress.result.summary && (
              <p style={{
                fontSize: '13px',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginBottom: '12px'
              }}>
                {progress.result.summary}
              </p>
            )}
            <DetailRow label="App type"    value={progress.result.app_type} />
            <DetailRow label="Run command" value={progress.result.run_command} />
            <DetailRow label="Entry point" value={progress.result.entry_point} />
            {progress.result.env_vars_used && progress.result.env_vars_used.length > 0 && (
              <DetailRow label="Env vars" value={progress.result.env_vars_used.join(', ')} />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '18px' }}>
              <button onClick={onDismiss} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 22px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Failure panel */}
        {progress?.overall_status === 'failure' && progress.error && (
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '10px'
            }}>
              Error
            </div>
            <DetailRow label="Reason" value={progress.error.reason} />
            <DetailRow
              label="Failed at phase"
              value={progress.error.phase_where_failed ?? progress.steps?.find(s => s.status === 'failed')?.id ?? '—'}
            />
            {progress.error.last_error && (
              <div style={{
                marginTop: '10px',
                padding: '12px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontFamily: 'var(--font-pixel)',
                fontSize: '11px',
                color: 'var(--text-muted)',
                whiteSpace: 'pre-wrap',
                maxHeight: '140px',
                overflowY: 'auto'
              }}>
                {progress.error.last_error}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <GhostButton onClick={onDismiss}>Close</GhostButton>
              <button onClick={onRetry} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 22px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}>
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          </div>
        )}

        {/* Cancelled state panel */}
        {progress?.overall_status === 'cancelled' && (
          <div style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '10px'
            }}>
              Cancelled
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '12px' }}>
              The install was cancelled. You can retry anytime from this page, or close to discard it.
            </p>
            <DetailRow
              label="Cancelled at phase"
              value={progress.error?.phase_where_failed ?? progress.current_step_id ?? '—'}
            />
            {progress.error?.reason && (
              <DetailRow label="Reason" value={progress.error.reason} />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px' }}>
              <GhostButton onClick={onDismiss}>Close</GhostButton>
              <button onClick={onRetry} style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 22px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--on-accent)',
                fontFamily: 'var(--font-pixel)',
                fontSize: '13px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}>
                <RefreshCw size={12} /> Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


/* ------------------------- IMAGE CAROUSEL ------------------------- */

/* ------------------------- RUN ERROR DIALOG ------------------------- */

function RunErrorDialog({
  state,
  onClose,
  onRetry,
}: {
  state: RunErrorState;
  onClose: () => void;
  onRetry: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        top: '32px',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        zIndex: 100
      }}>
      <div className="fade-in" style={{
        width: '100%',
        maxWidth: '600px',
        maxHeight: 'calc(100vh - 128px)',
        overflowY: 'auto',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '28px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>
              {state.status === 'crashed' ? 'Crashed' : 'Exited'}
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{state.installName}</div>
          </div>
          <button onClick={onClose} style={{
            width: '28px', height: '28px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: '6px', border: '1px solid var(--border)',
            backgroundColor: 'transparent', color: 'var(--text-muted)',
            cursor: 'pointer', flexShrink: 0, padding: 0
          }}>
            <X size={14} />
          </button>
        </div>

        {/* Error summary */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '14px',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          marginBottom: '18px'
        }}>
          <AlertTriangle size={18} color="var(--error)" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
            {state.status === 'crashed' ? 'Process exited unexpectedly' : 'Process exited'}
            {state.exitCode !== null && ` with code ${state.exitCode}`}
          </div>
        </div>

        <DetailRow label="Command" value={state.command || '—'} />

        {/* Log tail */}
        <div style={{ marginTop: '18px' }}>
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
            marginBottom: '10px', paddingBottom: '8px', borderBottom: '1px solid var(--border)'
          }}>
            Log tail
          </div>
          <div className="hide-scrollbar" style={{
            padding: '14px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '11px',
            color: 'var(--text-muted)',
            whiteSpace: 'pre-wrap',
            maxHeight: '240px',
            overflowY: 'auto',
            lineHeight: 1.7
          }}>
            {state.logs.length > 0 ? state.logs.join('\n') : '(no output captured)'}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <GhostButton onClick={onClose}>Close</GhostButton>
          <button onClick={onRetry} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 22px',
            borderRadius: '6px',
            border: 'none',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
            color: 'var(--on-accent)',
            fontFamily: 'var(--font-pixel)',
            fontSize: '13px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      </div>
    </div>
  );
}


/* ------------------------- IMAGE CAROUSEL ------------------------- */

function ImageCarousel({ images, fallbackName, loading, accent = false }: { images: string[]; fallbackName: string; loading: boolean; accent?: boolean }) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());

  useEffect(() => { setIndex(0); setFailed(new Set()); }, [images]);

  // Keyboard navigation
  useEffect(() => {
    if (images.length <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setIndex(i => (i + 1) % images.length);
      if (e.key === 'ArrowLeft') setIndex(i => (i - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [images.length]);

  const next = () => setIndex(i => (i + 1) % images.length);
  const prev = () => setIndex(i => (i - 1 + images.length) % images.length);

  const containerStyle: CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '380px',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: 'var(--surface-2)',
    border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
    boxShadow: accent ? '0 0 0 3px var(--accent-glow)' : 'none'
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-muted)', fontSize: '13px', letterSpacing: '0.1em', textTransform: 'uppercase'
        }}>
          Fetching README…
        </div>
      </div>
    );
  }

  if (images.length === 0 || failed.size === images.length) {
    return (
      <div style={containerStyle}>
        <FallbackBanner name={fallbackName} />
      </div>
    );
  }

  const current = images[index];
  const isCurrentFailed = failed.has(index);

  return (
    <div style={containerStyle}>
      {isCurrentFailed ? (
        <FallbackBanner name={fallbackName} />
      ) : (
        <img
          src={current}
          alt=""
          onError={() => setFailed(prev => new Set(prev).add(index))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            backgroundColor: 'var(--surface-2)'
          }}
        />
      )}

      {images.length > 1 && (
        <>
          <CarouselButton side="left" onClick={prev}><ChevronLeft size={20} /></CarouselButton>
          <CarouselButton side="right" onClick={next}><ChevronRight size={20} /></CarouselButton>

          {/* Dots */}
          <div style={{
            position: 'absolute',
            bottom: '14px',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '20px',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)'
          }}>
            {images.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Go to image ${i + 1}`}
                style={{
                  width: i === index ? '18px' : '6px',
                  height: '6px',
                  borderRadius: '3px',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  backgroundColor: i === index ? 'var(--accent)' : 'var(--border-active)',
                  transition: 'all 200ms ease-out'
                }}
              />
            ))}
          </div>

          {/* Image counter */}
          <div style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            fontSize: '11px',
            color: 'var(--text-secondary)',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            padding: '4px 10px',
            borderRadius: '4px',
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '0.05em'
          }}>
            {index + 1} / {images.length}
          </div>
        </>
      )}
    </div>
  );
}

function CarouselButton({ side, onClick, children }: { side: 'left' | 'right'; onClick: () => void; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        top: '50%',
        [side]: '14px',
        transform: 'translateY(-50%)',
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        border: '1px solid var(--border)',
        backgroundColor: hover ? 'var(--card-hover)' : 'var(--surface)',
        color: 'var(--text-primary)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 120ms ease-out',
        zIndex: 2
      } as CSSProperties}>
      {children}
    </button>
  );
}


/* ------------------------- INSTALLED PAGE ------------------------- */

function InstalledPage({
  activeInstalls,
  onOpenInstall,
  activeRuns,
  onRun,
  onStop,
  onSelectRepo,
}: {
  activeInstalls: Record<string, ActiveInstall>;
  onOpenInstall: (key: string) => void;
  activeRuns: Record<string, RunEntry>;
  onRun: (entry: InstalledEntry) => void;
  onStop: (installId: string) => void;
  onSelectRepo: (repo: Repository) => void;
}) {
  const [entries, setEntries] = useState<InstalledEntry[]>(() => getInstalls());

  useEffect(() => {
    const onChange = () => setEntries(getInstalls());
    window.addEventListener('shirim-installs-changed', onChange);
    return () => window.removeEventListener('shirim-installs-changed', onChange);
  }, []);

  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const handleUninstall = async (entry: InstalledEntry) => {
    // Show spinner immediately
    setDeleting(prev => new Set(prev).add(entry.owner_repo));
    try {
      // Wipe the disk directory via the backend
      await deleteInstall(entry.install_id);
    } catch {
      // Best-effort — still remove from the local list even if the backend call fails
      // (e.g. directory was already deleted manually)
    }
    // Remove from localStorage + update the UI list
    removeInstall(entry.owner_repo);
    setDeleting(prev => {
      const next = new Set(prev);
      next.delete(entry.owner_repo);
      return next;
    });
  };

  const totalCount = entries.length;
  const inProgressList = Object.entries(activeInstalls)
    .map(([key, install]) => ({ key, install }))
    .sort((a, b) => b.install.startedAt - a.install.startedAt);
  const hasInProgress = inProgressList.length > 0;
  const hasAnyRows = hasInProgress || entries.length > 0;

  const GRID_COLS = '1fr 100px 120px 140px';

  return (
    <div style={{ padding: '32px 40px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Installed
        </h1>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{totalCount} {totalCount === 1 ? 'repository' : 'repositories'}</span>
        </div>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '32px' }}>
        Repositories cloned and built locally. Launch, update or remove them from here.
      </p>

      {!hasAnyRows ? (
        <div style={{
          padding: '80px 20px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          border: '1px dashed var(--border)',
          borderRadius: '10px',
          backgroundColor: 'var(--surface)'
        }}>
          <Download size={28} color="var(--text-muted)" />
          <div style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
            Nothing installed yet
          </div>
          <div style={{ fontSize: '13px' }}>
            Click <span style={{ color: 'var(--text-primary)' }}>Install</span> on any repo to see it here.
          </div>
        </div>
      ) : (
        <>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            gap: '16px',
            padding: '10px 16px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            borderBottom: '1px solid var(--border)'
          }}>
            <div>Repository</div>
            <div>Size</div>
            <div>Installed</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {/* In-progress installs — rendered as table rows at the top */}
          {inProgressList.map(({ key, install }) => (
            <InProgressTableRow
              key={key}
              install={install}
              gridCols={GRID_COLS}
              onClick={() => onOpenInstall(key)}
            />
          ))}

          {/* Completed installs */}
          {entries.map(entry => (
            <InstalledRow
              key={entry.owner_repo}
              entry={entry}
              gridCols={GRID_COLS}
              onUninstall={() => handleUninstall(entry)}
              isDeleting={deleting.has(entry.owner_repo)}
              runEntry={activeRuns[entry.install_id]}
              onRun={() => onRun(entry)}
              onStop={() => onStop(entry.install_id)}
              onSelect={() => onSelectRepo({
                id: 0,
                name: entry.name,
                repo: entry.owner_repo,
                desc: entry.desc,
                language: entry.language,
                stars: entry.stars,
                summary: null,
              })}
            />
          ))}
        </>
      )}
    </div>
  );
}

function InProgressTableRow({
  install,
  gridCols,
  onClick,
}: {
  install: ActiveInstall;
  gridCols: string;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const { repo, progress, kickoffError, cancelling } = install;
  const terminal = isTerminalInstall(install);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (terminal) return;
    const id = window.setInterval(() => forceTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [terminal]);

  // Use local clock while running so the tick forces a live update every second.
  // Lock to backend's duration_ms only on terminal for an accurate final count.
  const elapsedLabel = formatElapsed(
    terminal
      ? (progress?.duration_ms ?? (Date.now() - install.startedAt))
      : (Date.now() - install.startedAt)
  );

  const activeStep =
    kickoffError ? 'Failed to start' :
    cancelling && !terminal ? 'Cancelling…' :
    progress?.steps?.find(s => s.status === 'active')?.label ??
    (progress?.overall_status === 'success' ? 'Completed' :
     progress?.overall_status === 'cancelled' ? 'Cancelled' :
     progress?.overall_status === 'failure' ? 'Failed' :
     'Starting…');

  const isFailed = kickoffError || progress?.overall_status === 'failure';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: '16px',
        padding: '16px',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        backgroundColor: hover ? 'var(--card-hover)' : 'transparent',
        transition: 'background-color 160ms ease-out',
        cursor: 'pointer'
      }}>
      {/* Repo cell — 44px icon container matches InstalledRow's thumbnail width */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <div style={{
          width: '44px', height: '44px', flexShrink: 0,
          borderRadius: '6px',
          border: '1px solid var(--border)',
          backgroundColor: 'var(--surface-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {terminal ? (
            isFailed ? <X size={16} color="var(--error)" /> : <Check size={16} color="var(--accent)" />
          ) : (
            <span className="spinner" style={{ display: 'inline-flex' }}>
              <RefreshCw size={16} color="var(--accent)" />
            </span>
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{repo.name}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{repo.repo}</div>
          </div>
          <div style={{
            fontSize: '12px',
            color: isFailed ? 'var(--error)' : 'var(--text-muted)'
          }}>
            {activeStep}
          </div>
        </div>
      </div>

      {/* Size */}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</div>

      {/* Installed / Elapsed */}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        Started {elapsedLabel} ago
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{
          fontSize: '11px',
          color: hover ? 'var(--accent)' : 'var(--text-muted)',
          textDecoration: hover ? 'underline' : 'none',
          textUnderlineOffset: '3px',
          transition: 'color 120ms ease-out',
          cursor: 'pointer'
        }}>
          view progress
        </div>
      </div>
    </div>
  );
}

function InstalledRow({
  entry,
  gridCols,
  onUninstall,
  isDeleting,
  runEntry,
  onRun,
  onStop,
  onSelect,
}: {
  entry: InstalledEntry;
  gridCols: string;
  onUninstall: () => void;
  isDeleting: boolean;
  runEntry?: RunEntry;
  onRun: () => void;
  onStop: () => void;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [diskSize, setDiskSize] = useState<string | null>(() => getCachedSize(entry.install_id));
  const firstLetter = entry.name.charAt(0).toUpperCase();
  const runStatus = runEntry?.run.status;
  const isStarting = runStatus === 'starting';
  const isRunning = runStatus === 'running';

  useEffect(() => {
    computeInstallSize(entry.install_id).then(s => setDiskSize(s));
  }, [entry.install_id]);

  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gap: '16px',
        padding: '16px',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        backgroundColor: hover ? 'var(--card-hover)' : 'transparent',
        transition: 'background-color 160ms ease-out',
        cursor: 'pointer'
      }}
    >
      {/* Repo cell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        {entry.image_url ? (
          <div style={{
            width: '44px', height: '44px', flexShrink: 0,
            borderRadius: '6px',
            backgroundImage: `url(${entry.image_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            border: '1px solid var(--border)'
          }} />
        ) : (
          <div style={{
            width: '44px', height: '44px', flexShrink: 0,
            borderRadius: '6px',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface-2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontFamily: 'var(--font-pixel)',
            color: 'var(--text-secondary)',
            fontWeight: 500
          }}>
            {firstLetter}
          </div>
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{entry.name}</div>
            {entry.language && (
              <div style={{
                fontSize: '10px', color: 'var(--text-secondary)',
                padding: '2px 6px', borderRadius: '3px',
                backgroundColor: 'var(--surface)',
                textTransform: 'uppercase', letterSpacing: '0.05em'
              }}>
                {entry.language}
              </div>
            )}
          </div>
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {entry.desc}
          </div>
        </div>
      </div>

      {/* Size — computed from ~/.shirim/installs/{id}/ via du -sh */}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {diskSize ?? '—'}
      </div>

      {/* Installed */}
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        {formatRelative(entry.installed_at)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
        {isDeleting ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span className="spinner" style={{ display: 'inline-flex' }}>
              <RefreshCw size={12} />
            </span>
            deleting…
          </div>
        ) : hover ? (
          <>
            {isStarting ? (
              <IconButton title="Starting…">
                <span className="spinner" style={{ display: 'inline-flex' }}>
                  <RefreshCw size={13} />
                </span>
              </IconButton>
            ) : isRunning ? (
              <IconButton title="Stop" onClick={onStop}>
                <Square size={13} />
              </IconButton>
            ) : (
              <IconButton title="Run" onClick={onRun}>
                <Play size={13} />
              </IconButton>
            )}
            <IconButton title="Update"><RefreshCw size={13} /></IconButton>
            <IconButton title="Uninstall" onClick={onUninstall}>
              <Trash2 size={13} />
            </IconButton>
          </>
        ) : (
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            letterSpacing: '0.03em'
          }}>
            see actions
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ children, title, onClick }: { children: ReactNode; title: string; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      style={{
        width: '28px', height: '28px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)',
        borderRadius: '5px',
        backgroundColor: hover ? 'var(--surface)' : 'transparent',
        color: hover ? 'var(--text-primary)' : 'var(--text-secondary)',
        cursor: 'pointer',
        transition: 'all 120ms ease-out'
      }}>
      {children}
    </button>
  );
}


/* ------------------------- SETTINGS PAGE ------------------------- */

/* ------------------------- API KEYS SECTION (SETTINGS) ------------------------- */

function ApiKeysSection() {
  const [secrets, setSecrets] = useState<SecretEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [valueFocused, setValueFocused] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await listSecrets();
      setSecrets(r.secrets);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load secrets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!newName.trim() || !newValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await addSecret(newName.trim().toUpperCase(), newValue.trim());
      setNewName('');
      setNewValue('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (name: string) => {
    setError(null);
    try {
      await deleteSecret(name);
      setSecrets(prev => prev.filter(s => s.name !== name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const handleCopy = async (name: string) => {
    try {
      const r = await revealSecret(name);
      await navigator.clipboard.writeText(r.value);
    } catch {
      // fallback: ignore if clipboard fails
    }
  };

  return (
    <>
      <SectionHeader>API Keys</SectionHeader>
      <p style={{
        fontSize: '12px',
        color: 'var(--text-muted)',
        lineHeight: 1.5,
        marginBottom: '18px'
      }}>
        Keys are injected as environment variables when you install or run apps.
        Stored locally in <code style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-pixel)' }}>~/.shirim/secrets.json</code> (chmod 600).
      </p>

      {error && (
        <div style={{
          fontSize: '12px',
          color: 'var(--error)',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          padding: '10px 14px',
          marginBottom: '14px'
        }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '14px 0',
          fontSize: '12px', color: 'var(--text-muted)'
        }}>
          <span className="spinner" style={{ display: 'inline-flex' }}>
            <RefreshCw size={13} />
          </span>
          Loading keys…
        </div>
      )}

      {/* Existing keys */}
      {!loading && secrets.length > 0 && (
        <div style={{ marginBottom: '18px' }}>
          {secrets.map(s => (
            <ApiKeyRow
              key={s.name}
              secret={s}
              onDelete={() => handleDelete(s.name)}
              onCopy={() => handleCopy(s.name)}
            />
          ))}
        </div>
      )}

      {!loading && secrets.length === 0 && !error && (
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          padding: '14px 0',
          marginBottom: '12px'
        }}>
          No API keys configured yet.
        </div>
      )}

      {/* Add new key form */}
      <div style={{
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-end',
        flexWrap: 'wrap'
      }}>
        <div style={{ flex: '1 1 160px', minWidth: '140px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}>
            Key name
          </div>
          <input
            placeholder="OPENAI_API_KEY"
            value={newName}
            onChange={(e) => setNewName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            style={{
              width: '100%',
              backgroundColor: 'var(--surface-2)',
              border: `1px solid ${nameFocused ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '6px',
              padding: '10px 12px',
              fontFamily: 'var(--font-pixel)',
              fontSize: '12px',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 120ms ease-out',
              letterSpacing: '0.05em'
            }}
          />
        </div>
        <div style={{ flex: '2 1 220px', minWidth: '180px' }}>
          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            marginBottom: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.06em'
          }}>
            Value
          </div>
          <input
            placeholder="sk-proj-..."
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onFocus={() => setValueFocused(true)}
            onBlur={() => setValueFocused(false)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            style={{
              width: '100%',
              backgroundColor: 'var(--surface-2)',
              border: `1px solid ${valueFocused ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: '6px',
              padding: '10px 12px',
              fontFamily: 'var(--font-pixel)',
              fontSize: '12px',
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 120ms ease-out'
            }}
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!newName.trim() || !newValue.trim() || saving}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 18px',
            borderRadius: '6px',
            border: 'none',
            background: !newName.trim() || !newValue.trim() || saving
              ? 'var(--surface-2)'
              : 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
            color: !newName.trim() || !newValue.trim() || saving
              ? 'var(--text-muted)'
              : 'var(--on-accent)',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            fontWeight: 'bold',
            cursor: !newName.trim() || !newValue.trim() || saving ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            whiteSpace: 'nowrap'
          }}>
          {saving ? (
            <>
              <span className="spinner" style={{ display: 'inline-flex' }}>
                <RefreshCw size={12} />
              </span>
              Saving…
            </>
          ) : (
            '+ Add key'
          )}
        </button>
      </div>

      {/* Bottom border to separate from the next section */}
      <div style={{ borderBottom: '1px solid var(--border)', marginTop: '18px' }} />
    </>
  );
}

function ApiKeyRow({
  secret,
  onDelete,
  onCopy,
}: {
  secret: SecretEntry;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        padding: '12px 0',
        borderBottom: '1px solid var(--border)'
      }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: '13px',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-pixel)',
          letterSpacing: '0.04em',
          marginBottom: '3px'
        }}>
          {secret.name}
        </div>
        <div style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-pixel)',
          letterSpacing: '0.08em'
        }}>
          {secret.masked_value}
        </div>
      </div>

      {hover && (
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <IconButton title="Copy value" onClick={onCopy}>
            <ExternalLink size={12} />
          </IconButton>
          <IconButton title="Remove" onClick={onDelete}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      )}
    </div>
  );
}


function SettingsPage({ theme, setTheme }: { theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }) {
  const [autoInstall, setAutoInstall] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [telemetry, setTelemetry] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(true);

  const handleSignOut = async () => {
    await signOut();
    window.dispatchEvent(new CustomEvent('shirim-auth-expired'));
  };

  return (
    <div style={{ padding: '32px 40px 64px', maxWidth: '760px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em', marginBottom: '8px' }}>
        Settings
      </h1>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '40px' }}>
        Configure how Shirim runs and manages your repositories.
      </p>

      <SectionHeader>Account</SectionHeader>
      <SettingRow
        label={getUser()?.name || 'Signed in'}
        description={getUser()?.email ?? 'unknown'}>
        <GhostButton onClick={handleSignOut}>Sign out</GhostButton>
      </SettingRow>

      <ApiKeysSection />

      <SectionHeader>Appearance</SectionHeader>
      <SettingRow label="Theme" description="Switch between a warm dark mode and a light paper-style theme.">
        <SegmentedControl
          value={theme}
          onChange={(v) => setTheme(v as 'dark' | 'light')}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </SettingRow>
      <SettingRow label="Font" description="Monospace font used throughout the app and terminal.">
        <SelectStub value="Geist Mono" />
      </SettingRow>
      <SettingRow label="Interface density" description="Spacing between elements.">
        <SelectStub value="Comfortable" />
      </SettingRow>

      <SectionHeader>Runtime</SectionHeader>
      <SettingRow label="Auto-install dependencies" description="Run npm / pip / cargo install on first launch.">
        <Toggle enabled={autoInstall} onChange={setAutoInstall} />
      </SettingRow>
      <SettingRow label="Default shell" description="Shell used to execute build and start commands.">
        <SelectStub value="zsh" />
      </SettingRow>
      <SettingRow label="Node version" description="Managed via nvm.">
        <SelectStub value="v20.11.0" />
      </SettingRow>
      <SettingRow label="Python version" description="Managed via pyenv.">
        <SelectStub value="3.12.1" />
      </SettingRow>

      <SectionHeader>Storage</SectionHeader>
      <SettingRow label="Install directory" description="~/shirim/repos">
        <GhostButton icon={<FolderOpen size={13} />}>Change</GhostButton>
      </SettingRow>
      <SettingRow label="Build cache" description="Currently using 2.4 GB across 14 repositories.">
        <GhostButton icon={<Trash2 size={13} />}>Clear cache</GhostButton>
      </SettingRow>

      <SectionHeader>Notifications</SectionHeader>
      <SettingRow label="Build notifications" description="System notification when a build finishes or fails.">
        <Toggle enabled={notifications} onChange={setNotifications} />
      </SettingRow>

      <SectionHeader>Updates</SectionHeader>
      <SettingRow label="Auto-update Shirim" description="Install new releases automatically in the background.">
        <Toggle enabled={autoUpdate} onChange={setAutoUpdate} />
      </SettingRow>
      <SettingRow label="Release channel" description="Stable is recommended. Beta includes experimental features.">
        <SelectStub value="Stable" />
      </SettingRow>

      <SectionHeader>Privacy</SectionHeader>
      <SettingRow label="Anonymous telemetry" description="Share crash reports and usage statistics. No code or personal data.">
        <Toggle enabled={telemetry} onChange={setTelemetry} />
      </SettingRow>

      <SystemInfoSection />

      <SectionHeader>About</SectionHeader>
      <SettingRow label="Version" description="Shirim v2.0.0-dev (build 240410)">
        <GhostButton icon={<RefreshCw size={13} />}>Check for updates</GhostButton>
      </SettingRow>
    </div>
  );
}

/* ------------------------- SYSTEM INFO ------------------------- */

type SystemInfo = {
  cpuModel: string;
  cpuCores: number;
  cpuSpeedMhz: number;
  totalMem: number;
  freeMem: number;
  arch: string;
  platform: string;
  release: string;
  hostname: string;
  uptime: number;
  nodeVersion: string;
  electronVersion: string;
  chromeVersion: string;
};

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${mb.toFixed(0)} MB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatPlatform(platform: string, release: string): string {
  const names: Record<string, string> = {
    darwin: 'macOS',
    win32: 'Windows',
    linux: 'Linux',
  };
  return `${names[platform] ?? platform} ${release}`;
}

function loadSystemInfo(): SystemInfo | null {
  try {
    const req = (window as any).require;
    if (!req) return null;
    const os = req('os');
    const cpus = os.cpus() ?? [];
    const proc = (window as any).process;

    return {
      cpuModel: (cpus[0]?.model ?? 'Unknown').trim(),
      cpuCores: cpus.length,
      cpuSpeedMhz: cpus[0]?.speed ?? 0,
      totalMem: os.totalmem(),
      freeMem: os.freemem(),
      arch: os.arch(),
      platform: os.platform(),
      release: os.release(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      nodeVersion: proc?.versions?.node ?? 'Unknown',
      electronVersion: proc?.versions?.electron ?? 'Unknown',
      chromeVersion: proc?.versions?.chrome ?? 'Unknown',
    };
  } catch (e) {
    console.error('Failed to load system info:', e);
    return null;
  }
}

function SystemInfoSection() {
  const [info, setInfo] = useState<SystemInfo | null>(() => loadSystemInfo());

  useEffect(() => {
    // Refresh memory + uptime live every 3s. Static fields (cpu, platform, etc.)
    // don't change but we just re-read the whole thing for simplicity.
    const update = () => setInfo(loadSystemInfo());
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!info) {
    return (
      <>
        <SectionHeader>System</SectionHeader>
        <SettingRow label="Unavailable" description="System information requires the Electron runtime.">
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>—</span>
        </SettingRow>
      </>
    );
  }

  const usedMem = info.totalMem - info.freeMem;
  const usedPct = (usedMem / info.totalMem) * 100;
  const cpuSpeedLabel = info.cpuSpeedMhz > 1000
    ? `${(info.cpuSpeedMhz / 1000).toFixed(2)} GHz`
    : `${info.cpuSpeedMhz} MHz`;

  return (
    <>
      <SectionHeader>System</SectionHeader>

      <SettingRow label="Processor" description={`${info.cpuCores} cores · ${cpuSpeedLabel}`}>
        <ValueText>{info.cpuModel}</ValueText>
      </SettingRow>

      <SettingRow label="Memory" description={`${formatBytes(usedMem)} used of ${formatBytes(info.totalMem)} · ${formatBytes(info.freeMem)} free`}>
        <MemoryBar percent={usedPct} />
      </SettingRow>

      <SettingRow label="Architecture" description="CPU instruction set.">
        <ValueText>{info.arch}</ValueText>
      </SettingRow>

      <SettingRow label="Platform" description="Operating system and kernel release.">
        <ValueText>{formatPlatform(info.platform, info.release)}</ValueText>
      </SettingRow>

      <SettingRow label="Hostname" description="Local network name.">
        <ValueText>{info.hostname}</ValueText>
      </SettingRow>

      <SettingRow label="Uptime" description="Time since the machine was last booted.">
        <ValueText>{formatUptime(info.uptime)}</ValueText>
      </SettingRow>

      <SettingRow label="Node.js" description="JavaScript runtime bundled with Electron.">
        <ValueText>v{info.nodeVersion}</ValueText>
      </SettingRow>

      <SettingRow label="Electron" description="Desktop shell version.">
        <ValueText>v{info.electronVersion}</ValueText>
      </SettingRow>

      <SettingRow label="Chromium" description="Web engine version.">
        <ValueText>{info.chromeVersion}</ValueText>
      </SettingRow>
    </>
  );
}

function ValueText({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontSize: '13px',
      color: 'var(--text-primary)',
      fontVariantNumeric: 'tabular-nums',
      textAlign: 'right',
      maxWidth: '280px',
      display: 'inline-block',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }}>
      {children}
    </span>
  );
}

function MemoryBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '140px',
        height: '6px',
        borderRadius: '3px',
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${clamped}%`,
          height: '100%',
          background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 100%)',
          transition: 'width 400ms ease-out'
        }} />
      </div>
      <span style={{
        fontSize: '12px',
        color: 'var(--text-primary)',
        fontVariantNumeric: 'tabular-nums',
        minWidth: '42px',
        textAlign: 'right'
      }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div style={{
      fontSize: '11px',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      marginTop: '32px',
      marginBottom: '4px',
      paddingBottom: '8px',
      borderBottom: '1px solid var(--border)'
    }}>
      {children}
    </div>
  );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '24px',
      padding: '18px 0',
      borderBottom: '1px solid var(--border)'
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: description ? '4px' : 0 }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {description}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{
        width: '38px',
        height: '22px',
        borderRadius: '22px',
        border: '1px solid var(--border)',
        backgroundColor: enabled ? 'var(--accent)' : 'var(--surface)',
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        transition: 'background-color 180ms ease-out, border-color 180ms ease-out'
      }}>
      <div style={{
        position: 'absolute',
        top: '2px',
        left: enabled ? '18px' : '2px',
        width: '16px',
        height: '16px',
        borderRadius: '50%',
        backgroundColor: enabled ? 'var(--bg)' : 'var(--text-muted)',
        transition: 'left 180ms ease-out, background-color 180ms ease-out'
      }} />
    </button>
  );
}

function SegmentedControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{
      display: 'inline-flex',
      padding: '3px',
      borderRadius: '7px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--surface)'
    }}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '6px 16px',
              borderRadius: '5px',
              border: 'none',
              backgroundColor: active ? 'var(--accent)' : 'transparent',
              color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-pixel)',
              fontSize: '12px',
              cursor: 'pointer',
              transition: 'background-color 160ms ease-out, color 160ms ease-out',
              minWidth: '60px'
            }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectStub({ value }: { value: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px',
        minWidth: '160px',
        justifyContent: 'space-between',
        borderRadius: '6px',
        border: `1px solid ${hover ? 'var(--border-active)' : 'var(--border)'}`,
        backgroundColor: 'var(--surface)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'border-color 120ms ease-out'
      }}>
      <span>{value}</span>
      <ChevronDown size={14} color="var(--text-muted)" />
    </button>
  );
}

function GhostButton({ children, icon, onClick }: { children: ReactNode; icon?: ReactNode; onClick?: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 14px',
        borderRadius: '6px',
        border: `1px solid ${hover ? 'var(--border-active)' : 'var(--border)'}`,
        backgroundColor: hover ? 'var(--surface)' : 'transparent',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-pixel)',
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 120ms ease-out'
      }}>
      {icon}
      {children}
    </button>
  );
}
