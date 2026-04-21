export type Language = 'python' | 'node' | 'go' | 'rust';

export interface EntryPoint {
  kind: string;
  value: string;
  source: string;
}

export interface RequiredEnvVar {
  name: string;
  source: string;
  required: boolean;
}

export interface ParsedDeps {
  declaredDeps: string[];
  depFiles: string[];
  packageManagers: string[];
  candidateEntryPoints: EntryPoint[];
  appTypeHint: string;
  extras: Record<string, unknown>;
}

export interface SandboxInfo {
  env: Record<string, string>;
  pathPrepend: string[];
  notes: string[];
}

export interface LanguageAdapter {
  name: Language;
  detect(tree: string[], files: Record<string, string>): number;
  parseDeps(workdir: string, tree: string[], files: Record<string, string>): ParsedDeps;
  bootstrapSandbox(workdir: string): SandboxInfo;
  installCmd(parsed: ParsedDeps): string;
  smokeRunCandidates(parsed: ParsedDeps): string[];
}

export function emptyParsedDeps(): ParsedDeps {
  return {
    declaredDeps: [],
    depFiles: [],
    packageManagers: [],
    candidateEntryPoints: [],
    appTypeHint: 'unknown',
    extras: {},
  };
}
