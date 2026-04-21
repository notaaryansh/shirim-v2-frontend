import { ipcMain } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import * as vault from './vault.js';
import { startInstall, cancelInstall, deleteInstall, getInstall, refreshToken } from './agent-loop.js';
import { computeProgress } from './progress.js';
import * as launcher from './launcher.js';
import * as editLoop from './edit-loop.js';
/**
 * Register all IPC handlers.  Called once from main.ts before any window is
 * created.  Each feature module's handlers are grouped in a section below.
 */
export function registerIpcHandlers() {
    // ===== Secrets (vault) ====================================================
    ipcMain.handle('secrets:list', () => {
        return { secrets: vault.listMasked() };
    });
    ipcMain.handle('secrets:add', (_e, name, value) => {
        vault.setKey(name, value);
        return { ok: true };
    });
    ipcMain.handle('secrets:delete', (_e, name) => {
        vault.deleteKey(name);
    });
    ipcMain.handle('secrets:reveal', (_e, name) => {
        const value = vault.get(name);
        if (value === null)
            throw new Error(`Secret "${name}" not found`);
        return { name, value };
    });
    ipcMain.handle('secrets:check', (_e, names) => {
        return { status: vault.check(names) };
    });
    // ===== Install size =======================================================
    ipcMain.handle('install:get-size', (_e, installId) => {
        try {
            const dir = path.join(os.homedir(), '.shirim', 'installs', installId);
            const stdout = execSync(`du -sh "${dir}" 2>/dev/null`, { encoding: 'utf8' });
            if (!stdout)
                return null;
            const raw = stdout.split('\t')[0].trim();
            return raw.replace(/([KMGT])$/i, '$1B');
        }
        catch {
            return null;
        }
    });
    // ===== Install (agent loop) ===============================================
    ipcMain.handle('install:start', async (_e, owner, repo, ref, authToken) => {
        const installId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
        const run = await startInstall(installId, owner, repo, authToken ?? '', ref);
        return { install_id: run.installId };
    });
    ipcMain.handle('install:cancel', (_e, installId) => {
        return cancelInstall(installId);
    });
    ipcMain.handle('install:delete', (_e, installId) => {
        deleteInstall(installId);
    });
    ipcMain.handle('install:get-progress', (_e, installId) => {
        const run = getInstall(installId);
        if (!run)
            throw new Error(`Install not found: ${installId}`);
        return computeProgress(run);
    });
    ipcMain.handle('install:refresh-token', (_e, installId, token) => {
        refreshToken(installId, token);
    });
    // ===== Run (launcher) =====================================================
    ipcMain.handle('run:start', async (_e, installId, options) => {
        // Read install.json for the run command if not provided.
        const installDir = path.join(os.homedir(), '.shirim', 'installs', installId);
        let command = options?.command;
        if (!command) {
            const installJsonPath = path.join(installDir, 'install.json');
            if (fs.existsSync(installJsonPath)) {
                const data = JSON.parse(fs.readFileSync(installJsonPath, 'utf-8'));
                command = data?.result?.run_command;
            }
        }
        if (!command)
            throw new Error('No run command available');
        // Read sandbox info from analysis.json if available.
        let sandboxEnv = {};
        let pathPrepend = [];
        const analysisPath = path.join(installDir, 'analysis.json');
        if (fs.existsSync(analysisPath)) {
            try {
                const analysis = JSON.parse(fs.readFileSync(analysisPath, 'utf-8'));
                const language = analysis?.language;
                if (language && language !== 'unknown') {
                    const { getAdapter } = await import('./adapters/index.js');
                    const adapter = getAdapter(language);
                    const sbInfo = adapter.bootstrapSandbox(installDir);
                    sandboxEnv = sbInfo.env;
                    pathPrepend = sbInfo.pathPrepend;
                }
            }
            catch { /* proceed without sandbox env */ }
        }
        const handle = await launcher.startRun(installId, command, installDir, sandboxEnv, pathPrepend, vault.load(), options?.wait_for_url ?? 30);
        return launcher.toResponse(handle);
    });
    ipcMain.handle('run:stop', async (_e, installId) => {
        const handle = launcher.getRunForInstall(installId);
        if (!handle)
            throw new Error(`No active run for install: ${installId}`);
        await launcher.stopRun(handle.runId);
        return launcher.toResponse(handle);
    });
    ipcMain.handle('run:get-state', (_e, installId) => {
        const handle = launcher.getRunForInstall(installId);
        if (!handle)
            throw new Error(`No run found for install: ${installId}`);
        return launcher.toResponse(handle);
    });
    ipcMain.handle('run:get-logs', (_e, installId, limit) => {
        const handle = launcher.getRunForInstall(installId);
        if (!handle)
            return { lines: [] };
        const lines = handle.logTail.slice(-(limit ?? 200)).map((entry) => typeof entry === 'string' ? entry : entry.line ?? '');
        return { lines };
    });
    // ===== Edit (edit loop) ===================================================
    ipcMain.handle('edit:send', async (_e, installId, message, sessionId) => {
        let session = null;
        if (sessionId) {
            session = editLoop.getSession(sessionId);
        }
        if (!session) {
            session = editLoop.getSessionForInstall(installId);
        }
        if (!session) {
            const newId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
            session = await editLoop.createSession(installId, newId);
        }
        const turn = await editLoop.runEditTurn(session, message, '');
        return {
            session_id: session.session_id,
            turn: {
                turn_id: turn.turn_id,
                user_message: turn.user_message,
                status: turn.status,
                files_changed: turn.files_changed,
                tsc_ok: turn.tsc_ok,
                tsc_errors: turn.tsc_errors,
                agent_reply: turn.agent_reply,
                duration_ms: turn.duration_ms,
            },
        };
    });
    ipcMain.handle('edit:get-session', (_e, installId) => {
        const session = editLoop.getSessionForInstall(installId);
        if (!session)
            throw new Error(`No edit session for install: ${installId}`);
        return {
            session_id: session.session_id,
            install_id: session.install_id,
            app_context: session.app_context,
            turn_count: session.turns.length,
            turns: session.turns.map(t => ({
                turn_id: t.turn_id,
                user_message: t.user_message,
                status: t.status,
                files_changed: t.files_changed,
                tsc_ok: t.tsc_ok,
                tsc_errors: t.tsc_errors,
                agent_reply: t.agent_reply,
                duration_ms: t.duration_ms,
            })),
        };
    });
    ipcMain.handle('edit:undo', (_e, installId, turnId) => {
        const session = editLoop.getSessionForInstall(installId);
        if (!session)
            throw new Error(`No edit session for install: ${installId}`);
        const ok = editLoop.undoTurn(session, turnId);
        return { ok, restored_to_before_turn: turnId };
    });
}
//# sourceMappingURL=ipc-handlers.js.map