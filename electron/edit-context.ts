/**
 * Scan a project's working directory to build app context for the edit agent.
 * Port of shirim-v2-backend/app/agent/edit_context.py
 */
import fs from 'fs';
import path from 'path';

// -------------------- types --------------------

export interface AppContext {
  projectType: string;
  framework: string | null;
  styling: string | null;
  uiLibrary: string | null;
  typescript: boolean;
  components: string[];
  keyFiles: string[];
  remotion: boolean;
  remotionCompositions: string[];
  packageJson: Record<string, unknown> | null;
}

// -------------------- detection helpers --------------------

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasDep(
  pkg: Record<string, unknown>,
  name: string,
): boolean {
  const deps = pkg['dependencies'] as Record<string, string> | undefined;
  const devDeps = pkg['devDependencies'] as Record<string, string> | undefined;
  return !!(deps?.[name] || devDeps?.[name]);
}

function hasAnyDep(
  pkg: Record<string, unknown>,
  names: string[],
): string | null {
  for (const name of names) {
    if (hasDep(pkg, name)) return name;
  }
  return null;
}

export function _detectProjectType(
  pkg: Record<string, unknown> | null,
  workdir: string,
): string {
  if (!pkg) {
    // Check for non-JS projects
    if (fs.existsSync(path.join(workdir, 'pyproject.toml')) ||
        fs.existsSync(path.join(workdir, 'requirements.txt'))) {
      return 'python';
    }
    if (fs.existsSync(path.join(workdir, 'go.mod'))) return 'go';
    if (fs.existsSync(path.join(workdir, 'Cargo.toml'))) return 'rust';
    return 'unknown';
  }

  if (hasDep(pkg, 'remotion')) return 'remotion';
  if (hasDep(pkg, 'next')) return 'nextjs';
  if (hasDep(pkg, 'nuxt') || hasDep(pkg, 'nuxt3')) return 'nuxt';
  if (hasDep(pkg, '@sveltejs/kit')) return 'sveltekit';
  if (hasDep(pkg, 'gatsby')) return 'gatsby';
  if (hasDep(pkg, 'vite')) return 'vite';
  if (hasDep(pkg, 'react-scripts')) return 'create-react-app';
  if (hasDep(pkg, 'express') || hasDep(pkg, 'fastify') || hasDep(pkg, 'koa')) return 'node-server';
  if (hasDep(pkg, 'react')) return 'react';
  if (hasDep(pkg, 'vue')) return 'vue';
  if (hasDep(pkg, 'svelte')) return 'svelte';
  return 'node';
}

export function _detectFramework(
  pkg: Record<string, unknown> | null,
): string | null {
  if (!pkg) return null;

  if (hasDep(pkg, 'next')) return 'Next.js';
  if (hasDep(pkg, 'remotion')) return 'Remotion';
  if (hasDep(pkg, 'nuxt') || hasDep(pkg, 'nuxt3')) return 'Nuxt';
  if (hasDep(pkg, '@sveltejs/kit')) return 'SvelteKit';
  if (hasDep(pkg, 'gatsby')) return 'Gatsby';
  if (hasDep(pkg, 'react-scripts')) return 'Create React App';
  if (hasDep(pkg, 'express')) return 'Express';
  if (hasDep(pkg, 'fastify')) return 'Fastify';
  if (hasDep(pkg, 'koa')) return 'Koa';
  if (hasDep(pkg, 'react')) return 'React';
  if (hasDep(pkg, 'vue')) return 'Vue';
  if (hasDep(pkg, 'svelte')) return 'Svelte';
  return null;
}

export function _detectStyling(
  pkg: Record<string, unknown> | null,
): string | null {
  if (!pkg) return null;

  const match = hasAnyDep(pkg, [
    'tailwindcss',
    '@emotion/react',
    '@emotion/styled',
    'styled-components',
    'sass',
    'less',
    '@mui/system',
    'styled-jsx',
  ]);

  if (!match) return null;

  const nameMap: Record<string, string> = {
    tailwindcss: 'Tailwind CSS',
    '@emotion/react': 'Emotion',
    '@emotion/styled': 'Emotion',
    'styled-components': 'styled-components',
    sass: 'Sass/SCSS',
    less: 'Less',
    '@mui/system': 'MUI System',
    'styled-jsx': 'styled-jsx',
  };

  return nameMap[match] ?? match;
}

