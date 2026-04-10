import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Home, Compass, Download, Settings, ChevronLeft, ChevronRight, ChevronDown, Search, Play, Square, RefreshCw, Trash2, FolderOpen, ExternalLink, X, AlertTriangle } from 'lucide-react';
import {
  fetchHome, fetchDiscover, fetchRepoDetail,
  type Repository, type RepoDetail,
} from './api';
import {
  isAuthenticated, setSession, setUser, signOut, sendOtp, verifyOtp, fetchMe, getUser,
} from './auth';
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

const VIEW_CATEGORIES: Record<'Home' | 'Discover' | 'Installed' | 'Settings', string[]> = {
  Home: ['Popular', 'Recently Run'],
  Discover: ['Productivity', 'AI', 'Trending'],
  Installed: [],
  Settings: [],
};

const INSTALLED_REPOS = [
  { id: 1, name: 'next.js', desc: 'The React Framework for the Web', language: 'TypeScript', version: 'v14.2.3', size: '312 MB', lastRun: '2 hours ago', status: 'running' as const },
  { id: 2, name: 'llama.cpp', desc: 'LLM inference in pure C/C++', language: 'C++', version: 'main @ a1b2c3d', size: '892 MB', lastRun: 'Yesterday', status: 'stopped' as const },
  { id: 3, name: 'shadcn-ui', desc: 'Beautifully designed components', language: 'TypeScript', version: 'v0.8.0', size: '84 MB', lastRun: '3 days ago', status: 'stopped' as const },
  { id: 4, name: 'budget-view', desc: 'Minimalistic personal finance dashboard', language: 'Rust', version: 'v1.2.1', size: '156 MB', lastRun: 'Last week', status: 'stopped' as const },
  { id: 5, name: 'react-three-fiber', desc: 'React renderer for Three.js', language: 'TypeScript', version: 'v8.15.0', size: '248 MB', lastRun: '2 weeks ago', status: 'stopped' as const },
  { id: 6, name: 'ollama', desc: 'Get up and running with LLMs locally', language: 'Go', version: 'v0.1.32', size: '1.4 GB', lastRun: '12 hours ago', status: 'running' as const },
];

export default function App() {
  const [activeView, setActiveView] = useState<'Home' | 'Discover' | 'Installed' | 'Settings'>('Home');
  const [selectedProject, setSelectedProject] = useState<Repository | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchHint, setShowSearchHint] = useState(false);
  const [activeSearch, setActiveSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [projectsByCategory, setProjectsByCategory] = useState<Record<string, Repository[]>>({});
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
  const loadProjects = async () => {
    setDataLoading(true);
    setDataError(null);
    try {
      const [home, discover] = await Promise.all([fetchHome(), fetchDiscover()]);
      const merged: Record<string, Repository[]> = {};
      for (const block of [...home.categories, ...discover.categories]) {
        merged[block.name] = block.repos;
      }
      setProjectsByCategory(merged);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setDataLoading(false);
    }
  };

  // Only fetch project data once the user is authenticated — avoids pointless 401s.
  useEffect(() => {
    if (authed) loadProjects();
  }, [authed]);

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

  // Commit the current query → triggers filtering + pagination. Resets to page 0.
  const commitSearch = () => {
    const q = searchQuery.trim();
    if (q.length === 0) {
      setActiveSearch('');
      return;
    }
    setActiveSearch(q);
    setCurrentPage(0);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
    setCurrentPage(0);
  };

  // Derived: filter all projects across all categories by the committed query.
  const PAGE_SIZE = 10;
  const allProjects: Repository[] = Object.values(projectsByCategory).flat();
  const filteredProjects = activeSearch
    ? allProjects.filter(p => {
        const q = activeSearch.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q) ||
          p.language.toLowerCase().includes(q) ||
          (p.repo ? p.repo.toLowerCase().includes(q) : false)
        );
      })
    : [];
  const totalPages = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const pageResults = filteredProjects.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

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
      ) : (
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
          <NavItem icon={<Home size={18} />} label="Home" active={activeView === 'Home'} onClick={() => setActiveView('Home')} />
          <NavItem icon={<Compass size={18} />} label="Discover" active={activeView === 'Discover'} onClick={() => setActiveView('Discover')} />
          <NavItem icon={<Download size={18} />} label="Installed" active={activeView === 'Installed'} onClick={() => setActiveView('Installed')} />
        </div>

        {/* Bottom Nav */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border)', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <NavItem icon={<Settings size={18} />} label="Settings" active={activeView === 'Settings'} onClick={() => setActiveView('Settings')} />
        </div>
      </div>

      {/* 2. MAIN CONTENT AREA */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {selectedProject ? (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ProductPage
              project={selectedProject}
              onBack={() => setSelectedProject(null)}
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
                onChange={(e) => setSearchQuery(e.target.value)}
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

        </div>
        )}

        {/* View Router */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeView === 'Installed' && <InstalledPage />}
          {activeView === 'Settings' && <SettingsPage theme={theme} setTheme={setTheme} />}
          {(activeView === 'Home' || activeView === 'Discover') && dataError && (
            <BackendErrorState message={dataError} onRetry={loadProjects} />
          )}
          {(activeView === 'Home' || activeView === 'Discover') && !dataError && activeSearch && (
            <SearchResults
              query={activeSearch}
              results={pageResults}
              totalCount={filteredProjects.length}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              onSelect={(p) => setSelectedProject(p)}
              onClear={clearSearch}
            />
          )}
          {(activeView === 'Home' || activeView === 'Discover') && !dataError && !activeSearch && (
            <div style={{ padding: '24px 0 40px' }}>
          {VIEW_CATEGORIES[activeView].map(cat => (
            <div key={cat} style={{ marginBottom: '40px' }}>
              <div style={{
                padding: '0 40px',
                marginBottom: '16px',
                color: 'var(--text-muted)',
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em'
              }}>
                {cat}
              </div>

              <div className="hide-scrollbar" style={{
                overflowX: 'auto',
                overflowY: 'hidden',
                containerType: 'inline-size'
              } as CSSProperties}>
                <div style={{
                  display: 'grid',
                  gridTemplateRows: 'repeat(2, 220px)',
                  gridAutoFlow: 'column',
                  gridAutoColumns: 'calc((100cqw - 96px) / 2)',
                  gap: '16px',
                  padding: '0 40px'
                }}>
                  {(projectsByCategory[cat] ?? []).map(proj => (
                    <ProjectCard key={proj.id} project={proj} onClick={() => setSelectedProject(proj)} />
                  ))}
                </div>
              </div>
            </div>
          ))}
            </div>
          )}
        </div>
        </>
        )}

      </div>

      </div>
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


