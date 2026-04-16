/* ------------------------- WORKFLOWS PERSISTENCE -------------------------
 * UI-only state for the Workflows tab. Stores node-based automations in
 * localStorage under 'shirim-workflows'. Nothing here executes: this module
 * is a pure data layer for the visual workflow builder.
 *
 * A workflow is a small graph of nodes (each node wraps an installed app,
 * or — for demo purposes — a placeholder "app" like uptime-kuma) and edges
 * (data flowing from one node's output port to another's input port).
 */

export type NodeKind = 'trigger' | 'action';

export type WorkflowNode = {
  id: string;
  kind: NodeKind;
  appId: string;                       // matches InstalledEntry.owner_repo, or a placeholder id
  appName: string;                     // display name shown in node header
  appIcon: string | null;              // thumbnail URL (optional)
  title: string;                       // e.g. "Website is down"
  subtitle: string;                    // e.g. "Monitor: shirim.dev"
  config: Record<string, string>;      // placeholder field values surfaced in inspector
  x: number;                           // canvas-space position (px)
  y: number;
};

export type WorkflowEdge = {
  id: string;
  from: string;                        // source node id (output port)
  to: string;                          // target node id (input port)
};

export type Workflow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  last_run_at: number | null;
  last_run_status: 'success' | 'failed' | 'never';
  created_at: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

const KEY = 'shirim-workflows';

function read(): Workflow[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Workflow[]) : [];
  } catch {
    return [];
  }
}

function write(workflows: Workflow[]): void {
  localStorage.setItem(KEY, JSON.stringify(workflows));
  window.dispatchEvent(new CustomEvent('shirim-workflows-changed'));
}

/** Newest-first list of saved workflows. Seeds demo workflows on first run. */
export function getWorkflows(): Workflow[] {
  const existing = read();
  if (existing.length === 0) {
    const seeded = buildSeedWorkflows();
    write(seeded);
    return seeded.sort((a, b) => b.created_at - a.created_at);
  }
  return existing.sort((a, b) => b.created_at - a.created_at);
}

/** Upsert by workflow id. */
export function saveWorkflow(workflow: Workflow): void {
  const existing = read();
  const filtered = existing.filter(w => w.id !== workflow.id);
  filtered.push(workflow);
  write(filtered);
}

export function deleteWorkflow(id: string): void {
  const filtered = read().filter(w => w.id !== id);
  write(filtered);
}

/** Reset to seed set (wipes local edits). Useful if the user nukes their workflows. */
export function reseedWorkflows(): Workflow[] {
  const seeded = buildSeedWorkflows();
  write(seeded);
  return seeded.sort((a, b) => b.created_at - a.created_at);
}

export function createEmptyWorkflow(name: string): Workflow {
  return {
    id: `wf_${Math.random().toString(36).slice(2, 10)}`,
    name,
    description: 'A brand new workflow. Drag apps from the left panel to start building.',
    enabled: false,
    last_run_at: null,
    last_run_status: 'never',
    created_at: Date.now(),
    nodes: [],
    edges: [],
  };
}

export function newNodeId(): string {
  return `node_${Math.random().toString(36).slice(2, 10)}`;
}

