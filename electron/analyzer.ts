/**
 * Repository analysis: file reading, env-var scanning, language detection.
 * Port of shirim-v2-backend/app/agent/analyzer.py
 */
import fs from 'fs';
import path from 'path';
import { walkRepoTree } from './sandbox.js';
import type { LanguageAdapter } from './adapters/base.js';

// -------------------- constants --------------------

export const INTERESTING_FILES = new Set([
  'README.md',
  'README.rst',
  'README.txt',
  'README',
  'requirements.txt',
  'requirements-dev.txt',
  'requirements_dev.txt',
  'setup.py',
  'setup.cfg',
  'pyproject.toml',
  'Pipfile',
  'package.json',
  'tsconfig.json',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Makefile',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.tool-versions',
  'Procfile',
  'fly.toml',
  'vercel.json',
  'netlify.toml',
  'render.yaml',
]);

export const MAX_FILE_BYTES = 256 * 1024;

export const ENV_VAR_RE =
  /(?<![A-Z0-9_])([A-Z][A-Z0-9_]{3,})(?=\s*[:=]|\s*\?=|\s*\)|\s*\.|\s*["'])/g;

export const ENV_VAR_BLOCKLIST = new Set([
  'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'EDITOR',
  'HOSTNAME', 'LOGNAME', 'DISPLAY', 'TMPDIR', 'TEMP', 'TMP',
  'PWD', 'OLDPWD', 'SHLVL', 'MAIL', 'MANPATH',
  'NODE_ENV', 'DEBUG', 'VERBOSE', 'PORT', 'HOST',
  'TRUE', 'FALSE', 'NULL', 'NONE', 'UNDEFINED',
  'TODO', 'FIXME', 'HACK', 'NOTE', 'WARNING', 'ERROR',
  'PASS', 'FAIL', 'SKIP', 'TEST', 'PROD', 'STAGE',
  'HTTP', 'HTTPS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'FORCE', 'ENABLE', 'DISABLE', 'ALLOW', 'DENY',
]);

export const WELL_KNOWN_SECRETS = new Set([
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'COHERE_API_KEY',
  'HUGGINGFACE_API_KEY',
  'REPLICATE_API_TOKEN',
  'PINECONE_API_KEY',
  'WEAVIATE_API_KEY',
  'QDRANT_API_KEY',
  'DATABASE_URL',
  'REDIS_URL',
  'MONGODB_URI',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'FIREBASE_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'SENDGRID_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'SLACK_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'GITHUB_TOKEN',
  'VERCEL_TOKEN',
  'NETLIFY_AUTH_TOKEN',
  'SECRET_KEY',
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'API_KEY',
  'API_SECRET',
  'APP_SECRET',
]);

// -------------------- helpers --------------------

export function readFiles(
  workdir: string,
  tree: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const treeSet = new Set(tree);

  for (const name of INTERESTING_FILES) {
    if (!treeSet.has(name)) continue;
    const full = path.join(workdir, name);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
      result[name] = fs.readFileSync(full, 'utf-8');
    } catch {
      // skip unreadable files
    }
  }
  return result;
}

export interface EnvVarInfo {
  name: string;
  source: string;
  required: boolean;
}

