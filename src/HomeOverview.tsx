import { useState, useEffect, useMemo } from 'react';
import {
  Sparkles, ArrowRight, Zap, Download, Clock, Flame, Star,
  ChevronRight, GitBranch,
} from 'lucide-react';
import { getUser } from './auth';
import { getInstalls, type InstalledEntry } from './installs';
import { getWorkflows, type Workflow } from './workflows';
import type { Repository } from './api';

/* ------------------------- MODULE STATE ------------------------- */

// Captured once per app session (module load). Resets on page reload, which
// is the right semantics for "since this session started".
const SESSION_START = Date.now();

/* ------------------------- RELATED PROJECT MAPPINGS ------------------------- */

// "Because you installed X, try…" — curated suggestions keyed by owner/repo.
// When the user has an install whose repo matches a key, we surface its values
// as related picks. If none of their installs match, we fall back to featured
// popular picks.
const RELATED_MAP: Record<string, Repository[]> = {
  'ollama/ollama': [
    { id: 7101, name: 'open-webui',   repo: 'open-webui/open-webui',     desc: 'User-friendly AI interface that supports Ollama and OpenAI APIs.', language: 'Svelte',     stars: '51k', summary: null },
    { id: 7102, name: 'lobe-chat',    repo: 'lobehub/lobe-chat',         desc: 'Modern-design ChatGPT/LLMs UI framework with plugin support.',     language: 'TypeScript', stars: '46k', summary: null },
    { id: 7103, name: 'librechat',    repo: 'danny-avila/LibreChat',     desc: 'Enhanced ChatGPT clone with multi-model support and self-hosting.', language: 'TypeScript', stars: '18k', summary: null },
  ],
  'louislam/uptime-kuma': [
    { id: 7201, name: 'netdata',      repo: 'netdata/netdata',           desc: 'Real-time performance monitoring, done right.',                    language: 'C',          stars: '70k', summary: null },
    { id: 7202, name: 'healthchecks', repo: 'healthchecks/healthchecks', desc: 'A cron monitoring tool written in Python & Django.',               language: 'Python',     stars: '8k',  summary: null },
    { id: 7203, name: 'statping-ng',  repo: 'statping-ng/statping-ng',   desc: 'Status page & monitoring server. Self-hosted and modern.',         language: 'Go',         stars: '3.5k', summary: null },
  ],
  'excalidraw/excalidraw': [
    { id: 7301, name: 'penpot',       repo: 'penpot/penpot',             desc: 'Open-source design tool for design and code collaboration.',       language: 'Clojure',    stars: '34k', summary: null },
    { id: 7302, name: 'drawio',       repo: 'jgraph/drawio',             desc: 'Production-grade diagramming that runs entirely in the browser.',  language: 'JavaScript', stars: '42k', summary: null },
    { id: 7303, name: 'tldraw',       repo: 'tldraw/tldraw',             desc: 'A very good whiteboard SDK / infinite canvas.',                    language: 'TypeScript', stars: '36k', summary: null },
  ],
  'logseq/logseq': [
    { id: 7401, name: 'anytype-ts',   repo: 'anyproto/anytype-ts',       desc: 'Offline-first, end-to-end encrypted personal knowledge graph.',    language: 'TypeScript', stars: '5.1k', summary: null },
    { id: 7402, name: 'affine',       repo: 'toeverything/AFFiNE',       desc: 'Next-gen knowledge base with planning, sorting and creation.',     language: 'TypeScript', stars: '38k', summary: null },
    { id: 7403, name: 'appflowy',     repo: 'AppFlowy-IO/AppFlowy',      desc: 'Open-source Notion alternative in Rust and Flutter.',              language: 'Rust',       stars: '55k', summary: null },
  ],
};

/* ------------------------- FEATURED PICK POOL ------------------------- */