export function newEdgeId(): string {
  return `edge_${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------- PLACEHOLDER APP CATALOG -------------------------
 * Curated fallback set used when the user has no real installed apps yet.
 * Split into trigger-capable vs action-capable so the node library can
 * render them under the appropriate group.
 */

export type PlaceholderApp = {
  id: string;
  name: string;
  description: string;
  supportsTrigger: boolean;
  supportsAction: boolean;
  defaultTitle: Record<NodeKind, string>;
  defaultSubtitle: Record<NodeKind, string>;
  defaultConfig: Record<NodeKind, Record<string, string>>;
};

export const PLACEHOLDER_APPS: PlaceholderApp[] = [
  {
    id: 'louislam/uptime-kuma',
    name: 'Uptime Kuma',
    description: 'Self-hosted monitoring tool for websites and services.',
    supportsTrigger: true,
    supportsAction: false,
    defaultTitle: { trigger: 'Website is down', action: 'Create monitor' },
    defaultSubtitle: { trigger: 'Monitor: shirim.dev', action: 'New HTTP(s) monitor' },
    defaultConfig: {
      trigger: {
        'Monitor name': 'shirim.dev',
        'Check interval': '60 seconds',
        'Condition': 'Status code != 200',
      },
      action: {
        'URL': 'https://example.com',
        'Interval': '60 seconds',
      },
    },
  },
  {
    id: 'kootenpv/yagmail',
    name: 'Yagmail',
    description: 'Python wrapper for sending email via Gmail.',
    supportsTrigger: false,
    supportsAction: true,
    defaultTitle: { trigger: 'Email received', action: 'Send email' },
    defaultSubtitle: { trigger: '', action: 'To: you@example.com' },
    defaultConfig: {
      trigger: {},
      action: {
        'To': 'you@example.com',
        'Subject': 'Alert: {{ trigger.title }}',
        'Body': 'Heads up — {{ trigger.subtitle }} at {{ now }}.',
        'From': 'alerts@shirim.dev',
      },
    },
  },
  {
    id: 'shirim/github-poller',
    name: 'GitHub Poller',
    description: 'Watch a repository for new issues, PRs, or releases.',
    supportsTrigger: true,
    supportsAction: false,
    defaultTitle: { trigger: 'New issue opened', action: '' },
    defaultSubtitle: { trigger: 'Repo: shirim-labs/shirim', action: '' },
    defaultConfig: {
      trigger: {
        'Repository': 'shirim-labs/shirim',
        'Event': 'issues.opened',
        'Poll interval': '5 minutes',
      },
      action: {},
    },
  },
  {
    id: 'shirim/discord-webhook',
    name: 'Discord Webhook',
    description: 'Post a message to a Discord channel via webhook URL.',
    supportsTrigger: false,
    supportsAction: true,
    defaultTitle: { trigger: '', action: 'Post to Discord' },
    defaultSubtitle: { trigger: '', action: '#alerts' },
    defaultConfig: {
      trigger: {},
      action: {
        'Webhook URL': 'https://discord.com/api/webhooks/...',
        'Channel': '#alerts',
        'Message': ':rotating_light: {{ trigger.title }}',
        'Username': 'Shirim Bot',
      },
    },
  },
  {
    id: 'shirim/schedule',
    name: 'Schedule',
    description: 'Fire on a recurring cron schedule.',
    supportsTrigger: true,
    supportsAction: false,
    defaultTitle: { trigger: 'Every weekday at 9am', action: '' },
    defaultSubtitle: { trigger: 'Cron: 0 9 * * 1-5', action: '' },
    defaultConfig: {
      trigger: {
        'Cron expression': '0 9 * * 1-5',
        'Timezone': 'Asia/Kolkata',
      },
      action: {},
    },
  },
  {
    id: 'shirim/log-watcher',
    name: 'Log Watcher',
    description: 'Tail a local file and match against a pattern.',
    supportsTrigger: true,
    supportsAction: false,
    defaultTitle: { trigger: 'Error pattern matched', action: '' },
    defaultSubtitle: { trigger: '/var/log/app.log', action: '' },
    defaultConfig: {
      trigger: {
        'File path': '/var/log/app.log',
        'Pattern': 'ERROR|FATAL',
        'Debounce': '30 seconds',
      },
      action: {},
    },
  },
];

export function findPlaceholderApp(appId: string): PlaceholderApp | null {
  return PLACEHOLDER_APPS.find(a => a.id === appId) ?? null;
}

/* ------------------------- SEED DATA -------------------------
 * Three richly-populated demo workflows shown on first open.
 */

function buildSeedWorkflows(): Workflow[] {
  const now = Date.now();

  const uptimeMonitor: Workflow = {
    id: 'wf_seed_uptime',
    name: 'Website Uptime Monitor',
    description: 'When Uptime Kuma detects that shirim.dev goes down, send me an email via Yagmail.',
    enabled: true,
    last_run_at: now - 1000 * 60 * 6,
    last_run_status: 'success',
    created_at: now - 1000 * 60 * 60 * 24 * 4,
    nodes: [
      {
        id: 'node_seed_kuma',
        kind: 'trigger',
        appId: 'louislam/uptime-kuma',
        appName: 'Uptime Kuma',
        appIcon: null,
        title: 'Website is down',
        subtitle: 'Monitor: shirim.dev',
        config: {
          'Monitor name': 'shirim.dev',
          'Check interval': '60 seconds',
          'Condition': 'Status code != 200',
        },
        x: 120,
        y: 140,
      },
      {
        id: 'node_seed_yagmail',
        kind: 'action',
        appId: 'kootenpv/yagmail',
        appName: 'Yagmail',
        appIcon: null,
        title: 'Send email',
        subtitle: 'To: ops@shirim.dev',
        config: {
          'To': 'ops@shirim.dev',
          'Subject': '[ALERT] shirim.dev is down',
          'Body': 'Hey — Uptime Kuma just reported shirim.dev is unreachable.\nChecked at {{ now }}.',
          'From': 'alerts@shirim.dev',
        },
        x: 520,
        y: 140,
      },
    ],
    edges: [
      { id: 'edge_seed_1', from: 'node_seed_kuma', to: 'node_seed_yagmail' },
    ],
  };

  const issueDigest: Workflow = {
    id: 'wf_seed_issues',
    name: 'New GitHub Issue Digest',
    description: 'Poll the shirim-labs repo for new issues and summarize them in a daily email.',
    enabled: false,
    last_run_at: null,
    last_run_status: 'never',
    created_at: now - 1000 * 60 * 60 * 24 * 2,
    nodes: [
      {
        id: 'node_seed_gh',
        kind: 'trigger',
        appId: 'shirim/github-poller',
        appName: 'GitHub Poller',
        appIcon: null,
        title: 'New issue opened',
        subtitle: 'Repo: shirim-labs/shirim',
        config: {
          'Repository': 'shirim-labs/shirim',
          'Event': 'issues.opened',
          'Poll interval': '15 minutes',
        },
        x: 100,
        y: 100,
      },
      {
        id: 'node_seed_schedule',
        kind: 'trigger',
        appId: 'shirim/schedule',
        appName: 'Schedule',
        appIcon: null,
        title: 'Every weekday at 9am',
        subtitle: 'Cron: 0 9 * * 1-5',
        config: {
          'Cron expression': '0 9 * * 1-5',
          'Timezone': 'Asia/Kolkata',
        },
        x: 100,
        y: 320,
      },
      {
        id: 'node_seed_digest_mail',
        kind: 'action',
        appId: 'kootenpv/yagmail',
        appName: 'Yagmail',
        appIcon: null,
        title: 'Send daily digest',
        subtitle: 'To: team@shirim.dev',
        config: {
          'To': 'team@shirim.dev',
          'Subject': 'Daily issue digest — {{ date }}',
          'Body': '{{ issues | join: "\\n- " }}',
          'From': 'digest@shirim.dev',
        },
        x: 560,
        y: 210,
      },
    ],
    edges: [
      { id: 'edge_seed_2a', from: 'node_seed_gh', to: 'node_seed_digest_mail' },
      { id: 'edge_seed_2b', from: 'node_seed_schedule', to: 'node_seed_digest_mail' },
    ],
  };

  const logAlerts: Workflow = {
    id: 'wf_seed_logs',
    name: 'Log Alerts',
    description: 'When an ERROR line appears in the local app log, ping #alerts on Discord.',
    enabled: true,
    last_run_at: now - 1000 * 60 * 60 * 3,
    last_run_status: 'failed',
    created_at: now - 1000 * 60 * 60 * 24 * 8,
    nodes: [
      {
        id: 'node_seed_log',
        kind: 'trigger',
        appId: 'shirim/log-watcher',
        appName: 'Log Watcher',
        appIcon: null,
        title: 'Error pattern matched',
        subtitle: '/var/log/shirim.log',
        config: {
          'File path': '/var/log/shirim.log',
          'Pattern': 'ERROR|FATAL',
          'Debounce': '30 seconds',
        },
        x: 140,
        y: 180,
      },
      {
        id: 'node_seed_discord',
        kind: 'action',
        appId: 'shirim/discord-webhook',
        appName: 'Discord Webhook',
        appIcon: null,
        title: 'Post to Discord',
        subtitle: '#alerts',
        config: {
          'Webhook URL': 'https://discord.com/api/webhooks/1234/abcd',
          'Channel': '#alerts',
          'Message': ':rotating_light: log error — {{ trigger.line }}',
          'Username': 'Shirim Bot',
        },
        x: 540,
        y: 180,
      },
    ],
    edges: [
      { id: 'edge_seed_3', from: 'node_seed_log', to: 'node_seed_discord' },
    ],
  };

  return [uptimeMonitor, issueDigest, logAlerts];
}