export function scanEnvVars(
  files: Record<string, string>,
  treeSample: string[],
): EnvVarInfo[] {
  const seen = new Map<string, EnvVarInfo>();

  // Scan .env.example / .env.sample / .env.template
  for (const name of ['.env.example', '.env.sample', '.env.template']) {
    const content = files[name];
    if (!content) continue;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const varName = trimmed.slice(0, eqIdx).trim();
      if (/^[A-Z][A-Z0-9_]{2,}$/.test(varName) && !ENV_VAR_BLOCKLIST.has(varName)) {
        if (!seen.has(varName)) {
          seen.set(varName, {
            name: varName,
            source: name,
            required: WELL_KNOWN_SECRETS.has(varName),
          });
        }
      }
    }
  }

  // Scan README files for env var patterns
  for (const name of ['README.md', 'README.rst', 'README.txt', 'README']) {
    const content = files[name];
    if (!content) continue;
    const matches = content.matchAll(ENV_VAR_RE);
    for (const m of matches) {
      const varName = m[1];
      if (ENV_VAR_BLOCKLIST.has(varName)) continue;
      if (!seen.has(varName)) {
        seen.set(varName, {
          name: varName,
          source: name,
          required: WELL_KNOWN_SECRETS.has(varName),
        });
      }
    }
  }

  // Check tree for .env files as additional signal
  for (const f of treeSample) {
    if (f === '.env' || f === '.env.local') {
      // .env exists — any vars found are likely needed
    }
  }

  return Array.from(seen.values());
}

export function languageDistribution(
  tree: string[],
): Record<string, number> {
  const extCounts: Record<string, number> = {};
  let total = 0;

  for (const f of tree) {
    const ext = path.extname(f).toLowerCase();
    if (!ext) continue;
    extCounts[ext] = (extCounts[ext] ?? 0) + 1;
    total++;
  }

  if (total === 0) return {};

  const result: Record<string, number> = {};
  for (const [ext, count] of Object.entries(extCounts)) {
    const pct = Math.round((count / total) * 1000) / 10;
    if (pct >= 1) {
      result[ext] = pct;
    }
  }

  // Sort by percentage descending
  const sorted: Record<string, number> = {};
  for (const [ext, pct] of Object.entries(result).sort((a, b) => b[1] - a[1])) {
    sorted[ext] = pct;
  }
  return sorted;
}

export interface AnalysisResult {
  language: string;
  language_distribution: Record<string, number>;
  declared_deps: string[];
  dep_files: string[];
  package_managers: string[];
  candidate_entry_points: Array<{ kind: string; value: string; source: string }>;
  app_type_hint: string;
  env_vars: EnvVarInfo[];
  secret_names: string[];
  interesting_files: string[];
  tree_sample: string[];
  extras: Record<string, unknown>;
}

export function analyze(
  workdir: string,
  adapters: LanguageAdapter[],
): AnalysisResult {
  const tree = walkRepoTree(workdir);
  const files = readFiles(workdir, tree);

  // Detect language
  let bestAdapter: LanguageAdapter | null = null;
  let bestScore = 0;
  for (const adapter of adapters) {
    const score = adapter.detect(tree, files);
    if (score > bestScore) {
      bestScore = score;
      bestAdapter = adapter;
    }
  }

  const language = bestAdapter?.name ?? 'unknown';

  // Parse dependencies
  const parsed = bestAdapter
    ? bestAdapter.parseDeps(workdir, tree, files)
    : {
        declaredDeps: [],
        depFiles: [],
        packageManagers: [],
        candidateEntryPoints: [],
        appTypeHint: 'unknown',
        extras: {},
      };

  // Scan env vars
  const treeSample = tree.slice(0, 200);
  const envVars = scanEnvVars(files, treeSample);
  const secretNames = envVars
    .filter(v => v.required || WELL_KNOWN_SECRETS.has(v.name))
    .map(v => v.name);

  // Language distribution
  const langDist = languageDistribution(tree);

  const result: AnalysisResult = {
    language,
    language_distribution: langDist,
    declared_deps: parsed.declaredDeps,
    dep_files: parsed.depFiles,
    package_managers: parsed.packageManagers,
    candidate_entry_points: parsed.candidateEntryPoints,
    app_type_hint: parsed.appTypeHint,
    env_vars: envVars,
    secret_names: secretNames,
    interesting_files: Object.keys(files),
    tree_sample: treeSample,
    extras: parsed.extras,
  };

  // Write analysis.json
  const analysisPath = path.join(workdir, 'analysis.json');
  fs.writeFileSync(analysisPath, JSON.stringify(result, null, 2), 'utf-8');

  return result;
}