// Used for "Pick of the day" and as fallback when no related picks match.
// Intentionally different-shaped from Popular so Home and Discover don't feel
// like duplicates.
const FEATURED_POOL: Array<Repository & { tagline: string; accent: 'yellow' | 'blue' | 'green' }> = [
  { id: 6001, name: 'ollama',         repo: 'ollama/ollama',          desc: 'Run large language models locally. Llama 3, Mistral, Gemma — one command to install.', language: 'Go',         stars: '89k',  summary: null, tagline: 'Your laptop, now a local LLM server',       accent: 'blue' },
  { id: 6002, name: 'uptime-kuma',    repo: 'louislam/uptime-kuma',   desc: 'Self-hosted status monitoring for websites, services, and APIs.',                         language: 'JavaScript', stars: '55k',  summary: null, tagline: 'Know the moment something goes down',      accent: 'yellow' },
  { id: 6003, name: 'excalidraw',     repo: 'excalidraw/excalidraw',  desc: 'Virtual whiteboard for sketching hand-drawn-feeling diagrams.',                           language: 'TypeScript', stars: '82k',  summary: null, tagline: 'Sketch ideas like you\'re on a napkin',    accent: 'green' },
  { id: 6004, name: 'n8n',            repo: 'n8n-io/n8n',             desc: 'Fair-code workflow automation. 400+ integrations, self-hostable, model-agnostic AI.',     language: 'TypeScript', stars: '52k',  summary: null, tagline: 'Zapier, but you own the whole stack',      accent: 'yellow' },
  { id: 6005, name: 'immich',         repo: 'immich-app/immich',      desc: 'High-performance self-hosted photo and video management solution.',                       language: 'TypeScript', stars: '48k',  summary: null, tagline: 'Google Photos, minus the upload anxiety', accent: 'blue' },
  { id: 6006, name: 'supabase',       repo: 'supabase/supabase',      desc: 'Open-source Firebase alternative. Postgres, auth, storage, and realtime.',                 language: 'TypeScript', stars: '79k',  summary: null, tagline: 'Firebase you can actually host yourself',  accent: 'green' },
  { id: 6007, name: 'appsmith',       repo: 'appsmith/appsmith',      desc: 'Low-code platform for building internal apps, admin panels, and dashboards.',             language: 'TypeScript', stars: '36k',  summary: null, tagline: 'Internal tools without the YAML tax',      accent: 'yellow' },
];

/** Deterministic "pick of the day": stable within a 24h window.  */
function pickOfTheDay(): typeof FEATURED_POOL[number] {
  const day = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return FEATURED_POOL[day % FEATURED_POOL.length];
}

/* ------------------------- CHANGELOG / "WHAT'S NEW" ------------------------- */

type ChangelogItem = {
  id: string;
  date: string;              // display label, e.g. "3 days ago"
  tag: 'new' | 'fix' | 'note';
  title: string;
  body: string;
};

const CHANGELOG: ChangelogItem[] = [
  {
    id: 'c1',
    date: '2 days ago',
    tag: 'new',
    title: 'Workflows tab is live',
    body: 'Chain installed apps with triggers and actions. Drag an app onto the canvas and wire up your first automation.',
  },
  {
    id: 'c2',
    date: '4 days ago',
    tag: 'new',
    title: 'Tutorial skill-tree',
    body: 'A node-graph onboarding path. Complete lessons to unlock advanced workflows and earn XP.',
  },
  {
    id: 'c3',
    date: '1 week ago',
    tag: 'fix',
    title: 'Install progress accuracy',
    body: 'Phase timers now report real elapsed time instead of averaged estimates. Cancels propagate immediately.',
  },
  {
    id: 'c4',
    date: '2 weeks ago',
    tag: 'note',
    title: 'Secrets vault (beta)',
    body: 'Store API keys and tokens once, reference them across installed apps and workflows with {{ secrets.name }}.',
  },
];

/* ------------------------- MAIN EXPORT ------------------------- */