function NavItem({ icon, label, active, onClick }) {
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
        transition: 'all 120ms ease-out'
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
      <span style={{ fontSize: '15px' }}>{label}</span>
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
  query,
  results,
  totalCount,
  currentPage,
  totalPages,
  onPageChange,
  onSelect,
  onClear,
}: {
  query: string;
  results: Repository[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (p: number) => void;
  onSelect: (p: Repository) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ padding: '24px 40px 40px' }}>
      {/* Results header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: '24px',
        paddingBottom: '14px',
        borderBottom: '1px solid var(--border)'
      }}>
        <div>
          <div style={{
            fontSize: '11px', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px'
          }}>
            Search results
          </div>
          <div style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>{totalCount} match{totalCount === 1 ? '' : 'es'} for</span>{' '}
            <span style={{ color: 'var(--accent)' }}>"{query}"</span>
          </div>
        </div>
        <button
          onClick={onClear}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
            padding: '8px 14px',
            borderRadius: '6px',
            fontFamily: 'var(--font-pixel)',
            fontSize: '12px',
            cursor: 'pointer'
          }}>
          <X size={12} />
          Clear
        </button>
      </div>

      {/* Results grid */}
      {results.length === 0 ? (
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
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}>
          {results.map(proj => (
            <div key={proj.id} style={{ height: '220px' }}>
              <ProjectCard project={proj} onClick={() => onSelect(proj)} />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
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


/* ------------------------- BACKEND ERROR STATE ------------------------- */

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

function ProductPage({ project, onBack }: { project: Repository; onBack: () => void }) {
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(!!project.repo);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = async () => {
    if (!project.repo) {
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await fetchRepoDetail(project.repo);
      setDetail(d);
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
        <button
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
          <Download size={14} />
          Install
        </button>

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
      <div style={{ color: 'var(--text-primary)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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

function InstalledPage() {
  const totalCount = INSTALLED_REPOS.length;
  const runningCount = INSTALLED_REPOS.filter(r => r.status === 'running').length;

  return (
    <div style={{ padding: '32px 40px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '8px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 500, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          Installed
        </h1>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{totalCount} repositories</span>
          <span style={{ color: 'var(--border)' }}>·</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--running)' }} />
            {runningCount} running
          </span>
        </div>
      </div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '32px' }}>
        Repositories cloned and built locally. Launch, update or remove them from here.
      </p>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 100px 120px 120px',
        gap: '16px',
        padding: '10px 16px',
        fontSize: '11px',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderBottom: '1px solid var(--border)'
      }}>
        <div>Repository</div>
        <div>Version</div>
        <div>Size</div>
        <div>Last run</div>
        <div style={{ textAlign: 'right' }}>Status</div>
      </div>

      {INSTALLED_REPOS.map(repo => <InstalledRow key={repo.id} repo={repo} />)}
    </div>
  );
}

function InstalledRow({ repo }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 100px 120px 120px',
        gap: '16px',
        padding: '16px',
        alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        backgroundColor: hover ? 'var(--card-hover)' : 'transparent',
        transition: 'background-color 160ms ease-out',
        position: 'relative'
      }}
    >
      {/* Repo cell */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <div style={{
          width: '44px', height: '44px', flexShrink: 0,
          borderRadius: '6px',
          backgroundImage: `url(https://picsum.photos/seed/${encodeURIComponent(repo.name)}/88/88)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          border: '1px solid var(--border)'
        }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{repo.name}</div>
            <div style={{
              fontSize: '10px', color: 'var(--text-secondary)',
              padding: '2px 6px', borderRadius: '3px',
              backgroundColor: 'var(--surface)',
              textTransform: 'uppercase', letterSpacing: '0.05em'
            }}>
              {repo.language}
            </div>
          </div>
          <div style={{
            fontSize: '12px', color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {repo.desc}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{repo.version}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{repo.size}</div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{repo.lastRun}</div>

      {/* Status + hover actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
        {hover ? (
          <>
            <IconButton title={repo.status === 'running' ? 'Stop' : 'Run'}>
              {repo.status === 'running' ? <Square size={13} /> : <Play size={13} />}
            </IconButton>
            <IconButton title="Update"><RefreshCw size={13} /></IconButton>
            <IconButton title="Uninstall"><Trash2 size={13} /></IconButton>
          </>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            fontSize: '11px',
            color: repo.status === 'running' ? 'var(--running)' : 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em'
          }}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              backgroundColor: repo.status === 'running' ? 'var(--running)' : 'var(--idle)'
            }} />
            {repo.status}
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ children, title }: { children: ReactNode; title: string }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => e.stopPropagation()}
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
