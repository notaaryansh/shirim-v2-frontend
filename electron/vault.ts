/**
 * JSON-backed secret vault.  Stores API keys globally so all installed apps
 * can share them.  File is chmod 600 (owner-only) on disk.
 *
 * Port of shirim-v2-backend/app/vault.py
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const VAULT_DIR = path.join(os.homedir(), '.shirim');
const VAULT_FILE = path.join(VAULT_DIR, 'secrets.json');

function ensure(): void {
  fs.mkdirSync(VAULT_DIR, { recursive: true });
}

export function load(): Record<string, string> {
  try {
    if (!fs.existsSync(VAULT_FILE)) return {};
    return JSON.parse(fs.readFileSync(VAULT_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function save(secrets: Record<string, string>): void {
  ensure();
  fs.writeFileSync(VAULT_FILE, JSON.stringify(secrets, null, 2), 'utf-8');
  try {
    fs.chmodSync(VAULT_FILE, 0o600);
  } catch { /* Windows or permission issue — ignore */ }
}

export function get(name: string): string | null {
  return load()[name] ?? null;
}

export function setKey(name: string, value: string): void {
  const s = load();
  s[name] = value;
  save(s);
}

export function deleteKey(name: string): boolean {
  const s = load();
  if (!(name in s)) return false;
  delete s[name];
  save(s);
  return true;
}

export function mask(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '•'.repeat(value.length);
  return value.slice(0, 4) + '•'.repeat(Math.min(value.length - 8, 12)) + value.slice(-4);
}

export function listMasked(): Array<{ name: string; masked_value: string; length: number }> {
  const secrets = load();
  return Object.entries(secrets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ({ name: k, masked_value: mask(v), length: v.length }));
}

export function check(names: string[]): Record<string, boolean> {
  const secrets = load();
  const result: Record<string, boolean> = {};
  for (const n of names) {
    result[n] = n in secrets && Boolean(secrets[n]);
  }
  return result;
}