export default function HomeOverview({
  onSelectProject,
  onNavDiscover,
}: {
  onSelectProject: (repo: Repository) => void;
  onNavDiscover: () => void;
}) {
  const [installs, setInstalls] = useState<InstalledEntry[]>(() => getInstalls());
  const [workflows, setWorkflows] = useState<Workflow[]>(() => getWorkflows());

  // Keep in sync with local storage changes emitted by other views.
  useEffect(() => {
    const refresh = () => {
      setInstalls(getInstalls());
      setWorkflows(getWorkflows());
    };
    window.addEventListener('shirim-installs-changed', refresh);
    window.addEventListener('shirim-workflows-changed', refresh);
    return () => {
      window.removeEventListener('shirim-installs-changed', refresh);
      window.removeEventListener('shirim-workflows-changed', refresh);
    };
  }, []);

  return (
    <div style={{ padding: '24px 40px 48px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <GreetingBlock />
      <UptimeStats installs={installs} workflows={workflows} />
      <PickOfTheDay onSelect={onSelectProject} />
      <RelatedOrFeatured installs={installs} onSelect={onSelectProject} />
      <WhatsNew />
      <DiscoverFooter onClick={onNavDiscover} />
    </div>
  );
}

/* ------------------------- GREETING ------------------------- */

function GreetingBlock() {
  const user = getUser();
  const firstName = (user?.name || user?.email?.split('@')[0] || '').split(' ')[0];

  // Update the greeting hourly — the copy depends on time of day.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const greeting = timeOfDayGreeting(now);

  return (
    <div className="fade-in" style={{ paddingTop: '8px' }}>
      <h1 style={{
        fontSize: '32px',
        fontWeight: 500,
        color: 'var(--text-primary)',
        letterSpacing: '-0.02em',
        lineHeight: 1.15,
      }}>
        {greeting}
        {firstName && (
          <>, <span style={{ color: 'var(--accent)' }}>{firstName}</span></>
        )}
        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>.</span>
      </h1>
      <p style={{
        fontSize: '14px',
        color: 'var(--text-secondary)',
        marginTop: '6px',
      }}>
        {flavorLine(now)}
      </p>
    </div>
  );
}

function timeOfDayGreeting(d: Date): string {
  const hour = d.getHours();
  if (hour < 5)  return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Burning the midnight oil';
}

function flavorLine(d: Date): string {
  const day = d.getDay();                      // 0 = Sun, 6 = Sat
  const hour = d.getHours();
  if (hour < 5)  return 'The quiet hours are the best for shipping.';
  if (day === 0) return 'Sunday. A good day to try something new.';
  if (day === 6) return 'Weekend hacking is the best kind.';
  if (hour < 12) return 'Ready to ship?';
  if (hour < 17) return 'The afternoon is yours — what will you build?';
  return 'Something to run tonight?';
}

/* ------------------------- UPTIME STATS ------------------------- */

function UptimeStats({
  installs, workflows,
}: {
  installs: InstalledEntry[];
  workflows: Workflow[];
}) {
  const [elapsed, setElapsed] = useState(() => Date.now() - SESSION_START);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Date.now() - SESSION_START), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const enabledWorkflows = workflows.filter(w => w.enabled).length;
  const appCount = installs.length;

  return (
    <div className="fade-in" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      flexWrap: 'wrap',
      padding: '14px 18px',
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '100px',
      fontSize: '13px',
      color: 'var(--text-secondary)',
      fontFamily: 'var(--font-pixel)',
    }}>
      <span className="pulse-dot" style={{
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: 'var(--running)',
        boxShadow: '0 0 8px var(--running)',
        flexShrink: 0,
      }} />
      <span>Shirim is watching</span>
      <StatChip icon={<Download size={12} />} value={appCount} label={appCount === 1 ? 'app' : 'apps'} />
      <span>·</span>
      <StatChip icon={<Zap size={12} />} value={enabledWorkflows} label={enabledWorkflows === 1 ? 'live workflow' : 'live workflows'} />
      <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>
        <Clock size={11} style={{ verticalAlign: '-2px', marginRight: '5px' }} />
        session uptime {formatUptime(elapsed)}
      </span>
    </div>
  );
}

function StatChip({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ color: value > 0 ? 'var(--accent)' : 'var(--text-muted)', display: 'flex' }}>{icon}</span>
      <span style={{
        color: 'var(--text-primary)',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

function formatUptime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60)      return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60)      return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24)       return remMin === 0 ? `${hr}h` : `${hr}h ${remMin}m`;
  const day = Math.floor(hr / 24);
  return `${day}d ${hr % 24}h`;
}

/* ------------------------- PICK OF THE DAY ------------------------- */

