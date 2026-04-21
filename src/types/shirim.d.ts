/**
 * Type declarations for the window.shirim IPC bridge exposed by
 * electron/preload.ts via contextBridge.
 */

import type {
  InstallProgress,
  InstallStartResponse,
  InstallCancelResponse,
  EditResponse,
  EditSession,
  EditUndoResponse,
  RunResponse,
  RunLogsResponse,
  RunStartOptions,
  SecretsListResponse,
  SecretsCheckResponse,
} from '../api';

export interface ShirimInstallApi {
  start(owner: string, repo: string, ref?: string, authToken?: string): Promise<InstallStartResponse>;
  cancel(installId: string): Promise<InstallCancelResponse>;
  delete(installId: string): Promise<void>;
  getProgress(installId: string): Promise<InstallProgress>;
  getSize(installId: string): Promise<string | null>;
  refreshToken(installId: string, token: string): Promise<void>;
  onProgress(installId: string, callback: (progress: InstallProgress) => void): () => void;
}

export interface ShirimEditApi {
  send(installId: string, message: string, sessionId?: string | null): Promise<EditResponse>;
  getSession(installId: string): Promise<EditSession>;
  undo(installId: string, turnId: number): Promise<EditUndoResponse>;
}

export interface ShirimRunApi {
  start(installId: string, options?: RunStartOptions): Promise<RunResponse>;
  stop(installId: string): Promise<RunResponse>;
  getState(installId: string): Promise<RunResponse>;
  getLogs(installId: string, limit?: number): Promise<RunLogsResponse>;
  onLogs(installId: string, callback: (line: unknown) => void): () => void;
}

export interface ShirimSecretsApi {
  list(): Promise<SecretsListResponse>;
  add(name: string, value: string): Promise<{ ok: boolean }>;
  delete(name: string): Promise<void>;
  reveal(name: string): Promise<{ name: string; value: string }>;
  check(names: string[]): Promise<SecretsCheckResponse>;
}

export interface ShirimApi {
  install: ShirimInstallApi;
  edit: ShirimEditApi;
  run: ShirimRunApi;
  secrets: ShirimSecretsApi;
}

declare global {
  interface Window {
    shirim: ShirimApi;
  }
}
