/**
 * Edit-with-AI module — manages interactive editing sessions where an LLM
 * modifies project files through tool calls, with snapshot/undo support.
 *
 * Port of shirim-v2-backend/app/agent/editor.py
 */
import fs from 'fs';
import path from 'path';
import { INSTALLS_DIR } from './sandbox.js';
import { scanAppContext } from './edit-context.js';
import { EDIT_TOOL_SCHEMAS, buildEditSystemPrompt } from './edit-prompts.js';
import { getRunForInstall, startRun, stopRunsForInstall } from './launcher.js';
import { getAdapter } from './adapters/index.js';
import { load as loadVault } from './vault.js';
import { bash, readFile, listFiles, editFile, createFile, createToolContext, } from './tools.js';
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_EDIT_ITERATIONS = 20;
const API_BASE = process.env.API_BASE || 'http://localhost:8001';
// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------
const _sessions = new Map();
// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------
export function getSession(sessionId) {
    return _sessions.get(sessionId) ?? null;
}
export function getSessionForInstall(installId) {
    for (const session of _sessions.values()) {
        if (session.install_id === installId)
            return session;
    }
    return null;
}
export async function createSession(installId, sessionId) {
    const workdir = path.join(INSTALLS_DIR, installId);
    const appContext = await scanAppContext(workdir);
    const systemPrompt = buildEditSystemPrompt(appContext);
    const session = {
        session_id: sessionId,
        install_id: installId,
        workdir,
        app_context: appContext,
        turns: [],
        messages: [{ role: 'system', content: systemPrompt }],
        created_at: Date.now(),
    };
    _sessions.set(sessionId, session);
    return session;
}
// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------
const SNAPSHOT_DIRS = ['src', 'app', 'components', 'pages', 'lib', 'public'];
const SNAPSHOT_CONFIG_FILES = [
    'package.json',
    'tsconfig.json',
    'tailwind.config.ts',
    'tailwind.config.js',
    'remotion.config.ts',
    'next.config.ts',
    'next.config.js',
    'vite.config.ts',
];
export function undoTurn(session, turnId) {
    const snapshotDir = path.join(session.workdir, '.shirim-snapshots', `turn-${turnId}`);
    if (!fs.existsSync(snapshotDir)) {
        throw new Error(`Snapshot not found for turn ${turnId}`);
    }
    // Restore directories
    for (const dir of SNAPSHOT_DIRS) {
        const src = path.join(snapshotDir, dir);
        const dest = path.join(session.workdir, dir);
        if (fs.existsSync(src)) {
            if (fs.existsSync(dest)) {
                fs.rmSync(dest, { recursive: true, force: true });
            }
            fs.cpSync(src, dest, { recursive: true });
        }
    }
    // Restore config files
    for (const file of SNAPSHOT_CONFIG_FILES) {
        const src = path.join(snapshotDir, file);
        const dest = path.join(session.workdir, file);
        if (fs.existsSync(src)) {
            fs.cpSync(src, dest);
        }
    }
}
// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------
function _snapshot(session, turnId) {
    const snapshotDir = path.join(session.workdir, '.shirim-snapshots', `turn-${turnId}`);
    fs.mkdirSync(snapshotDir, { recursive: true });
    // Copy directories
    for (const dir of SNAPSHOT_DIRS) {
        const src = path.join(session.workdir, dir);
        if (fs.existsSync(src) && fs.statSync(src).isDirectory()) {
            fs.cpSync(src, path.join(snapshotDir, dir), { recursive: true });
        }
    }
    // Copy config files
    for (const file of SNAPSHOT_CONFIG_FILES) {
        const src = path.join(session.workdir, file);
        if (fs.existsSync(src) && fs.statSync(src).isFile()) {
            fs.cpSync(src, path.join(snapshotDir, file));
        }
    }
}
// ---------------------------------------------------------------------------
// File mtime tracking
// ---------------------------------------------------------------------------
function _fileMtimes(workdir) {
    const mtimes = new Map();
    const extensions = new Set(['.tsx', '.ts', '.jsx', '.js', '.css', '.json']);
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.shirim-'))
                continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            }
            else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
                const rel = path.relative(workdir, full);
                try {
                    mtimes.set(rel, fs.statSync(full).mtimeMs);
                }
                catch { /* file removed between readdir and stat */ }
            }
        }
    }
    walk(workdir);
    return mtimes;
}
// ---------------------------------------------------------------------------
// Dev server health
// ---------------------------------------------------------------------------
function _checkDevServerHealth(session) {
    const run = getRunForInstall(session.install_id);
    if (!run)
        return false; // no run → no crash
    if (run.status === 'starting' || run.status === 'running')
        return false; // alive
    return true; // crashed
}
async function _restartDevServer(session) {
    await stopRunsForInstall(session.install_id);
    // Read install.json for run_command
    const installJsonPath = path.join(session.workdir, 'install.json');
    if (!fs.existsSync(installJsonPath))
        return;
    const installMeta = JSON.parse(fs.readFileSync(installJsonPath, 'utf-8'));
    const runCommand = installMeta.run_command;
    if (!runCommand)
        return;
    // Rebuild sandbox env using adapter if language is known
    let sandboxEnv = {};
    let pathPrepend = [];
    const language = installMeta.language;
    if (language) {
        try {
            const adapter = getAdapter(language);
            const sbInfo = adapter.bootstrapSandbox(session.workdir);
            sandboxEnv = sbInfo.env;
            pathPrepend = sbInfo.pathPrepend;
        }
        catch {
            // Unknown language or adapter error — proceed without sandbox env
        }
    }
    const secrets = loadVault();
    await startRun(session.install_id, runCommand, session.workdir, sandboxEnv, pathPrepend, secrets, 15);
}
// ---------------------------------------------------------------------------
// LLM proxy call
// ---------------------------------------------------------------------------
async function callLlm(messages, toolSchemas, authToken) {
    const resp = await fetch(`${API_BASE}/api/v1/agent/completion`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ messages, tool_schemas: toolSchemas }),
    });
    if (!resp.ok)
        throw new Error(`LLM proxy error: ${resp.status}`);
    return resp.json();
}
// ---------------------------------------------------------------------------
// Edit loop (calls LLM + executes tools locally)
// ---------------------------------------------------------------------------
async function _editLoop(session, ctx, authToken) {
    let lastText = null;
    for (let i = 0; i < MAX_EDIT_ITERATIONS; i++) {
        const response = await callLlm(session.messages, EDIT_TOOL_SCHEMAS, authToken);
        const choices = response.choices;
        if (!choices || choices.length === 0)
            break;
        const choice = choices[0];
        const message = choice.message;
        // Append the assistant message to the conversation
        session.messages.push(message);
        // Extract text content
        if (typeof message.content === 'string' && message.content) {
            lastText = message.content;
        }
        // Check for tool calls
        const toolCalls = message.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
            // No tool calls — agent is done
            break;
        }
        // Execute each tool call
        for (const toolCall of toolCalls) {
            const fn = toolCall.function;
            const toolName = fn.name;
            const args = typeof fn.arguments === 'string'
                ? JSON.parse(fn.arguments)
                : fn.arguments;
            let result;
            switch (toolName) {
                case 'bash':
                    result = await bash(ctx, args.command, args.timeout);
                    break;
                case 'read_file':
                    result = readFile(ctx, args.path);
                    break;
                case 'list_files':
                    result = listFiles(ctx, args.path || '.');
                    break;
                case 'edit_file':
                    result = editFile(ctx, args.path, args.old_string, args.new_string);
                    break;
                case 'create_file':
                    result = createFile(ctx, args.path, args.content);
                    break;
                default:
                    result = { ok: false, error: `unknown tool: ${toolName}` };
            }
            // Append tool result to conversation
            session.messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
            });
        }
    }
    return lastText;
}
// ---------------------------------------------------------------------------
// Main entry: run an edit turn
// ---------------------------------------------------------------------------
export async function runEditTurn(session, message, authToken) {
    const turnId = session.turns.length + 1;
    const startedAt = Date.now();
    const turn = {
        turn_id: turnId,
        user_message: message,
        status: 'thinking',
        files_changed: [],
        tsc_ok: null,
        tsc_errors: null,
        agent_reply: null,
        started_at: startedAt,
        finished_at: null,
        duration_ms: 0,
    };
    session.turns.push(turn);
    try {
        // Take snapshot before making changes
        _snapshot(session, turnId);
        // Record file mtimes before edits
        const mtimesBefore = _fileMtimes(session.workdir);
        // Add user message to conversation
        session.messages.push({ role: 'user', content: message });
        // Create tool context
        const secrets = loadVault();
        const ctx = createToolContext(session.workdir, {}, [], secrets);
        // Run the edit loop
        turn.status = 'editing';
        const agentReply = await _editLoop(session, ctx, authToken);
        turn.agent_reply = agentReply;
        // Detect changed files by comparing mtimes
        turn.status = 'verifying';
        const mtimesAfter = _fileMtimes(session.workdir);
        const changedFiles = [];
        for (const [file, mtime] of mtimesAfter) {
            const prev = mtimesBefore.get(file);
            if (prev === undefined || prev !== mtime) {
                changedFiles.push(file);
            }
        }
        turn.files_changed = changedFiles;
        // Run tsc --noEmit to check for type errors
        const tscResult = await bash(ctx, 'npx tsc --noEmit 2>&1', 30);
        const tscExitCode = tscResult.exit_code;
        turn.tsc_ok = tscExitCode === 0;
        if (tscExitCode !== 0) {
            const stdout = tscResult.stdout || '';
            const stderr = tscResult.stderr || '';
            turn.tsc_errors = (stdout + '\n' + stderr).trim() || null;
        }
        // Check dev server health
        const crashed = _checkDevServerHealth(session);
        if (crashed) {
            // Auto-undo and restart
            undoTurn(session, turnId);
            await _restartDevServer(session);
            turn.status = 'error';
            turn.agent_reply = (turn.agent_reply || '') +
                '\n\n[Dev server crashed after edits — changes were automatically reverted.]';
        }
        else {
            turn.status = 'done';
        }
    }
    catch (err) {
        turn.status = 'error';
        turn.agent_reply = `Error: ${err.message}`;
    }
    turn.finished_at = Date.now();
    turn.duration_ms = turn.finished_at - turn.started_at;
    return turn;
}
//# sourceMappingURL=edit-loop.js.map