function PickOfTheDay({ onSelect }: { onSelect: (repo: Repository) => void }) {
  const pick = useMemo(pickOfTheDay, []);
  const [hovered, setHovered] = useState(false);

  const accentBg = {
    yellow: 'linear-gradient(135deg, rgba(255, 213, 87, 0.22) 0%, rgba(255, 213, 87, 0.04) 60%, transparent 100%)',
    blue:   'linear-gradient(135deg, rgba(107, 157, 255, 0.22) 0%, rgba(107, 157, 255, 0.04) 60%, transparent 100%)',
    green:  'linear-gradient(135deg, rgba(87, 200, 130, 0.22) 0%, rgba(87, 200, 130, 0.04) 60%, transparent 100%)',
  }[pick.accent];

  return (
    <div
      className="fade-in glow-hover"
      onClick={() => onSelect(pick)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: 'var(--surface)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '14px',
        padding: '28px 30px',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* Accent wash */}
      <div style={{
        position: 'absolute', inset: 0,
        background: accentBg, pointerEvents: 'none',
      }} />

      {/* Subtle stripes */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'repeating-linear-gradient(45deg, transparent 0 14px, rgba(255,255,255,0.015) 14px 16px)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px',
            backgroundColor: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: '100px',
            fontSize: '10.5px',
            color: 'var(--text-secondary)',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            fontWeight: 600,
            marginBottom: '14px',
          }}>
            <Flame size={11} style={{ color: 'var(--building)' }} /> Pick of the day
          </div>

          <h2 style={{
            fontSize: '28px', fontWeight: 500,
            letterSpacing: '-0.02em',
            color: 'var(--text-primary)',
            marginBottom: '6px',
            lineHeight: 1.15,
          }}>
            {pick.name}
          </h2>
          <p style={{
            fontSize: '15px', fontStyle: 'italic',
            color: 'var(--text-secondary)',
            marginBottom: '14px',
          }}>
            “{pick.tagline}”
          </p>
          <p style={{
            fontSize: '13px', color: 'var(--text-secondary)',
            lineHeight: 1.55, maxWidth: '620px',
            marginBottom: '18px',
          }}>
            {pick.desc}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <MetaBadge icon={<Star size={11} />}>{pick.stars}</MetaBadge>
            <MetaBadge>{pick.language}</MetaBadge>
            <MetaBadge mono>{pick.repo}</MetaBadge>
          </div>
        </div>
        <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '10px 16px',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
            color: 'var(--on-accent)',
            borderRadius: '10px',
            fontSize: '13px', fontWeight: 600,
            fontFamily: 'var(--font-pixel)',
            letterSpacing: '-0.01em',
            boxShadow: hovered ? '0 6px 16px rgba(0,0,0,0.25)' : '0 3px 8px rgba(0,0,0,0.15)',
            transition: 'box-shadow 160ms ease-out',
          }}>
            View
            <ArrowRight size={14} style={{
              transform: hovered ? 'translateX(3px)' : 'translateX(0)',
              transition: 'transform 160ms ease-out',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ children, icon, mono }: { children: React.ReactNode; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '3px 9px',
      backgroundColor: 'var(--surface-2)',
      border: '1px solid var(--border)',
      borderRadius: '100px',
      fontSize: '11px',
      color: 'var(--text-secondary)',
      fontFamily: mono ? 'var(--font-pixel)' : 'var(--font-pixel)',
      letterSpacing: mono ? '0.01em' : '0.02em',
    }}>
      {icon && <span style={{ color: 'var(--building)' }}>{icon}</span>}
      {children}
    </span>
  );
}

/* ------------------------- RELATED / FEATURED ROW ------------------------- */

function RelatedOrFeatured({
  installs, onSelect,
}: {
  installs: InstalledEntry[];
  onSelect: (repo: Repository) => void;
}) {
  // Walk the user's installs in recency order and return the first one that
  // has a curated related set. This way the "because you installed …" block
  // always references their most recent relevant project.
  const match = installs.find(inst => inst.owner_repo in RELATED_MAP);

  const heading = match
    ? <>Because you installed <span style={{ color: 'var(--accent)' }}>{match.name}</span>, try…</>
    : <>Starting out? These are the crowd favorites.</>;

  const subline = match
    ? 'Projects that pair well with what you already have.'
    : 'Curated picks hand-selected from the Discover tab.';

  const repos = match
    ? RELATED_MAP[match.owner_repo]
    : FEATURED_POOL.slice(0, 3);

  return (
    <div className="fade-in" style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '22px 24px 24px',
    }}>
      <h3 style={{
        fontSize: '17px', fontWeight: 500,
        color: 'var(--text-primary)',
        letterSpacing: '-0.01em',
        marginBottom: '4px',
      }}>
        {heading}
      </h3>
      <p style={{
        fontSize: '12.5px', color: 'var(--text-muted)',
        marginBottom: '18px',
      }}>
        {subline}
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '12px',
      }}>
        {repos.map(repo => (
          <RelatedCard key={repo.id} repo={repo} onSelect={() => onSelect(repo)} />
        ))}
      </div>
    </div>
  );
}

