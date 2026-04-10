import type { RepoDetail } from './api';

/**
 * localStorage-backed cache of RepoDetail responses keyed by "owner/repo".
 * Used by ProductPage (read on mount, write on successful fetch) and by the
 * Discover prefetch worker (background-populates the cache so clicks are
 * instant the next time the user visits a repo).
 *
 * The in-memory copy avoids re-parsing the JSON blob on every read.
 */

const KEY = 'shirim-detail-cache';

let memoryCache: Record<string, RepoDetail> | null = null;

function readMap(): Record<string, RepoDetail> {
  if (memoryCache) return memoryCache;
  try {
    const raw = localStorage.getItem(KEY);
    memoryCache = raw ? (JSON.parse(raw) as Record<string, RepoDetail>) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache!;
}

function writeMap(m: Record<string, RepoDetail>): void {
  memoryCache = m;
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    // localStorage quota exceeded — silently fall back to memory-only cache
  }
}

export function getCachedDetail(ownerRepo: string): RepoDetail | null {
  return readMap()[ownerRepo] ?? null;
}

export function hasCachedDetail(ownerRepo: string): boolean {
  return ownerRepo in readMap();
}

export function setCachedDetail(ownerRepo: string, detail: RepoDetail): void {
  const m = { ...readMap(), [ownerRepo]: detail };
  writeMap(m);
}

export function clearDetailCache(): void {
  memoryCache = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Warm the browser's HTTP cache by kicking off image downloads via `new Image()`.
 * Zero-render, zero-UI side effect — the browser streams the bytes into its
 * standard HTTP cache, and when an actual `<img src={...}>` later asks for the
 * same URL, it hits the cache instantly instead of doing a fresh network round-trip.
 *
 * Called from the Discover prefetch worker and from ProductPage on live fetch,
 * so both code paths leave behind fully-warm carousel images for the next visit.
 *
 * Limited to the first N images per repo so a repo with 20+ screenshots doesn't
 * burn unnecessary bandwidth. The carousel defaults to showing them in order,
 * so the first few are what the user sees first.
 */
const preloadedUrls = new Set<string>();

export function preloadImages(urls: string[], limit = 5): void {
  for (const url of urls.slice(0, limit)) {
    if (!url || preloadedUrls.has(url)) continue;
    preloadedUrls.add(url);
    try {
      const img = new Image();
      img.src = url;
    } catch {
      // ignore — best-effort warmup
    }
  }
}
