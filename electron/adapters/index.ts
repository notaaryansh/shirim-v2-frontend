import { NodeAdapter } from './node.js';
import { PythonAdapter } from './python.js';
import { GoAdapter } from './go.js';
import { RustAdapter } from './rust.js';
import type { Language, LanguageAdapter } from './base.js';

export function allAdapters(): LanguageAdapter[] {
  return [new PythonAdapter(), new NodeAdapter(), new GoAdapter(), new RustAdapter()];
}

export function getAdapter(name: Language): LanguageAdapter {
  const adapter = allAdapters().find(a => a.name === name);
  if (!adapter) throw new Error(`unknown language: ${name}`);
  return adapter;
}

export * from './base.js';