function RelatedCard({ repo, onSelect }: { repo: Repository; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="glow-hover"
      style={{
        cursor: 'pointer',
        backgroundColor: hovered ? 'var(--card-hover)' : 'var(--surface-2)',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '8px',
        padding: '14px 16px',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{
          fontSize: '14px', fontWeight: 600,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {repo.name}
        </span>
        <ChevronRight
          size={14}
          style={{
            color: 'var(--text-muted)',
            transform: hovered ? 'translateX(2px)' : 'translateX(0)',
            transition: 'transform 140ms ease-out',
            flexShrink: 0,
          }}
        />
      </div>
      <p style={{
        fontSize: '11.5px', color: 'var(--text-secondary)',
        lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        overflow: 'hidden', marginBottom: '10px',
        minHeight: '34px',
      }}>
        {repo.desc}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '10.5px', color: 'var(--text-muted)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Star size={10} /> {repo.stars}
        </span>
        <span>·</span>
        <span>{repo.language}</span>
      </div>
    </div>
  );
}

/* ------------------------- WHAT'S NEW ------------------------- */

function WhatsNew() {
  return (
    <div className="fade-in" style={{
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: '12px',
      padding: '22px 24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Sparkles size={14} style={{ color: 'var(--building)' }} />
        <h3 style={{
          fontSize: '17px', fontWeight: 500,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
        }}>
          What's new on Shirim
        </h3>
      </div>

      <div style={{ position: 'relative' }}>
        {/* Timeline rail */}
        <div style={{
          position: 'absolute',
          left: '7px', top: '6px', bottom: '6px',
          width: '1px',
          backgroundColor: 'var(--border)',
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {CHANGELOG.map(item => (
            <ChangelogRow key={item.id} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChangelogRow({ item }: { item: ChangelogItem }) {
  const theme = {
    new:  { color: 'var(--accent)',   label: 'NEW' },
    fix:  { color: 'var(--running)',  label: 'FIX' },
    note: { color: 'var(--building)', label: 'NOTE' },
  }[item.tag];

  return (
    <div style={{ position: 'relative', paddingLeft: '26px' }}>
      {/* Timeline dot */}
      <span style={{
        position: 'absolute', left: '2px', top: '6px',
        width: 11, height: 11, borderRadius: '50%',
        backgroundColor: 'var(--surface)',
        border: `2px solid ${theme.color}`,
        boxShadow: '0 0 0 3px var(--surface)',
      }} />

      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '9.5px', fontWeight: 600,
          letterSpacing: '0.1em',
          color: theme.color,
          padding: '2px 7px',
          border: `1px solid ${theme.color}`,
          borderRadius: '3px',
        }}>
          {theme.label}
        </span>
        <span style={{
          fontSize: '13.5px', fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
        }}>
          {item.title}
        </span>
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)',
          marginLeft: 'auto',
        }}>
          {item.date}
        </span>
      </div>
      <p style={{
        fontSize: '12px',
        color: 'var(--text-secondary)',
        lineHeight: 1.55,
      }}>
        {item.body}
      </p>
    </div>
  );
}

/* ------------------------- DISCOVER FOOTER ------------------------- */

function DiscoverFooter({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        padding: '14px 18px',
        backgroundColor: hovered ? 'var(--surface-2)' : 'transparent',
        border: `1px solid ${hovered ? 'var(--border-active)' : 'var(--border)'}`,
        borderRadius: '10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '16px',
        transition: 'all 160ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{
          width: 32, height: 32, borderRadius: '8px',
          backgroundColor: 'var(--surface-2)',
          border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}>
          <GitBranch size={15} />
        </span>
        <div>
          <div style={{
            fontSize: '14px', fontWeight: 500,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}>
            Discover more
          </div>
          <div style={{
            fontSize: '11.5px', color: 'var(--text-muted)',
            marginTop: '2px',
          }}>
            Find open-source alternatives to paid apps.
          </div>
        </div>
      </div>
      <ArrowRight
        size={16}
        style={{
          color: hovered ? 'var(--accent)' : 'var(--text-muted)',
          transform: hovered ? 'translateX(3px)' : 'translateX(0)',
          transition: 'all 160ms ease-out',
          flexShrink: 0,
        }}
      />
    </div>
  );
}