export function _detectUiLibrary(
  pkg: Record<string, unknown> | null,
): string | null {
  if (!pkg) return null;

  const match = hasAnyDep(pkg, [
    '@mui/material',
    '@chakra-ui/react',
    'antd',
    '@radix-ui/react-dialog',
    '@radix-ui/themes',
    '@headlessui/react',
    'shadcn-ui',
    '@shadcn/ui',
  ]);

  if (!match) return null;

  const nameMap: Record<string, string> = {
    '@mui/material': 'Material UI',
    '@chakra-ui/react': 'Chakra UI',
    antd: 'Ant Design',
    '@radix-ui/react-dialog': 'Radix UI',
    '@radix-ui/themes': 'Radix UI',
    '@headlessui/react': 'Headless UI',
    'shadcn-ui': 'shadcn/ui',
    '@shadcn/ui': 'shadcn/ui',
  };

  return nameMap[match] ?? match;
}

export function _scanRemotion(
  workdir: string,
): string[] {
  const compositions: string[] = [];
  const srcDir = path.join(workdir, 'src');

  if (!fs.existsSync(srcDir)) return compositions;

  function scanDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        scanDir(path.join(dir, entry.name));
      } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name)) {
        try {
          const content = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
          // Look for <Composition or registerRoot
          const compMatches = content.matchAll(/<Composition[\s\S]*?id=["']([^"']+)["']/g);
          for (const m of compMatches) {
            compositions.push(m[1]);
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  scanDir(srcDir);
  return compositions;
}

export function _findComponents(workdir: string): string[] {
  const components: string[] = [];
  const searchDirs = ['src/components', 'components', 'src/app', 'app'];

  for (const rel of searchDirs) {
    const dir = path.join(workdir, rel);
    if (!fs.existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (/\.(tsx?|jsx?|vue|svelte)$/.test(name)) {
        components.push(path.join(rel, name));
      }
      // Check for directory-based components (index file inside)
      const subDir = path.join(dir, name);
      try {
        if (fs.statSync(subDir).isDirectory()) {
          const subEntries = fs.readdirSync(subDir);
          const hasIndex = subEntries.some(f =>
            /^index\.(tsx?|jsx?|vue|svelte)$/.test(f)
          );
          if (hasIndex) {
            components.push(path.join(rel, name));
          }
        }
      } catch {
        // skip
      }
    }

    if (components.length >= 50) break;
  }

  return components.slice(0, 50);
}

export function _findKeyFiles(workdir: string): string[] {
  const keyFiles: string[] = [];
  const candidates = [
    'src/App.tsx', 'src/App.jsx', 'src/App.vue', 'src/App.svelte',
    'src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js',
    'src/index.tsx', 'src/index.jsx', 'src/index.ts', 'src/index.js',
    'pages/index.tsx', 'pages/index.jsx', 'pages/index.vue',
    'app/page.tsx', 'app/page.jsx',
    'app/layout.tsx', 'app/layout.jsx',
    'src/root.tsx', 'src/Root.tsx',
    'src/Video.tsx',
    'tailwind.config.js', 'tailwind.config.ts',
    'postcss.config.js',
    'vite.config.ts', 'vite.config.js',
    'next.config.js', 'next.config.ts', 'next.config.mjs',
    'tsconfig.json',
    'package.json',
  ];

  for (const rel of candidates) {
    if (fs.existsSync(path.join(workdir, rel))) {
      keyFiles.push(rel);
    }
  }

  return keyFiles;
}

// -------------------- main entry point --------------------

export function scanAppContext(workdir: string): AppContext {
  const pkgPath = path.join(workdir, 'package.json');
  const pkg = readJsonSafe(pkgPath);

  const projectType = _detectProjectType(pkg, workdir);
  const framework = _detectFramework(pkg);
  const styling = _detectStyling(pkg);
  const uiLibrary = _detectUiLibrary(pkg);

  const tsConfigExists = fs.existsSync(path.join(workdir, 'tsconfig.json'));
  const typescript = tsConfigExists || (pkg ? hasDep(pkg, 'typescript') : false);

  const components = _findComponents(workdir);
  const keyFiles = _findKeyFiles(workdir);

  const isRemotion = projectType === 'remotion';
  const remotionCompositions = isRemotion ? _scanRemotion(workdir) : [];

  return {
    projectType,
    framework,
    styling,
    uiLibrary,
    typescript,
    components,
    keyFiles,
    remotion: isRemotion,
    remotionCompositions,
    packageJson: pkg,
  };
}
