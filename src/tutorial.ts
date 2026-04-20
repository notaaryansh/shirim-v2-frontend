/* ------------------------- TUTORIAL DOCS -------------------------
 * Documentation content for the Tutorial tab. Organized as topic groups
 * (Getting Started, Guides, Workflows, Advanced) each containing articles.
 * Each article is built out of typed content blocks — headings, prose,
 * code, video placeholders, callouts, lists, images.
 *
 * No XP, no progress tracking, no unlocks — this is straight documentation.
 */

export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; body: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'video'; caption: string; duration: string }
  | { kind: 'callout'; variant: 'tip' | 'warning' | 'note'; body: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'image'; caption: string; accent: 'yellow' | 'blue' | 'neutral' }
  | { kind: 'divider' };

export type Article = {
  slug: string;
  title: string;
  subtitle: string;
  category: string;
  readingTime: string;
  updated: string;
  blocks: Block[];
};

export type TopicGroup = {
  id: string;
  title: string;
  articles: Article[];
};

/* ------------------------- DOCS CONTENT ------------------------- */

export const DOCS: TopicGroup[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    articles: [
      {
        slug: 'what-is-shirim',
        title: 'What is Shirim?',
        subtitle: 'An app store for open-source software.',
        category: 'Getting started',
        readingTime: '3 min read',
        updated: 'Apr 12, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Shirim turns GitHub repositories into one-click installable apps. You find a project, hit Install, and Shirim handles cloning, dependencies, configuration, and launching — without ever opening a terminal.' },
          { kind: 'paragraph', body: 'Think of it as Homebrew meets the App Store — but the catalog is every open-source project on GitHub, and everything runs on your own machine.' },
          { kind: 'video', caption: 'A 60-second tour of Shirim', duration: '1:02' },
          { kind: 'heading', level: 2, text: 'Who is Shirim for?' },
          { kind: 'paragraph', body: 'Shirim is built for anyone who wants to try, run, or self-host open-source software without wrestling with toolchains. That includes developers who want a quick way to evaluate projects, power users replacing paid SaaS with open-source alternatives, and teams bundling tools into shareable stacks.' },
          { kind: 'heading', level: 2, text: 'What you can do' },
          { kind: 'list', ordered: false, items: [
            'Browse and install any open-source project from GitHub in one click',
            'Launch installed apps directly from the Installed tab',
            'Chain installed apps together with Workflows',
            'Store API keys and secrets once in the vault, reference them everywhere',
            'Export your setup as a shareable template',
          ]},
          { kind: 'callout', variant: 'tip', body: 'If you\'ve ever typed "git clone" followed by a 20-step README, Shirim was built for you.' },
        ],
      },
      {
        slug: 'installation',
        title: 'Installation',
        subtitle: 'Install Shirim on your machine.',
        category: 'Getting started',
        readingTime: '2 min read',
        updated: 'Apr 10, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Shirim ships as a desktop application for macOS, Windows, and Linux. The easiest way to install is via the official download page.' },
          { kind: 'heading', level: 2, text: 'macOS' },
          { kind: 'code', lang: 'bash', code: 'brew install --cask shirim\n# or download the .dmg from shirim.dev/download' },
          { kind: 'heading', level: 2, text: 'Linux' },
          { kind: 'code', lang: 'bash', code: '# AppImage\ncurl -L https://shirim.dev/download/linux -o shirim.AppImage\nchmod +x shirim.AppImage\n./shirim.AppImage' },
          { kind: 'heading', level: 2, text: 'Windows' },
          { kind: 'paragraph', body: 'Download the installer from the releases page and run it. Shirim will add itself to your Start menu and create a shortcut on your desktop.' },
          { kind: 'callout', variant: 'note', body: 'Shirim stores all installed apps under ~/.shirim/installs. You can safely delete this directory to reset everything.' },
        ],
      },
      {
        slug: 'quickstart',
        title: 'Quickstart',
        subtitle: 'From zero to running app in 90 seconds.',
        category: 'Getting started',
        readingTime: '2 min read',
        updated: 'Apr 14, 2026',
        blocks: [
          { kind: 'paragraph', body: 'This is the fastest path from opening Shirim for the first time to running an installed app.' },
          { kind: 'video', caption: 'Your first install, end-to-end', duration: '1:28' },
          { kind: 'heading', level: 2, text: 'Step by step' },
          { kind: 'list', ordered: true, items: [
            'Open the Home tab and pick any project — or use search (⌘K) to find something specific.',
            'Click the project card to open its detail page.',
            'Hit the green Install button. Shirim will run its 5-phase install pipeline.',
            'When the install completes, click ▶ on the Installed tab to launch the app.',
            'Web apps auto-open in your default browser. CLI apps show live logs.',
          ]},
          { kind: 'callout', variant: 'tip', body: 'Want to try something easy? Install Excalidraw — it\'s a single-binary web app that\'s ready in under a minute.' },
        ],
      },
    ],
  },
  {
    id: 'guides',
    title: 'Guides',
    articles: [
      {
        slug: 'setting-up-openclaw',
        title: 'Setting up OpenClaw',
        subtitle: 'Get the OpenClaw AI agent running locally.',
        category: 'Guides',
        readingTime: '5 min read',
        updated: 'Apr 15, 2026',
        blocks: [
          { kind: 'paragraph', body: 'OpenClaw is an open-source AI agent that runs fully on your machine. It can use tools, browse the web, and execute tasks on your behalf — without sending your data to a third-party server.' },
          { kind: 'video', caption: 'Installing and configuring OpenClaw', duration: '3:47' },
          { kind: 'heading', level: 2, text: 'Requirements' },
          { kind: 'list', ordered: false, items: [
            'At least 16GB of RAM (32GB recommended for larger models)',
            '10GB of free disk space for the default model',
            'Node.js 20+ (Shirim will install this for you if missing)',
          ]},
          { kind: 'heading', level: 2, text: 'Install via Shirim' },
          { kind: 'paragraph', body: 'Search for openclaw in the search bar or navigate to it from the Home tab. Click Install and wait for the five install phases to complete.' },
          { kind: 'image', caption: 'OpenClaw detail page with Install button', accent: 'blue' },
          { kind: 'heading', level: 2, text: 'Configure your model' },
          { kind: 'paragraph', body: 'OpenClaw ships with a default local model. To use a different model, edit the config file at ~/.shirim/installs/openclaw/config.json:' },
          { kind: 'code', lang: 'json', code: '{\n  "model": "llama-3.1-8b-instruct",\n  "tools": ["web-search", "filesystem", "shell"],\n  "max_iterations": 10,\n  "temperature": 0.7\n}' },
          { kind: 'callout', variant: 'warning', body: 'The shell tool lets OpenClaw execute commands on your machine. Only enable it if you trust the prompts being sent to the agent.' },
          { kind: 'heading', level: 2, text: 'Running your first task' },
          { kind: 'code', lang: 'bash', code: 'shirim run openclaw "find all TODO comments in ~/Documents/GitHub and summarize them"' },
          { kind: 'paragraph', body: 'OpenClaw will spawn a browser window where you can watch it reason through the task step by step.' },
        ],
      },
      {
        slug: 'setting-up-ollama',
        title: 'Setting up Ollama',
        subtitle: 'Run large language models on your laptop.',
        category: 'Guides',
        readingTime: '4 min read',
        updated: 'Apr 11, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Ollama is the easiest way to run open-weight LLMs on your own hardware. After installing via Shirim, you can pull models from Ollama\'s registry and chat with them from any client that speaks the OpenAI API.' },
          { kind: 'video', caption: 'Ollama + open-webui setup', duration: '4:12' },
          { kind: 'heading', level: 2, text: 'Install via Shirim' },
          { kind: 'paragraph', body: 'Find Ollama on the Home tab\'s Popular row, click Install, and wait for Shirim to finish. Ollama runs as a background service on port 11434.' },
          { kind: 'heading', level: 2, text: 'Pull a model' },
          { kind: 'code', lang: 'bash', code: '# Pull Llama 3.1\nollama pull llama3.1\n\n# Pull a smaller, faster model\nollama pull phi3' },
          { kind: 'heading', level: 3, text: 'Recommended models by RAM' },
          { kind: 'list', ordered: false, items: [
            '8GB RAM → phi3, gemma:2b',
            '16GB RAM → llama3.1:8b, mistral:7b',
            '32GB+ RAM → llama3.1:70b-instruct-q4, mixtral',
          ]},
          { kind: 'heading', level: 2, text: 'Test the API' },
          { kind: 'code', lang: 'bash', code: 'curl http://localhost:11434/api/generate -d \'{\n  "model": "llama3.1",\n  "prompt": "Why is the sky blue?"\n}\'' },
          { kind: 'callout', variant: 'tip', body: 'Pair Ollama with open-webui (also installable via Shirim) for a ChatGPT-style interface on top of your local models.' },
        ],
      },
      {
        slug: 'setting-up-uptime-kuma',
        title: 'Setting up Uptime Kuma',
        subtitle: 'Monitor your websites and services.',
        category: 'Guides',
        readingTime: '3 min read',
        updated: 'Apr 09, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Uptime Kuma is a self-hosted status monitoring tool. Add the sites you care about and it will ping them on an interval, sending alerts when anything goes down.' },
          { kind: 'video', caption: 'Configuring your first monitor', duration: '2:51' },
          { kind: 'heading', level: 2, text: 'Add a monitor' },
          { kind: 'list', ordered: true, items: [
            'Launch Uptime Kuma from the Installed tab.',
            'Open the dashboard at localhost:3001.',
            'Click "Add New Monitor" and pick HTTP(s).',
            'Enter the URL, check interval (default 60s), and notification channels.',
          ]},
          { kind: 'image', caption: 'Uptime Kuma dashboard', accent: 'yellow' },
          { kind: 'heading', level: 2, text: 'Wiring it into a workflow' },
          { kind: 'paragraph', body: 'Uptime Kuma fires a webhook when a monitor changes state. In Shirim, you can trigger a workflow off that webhook — for example, to send an email via Yagmail when a site goes down.' },
          { kind: 'callout', variant: 'note', body: 'See the "Creating your first workflow" guide for the full Uptime Kuma → Yagmail example.' },
        ],
      },
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows',
    articles: [
      {
        slug: 'workflows-overview',
        title: 'Workflows overview',
        subtitle: 'What workflows are and when to use them.',
        category: 'Workflows',
        readingTime: '3 min read',
        updated: 'Apr 15, 2026',
        blocks: [
          { kind: 'paragraph', body: 'A workflow is a small graph of installed apps wired together. One app emits an event (the trigger), another app consumes it (the action). The result is an automation that runs in the background without any glue code.' },
          { kind: 'image', caption: 'A simple Uptime Kuma → Yagmail workflow', accent: 'neutral' },
          { kind: 'heading', level: 2, text: 'When to use a workflow' },
          { kind: 'list', ordered: false, items: [
            'You want one app\'s output to become another\'s input.',
            'You want to schedule a recurring task.',
            'You want to bridge two tools that don\'t know about each other.',
          ]},
          { kind: 'heading', level: 2, text: 'When NOT to use a workflow' },
          { kind: 'paragraph', body: 'Workflows are for gluing apps together, not for one-off scripts. If your need is "run this Python script on Monday", you\'re better off using cron or a systemd timer.' },
          { kind: 'callout', variant: 'tip', body: 'Workflows can trigger other workflows. Keep each one focused — small, composable workflows are easier to debug than one giant flowchart.' },
        ],
      },
      {
        slug: 'first-workflow',
        title: 'Creating your first workflow',
        subtitle: 'Uptime Kuma → Yagmail, from scratch.',
        category: 'Workflows',
        readingTime: '6 min read',
        updated: 'Apr 14, 2026',
        blocks: [
          { kind: 'paragraph', body: 'We\'ll build a workflow that sends you an email every time Uptime Kuma detects your website is down. Make sure you\'ve installed both Uptime Kuma and Yagmail via Shirim before starting.' },
          { kind: 'video', caption: 'Building the Uptime Kuma → Yagmail workflow', duration: '5:18' },
          { kind: 'heading', level: 2, text: 'Create the workflow' },
          { kind: 'list', ordered: true, items: [
            'Open the Workflows tab and click "+ New workflow".',
            'In the canvas, drag Uptime Kuma from the left panel onto the canvas.',
            'Drag Yagmail onto the canvas.',
            'Click and hold the output port on Uptime Kuma, drag to Yagmail\'s input port.',
            'Click the Uptime Kuma node to configure the monitor name and condition.',
            'Click Yagmail to set the To, Subject, and Body fields.',
            'Hit Save and toggle Enabled.',
          ]},
          { kind: 'heading', level: 2, text: 'Templating the email body' },
          { kind: 'paragraph', body: 'Yagmail\'s body field supports template variables. The upstream Uptime Kuma node passes its event data through, which you can reference with {{ trigger.* }}:' },
          { kind: 'code', lang: 'text', code: 'Hey — {{ trigger.monitor_name }} just went down.\n\nLast checked: {{ trigger.last_check }}\nStatus: {{ trigger.status_code }}\n\nDashboard: http://localhost:3001' },
          { kind: 'callout', variant: 'warning', body: 'Make sure Yagmail has its SMTP credentials stored in the Secrets vault before enabling the workflow — otherwise the first run will fail.' },
        ],
      },
      {
        slug: 'triggers-actions',
        title: 'Triggers & actions',
        subtitle: 'How to recognize and configure each kind of node.',
        category: 'Workflows',
        readingTime: '4 min read',
        updated: 'Apr 13, 2026',
        blocks: [
          { kind: 'heading', level: 2, text: 'Triggers' },
          { kind: 'paragraph', body: 'A trigger is what starts a workflow. It can be event-based (a webhook fired from another app) or time-based (a cron schedule). Triggers emit one or more output fields that downstream actions can read.' },
          { kind: 'heading', level: 3, text: 'Common triggers' },
          { kind: 'list', ordered: false, items: [
            'Uptime Kuma — monitor state change',
            'GitHub Poller — new issue, PR, or release',
            'Schedule — cron expression',
            'Log Watcher — file pattern match',
          ]},
          { kind: 'heading', level: 2, text: 'Actions' },
          { kind: 'paragraph', body: 'An action consumes the output of the previous node and does something with it. Actions can branch (run only if a condition is met) or fan out (run for each item in a list).' },
          { kind: 'heading', level: 3, text: 'Common actions' },
          { kind: 'list', ordered: false, items: [
            'Yagmail — send email',
            'Discord Webhook — post a message',
            'HTTP Request — arbitrary POST/GET/PUT',
            'Run Command — execute a shell command',
          ]},
          { kind: 'callout', variant: 'note', body: 'Some apps can be both. For example, a generic HTTP app can trigger on an incoming webhook and act as an outbound POST to a different endpoint.' },
        ],
      },
      {
        slug: 'secrets-vault',
        title: 'Secrets vault',
        subtitle: 'Store API keys once, reference them everywhere.',
        category: 'Workflows',
        readingTime: '3 min read',
        updated: 'Apr 12, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Hard-coding API keys into workflow configs is a recipe for accidentally leaking them. Shirim\'s secrets vault lets you store credentials once and reference them from any workflow via {{ secrets.name }}.' },
          { kind: 'video', caption: 'Adding and referencing a secret', duration: '2:04' },
          { kind: 'heading', level: 2, text: 'Add a secret' },
          { kind: 'code', lang: 'bash', code: 'shirim vault add DISCORD_WEBHOOK https://discord.com/api/webhooks/...\nshirim vault add SMTP_PASSWORD "********"' },
          { kind: 'heading', level: 2, text: 'Reference in a workflow' },
          { kind: 'code', lang: 'text', code: 'Webhook URL: {{ secrets.DISCORD_WEBHOOK }}\nPassword: {{ secrets.SMTP_PASSWORD }}' },
          { kind: 'callout', variant: 'tip', body: 'Secrets are encrypted at rest and masked in the UI. Click the eye icon next to a secret to reveal it temporarily.' },
        ],
      },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    articles: [
      {
        slug: 'templates',
        title: 'Templates',
        subtitle: 'Bundle apps + workflows into a shareable setup.',
        category: 'Advanced',
        readingTime: '4 min read',
        updated: 'Apr 08, 2026',
        blocks: [
          { kind: 'paragraph', body: 'A template is a snapshot of a set of installed apps, their configs, and any workflows that connect them — packaged into a single shareable file.' },
          { kind: 'heading', level: 2, text: 'Export' },
          { kind: 'code', lang: 'bash', code: 'shirim export --template my-monitoring-stack \\\n  --include uptime-kuma,yagmail \\\n  --include-workflows website-uptime-monitor' },
          { kind: 'heading', level: 2, text: 'Import' },
          { kind: 'code', lang: 'bash', code: 'shirim import shirim.dev/t/mxq7z\n# or\nshirim import ./my-monitoring-stack.shirim' },
          { kind: 'callout', variant: 'warning', body: 'Templates do not include the contents of the secrets vault. Recipients will need to set their own API keys after importing.' },
        ],
      },
      {
        slug: 'backup-restore',
        title: 'Backup & restore',
        subtitle: 'Save and restore your Shirim state.',
        category: 'Advanced',
        readingTime: '2 min read',
        updated: 'Apr 06, 2026',
        blocks: [
          { kind: 'paragraph', body: 'Everything Shirim stores locally lives under ~/.shirim. Backing up that directory is enough to restore your full setup on another machine.' },
          { kind: 'heading', level: 2, text: 'Backup' },
          { kind: 'code', lang: 'bash', code: 'tar -czf shirim-backup-$(date +%F).tar.gz ~/.shirim' },
          { kind: 'heading', level: 2, text: 'Restore' },
          { kind: 'code', lang: 'bash', code: 'tar -xzf shirim-backup-YYYY-MM-DD.tar.gz -C ~/' },
          { kind: 'callout', variant: 'note', body: 'The secrets vault is encrypted with a machine-local key by default. To restore on a different machine, enable "portable vault" in Settings before backing up.' },
        ],
      },
    ],
  },
];

/** Flatten all articles across all groups (used for lookups). */
export function allArticles(): Article[] {
  return DOCS.flatMap(g => g.articles);
}

export function findArticle(slug: string): Article | null {
  return allArticles().find(a => a.slug === slug) ?? null;
}

/** Given a slug, return its group + indexes — useful for prev/next navigation. */
export function locateArticle(slug: string): { group: TopicGroup; index: number } | null {
  for (const group of DOCS) {
    const idx = group.articles.findIndex(a => a.slug === slug);
    if (idx >= 0) return { group, index: idx };
  }
  return null;
}

/** Return the next article in reading order, or null at the end. */
export function nextArticle(slug: string): Article | null {
  const all = allArticles();
  const idx = all.findIndex(a => a.slug === slug);
  if (idx < 0 || idx >= all.length - 1) return null;
  return all[idx + 1];
}

export function prevArticle(slug: string): Article | null {
  const all = allArticles();
  const idx = all.findIndex(a => a.slug === slug);
  if (idx <= 0) return null;
  return all[idx - 1];
}
