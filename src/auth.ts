export const AUTH_API_BASE = 'http://localhost:8001';

/**
 * DEV-ONLY bypass flag.
 *
 * When true:
 *   • sendOtp() resolves immediately with a fake success (no network call)
 *   • verifyOtp() accepts any email + any 6-digit OTP and returns a fake session
 *     with a user derived from the email you typed
 *   • fetchMe() returns the cached user
 *   • signOut() just clears localStorage
 *   • src/api.ts returns hardcoded mock data for Home / Discover / RepoDetail so
 *     the UI is fully usable without a backend
 *
 * Flip this to `false` when you're ready to hit the real backend again.
 */
export const DEV_BYPASS_AUTH = true;

const ACCESS_TOKEN_KEY = 'shirim-access-token';
const REFRESH_TOKEN_KEY = 'shirim-refresh-token';
const EXPIRES_AT_KEY = 'shirim-expires-at';
const USER_KEY = 'shirim-user';

/** User shape returned by /api/v1/auth/verify-otp and /api/v1/auth/me. */
export type User = {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
};

export type SessionResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: User;
};

export function getToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getUser(): User | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as User; } catch { return null; }
}

export function getUserEmail(): string | null {
  return getUser()?.email ?? null;
}

export function setSession(data: SessionResponse): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  localStorage.setItem(EXPIRES_AT_KEY, String(Date.now() + data.expires_in * 1000));
  if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function setUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(EXPIRES_AT_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/** True if the access token is within 60s of expiry (or already expired). */
function isTokenStale(): boolean {
  const expiresAt = Number(localStorage.getItem(EXPIRES_AT_KEY) || 0);
  if (!expiresAt) return false; // no expiry stored yet (e.g. legacy session)
  return Date.now() >= expiresAt - 60_000;
}

async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${AUTH_API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) { clearSession(); return false; }
    const data = await res.json();
    setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}

/**
 * authFetch — drop-in fetch wrapper that:
 *   1. Pre-emptively refreshes the access token if it's within 60s of expiry
 *   2. Injects Authorization: Bearer <token> header
 *   3. On a 401 response, tries to refresh once and retries the request
 *   4. On refresh failure, dispatches a `shirim-auth-expired` window event so
 *      App.tsx can flip back to the auth screen without a full reload.
 *
 * When DEV_BYPASS_AUTH is true, this becomes a plain passthrough fetch — no
 * Authorization header, no refresh attempts, no auth-expired events. That way
 * data calls hit the real backend (which should also be running with its own
 * DEV_BYPASS_AUTH=true) without getting stuck in a refresh loop with fake tokens.
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  if (DEV_BYPASS_AUTH) {
    return fetch(url, options);
  }

  // Pre-emptive refresh — avoids a wasted request + retry roundtrip on near-expired tokens.
  if (isTokenStale()) {
    await refreshAccessToken();
  }

  const token = getToken();
  const authOptions: RequestInit = {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };

  let response = await fetch(url, authOptions);

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      const newToken = getToken();
      authOptions.headers = {
        ...options.headers,
        Authorization: `Bearer ${newToken}`,
      };
      response = await fetch(url, authOptions);
    } else {
      window.dispatchEvent(new CustomEvent('shirim-auth-expired'));
    }
  }
  return response;
}

/** Dev-bypass: build a plausible fake user from whatever email was typed. */
function fakeUserFromEmail(email: string): User {
  const handle = email.split('@')[0] || 'dev';
  return {
    id: 'dev-' + handle.toLowerCase().replace(/[^a-z0-9]/g, ''),
    email: email || 'dev@shirim.local',
    name: handle.charAt(0).toUpperCase() + handle.slice(1),
  };
}

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function parseAndThrow(res: Response): Promise<any> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // FastAPI's default error shape is { detail: "..." }; supabase / custom handlers
    // may use { message: "..." }. Accept either.
    throw new Error(data.detail || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export async function sendOtp(email: string): Promise<{ success: boolean; message: string }> {
  if (DEV_BYPASS_AUTH) {
    await delay(250);
    return { success: true, message: 'dev bypass — any 6 digits will work' };
  }
  const res = await fetch(`${AUTH_API_BASE}/api/v1/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseAndThrow(res);
}

export async function verifyOtp(email: string, _otp: string): Promise<SessionResponse & { user: User }> {
  if (DEV_BYPASS_AUTH) {
    await delay(250);
    return {
      access_token: 'dev-bypass-access-token',
      refresh_token: 'dev-bypass-refresh-token',
      expires_in: 3600,
      user: fakeUserFromEmail(email),
    };
  }
  const res = await fetch(`${AUTH_API_BASE}/api/v1/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp: _otp }),
  });
  return parseAndThrow(res);
}

export async function fetchMe(): Promise<User> {
  if (DEV_BYPASS_AUTH) {
    return getUser() ?? fakeUserFromEmail('dev@shirim.local');
  }
  const res = await authFetch(`${AUTH_API_BASE}/api/v1/auth/me`);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function signOut(): Promise<void> {
  if (DEV_BYPASS_AUTH) {
    clearSession();
    return;
  }
  try {
    await authFetch(`${AUTH_API_BASE}/api/v1/auth/sign-out`, { method: 'POST' });
  } catch {
    /* ignore network errors on sign-out */
  }
  clearSession();
}
