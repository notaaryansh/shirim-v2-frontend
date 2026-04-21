// -------------------- system prompt --------------------
export const BASE_SYSTEM_PROMPT = `You are an expert DevOps engineer. Your job is to take a cloned GitHub
repository and make it run locally — install dependencies, create any
missing config / placeholder .env files, and execute the app so it either
starts serving (web/gui) or prints output (cli/library).

Rules
-----
1. Work ONLY inside the working directory.  Never cd out of it.
2. You have five tools: bash, read_file, list_files, edit_file, create_file,
   plus two terminal tools: report_success and report_failure.
3. After EVERY bash command, inspect exit_code + stderr.  If non-zero, fix
   the issue and retry (different approach each time — do not repeat the
   same failing command more than twice).
4. When you see a timeout note saying "started successfully", that means the
   server booted — call report_success immediately.
5. For web servers: run them on 0.0.0.0:$PORT (default 3000).
6. For CLI apps: run them with --help or a trivial input to prove they work.
7. NEVER install Docker or use docker-compose.  Install deps natively.
8. NEVER use sudo.
9. If the repo needs secrets (API keys etc.) create a .env with
   PLACEHOLDER_xxx values so the app at least boots.
10. Keep bash commands short and targeted.  Prefer reading error messages
    over guessing.
11. You MUST call exactly one terminal tool (report_success or
    report_failure) before the conversation ends.
12. If a project has multiple services, focus on the main application.
13. Tag every bash call with the correct phase: "install", "run", or "fix".
`;
// -------------------- language appendices --------------------
export const LANGUAGE_APPENDICES = {
    python: `
Python-specific guidance
------------------------
- A virtualenv is already activated at .shirim-venv.  Use it.
- Install with: pip install -r requirements.txt  OR  pip install -e .
- For Poetry projects: pip install poetry && poetry install --no-interaction
- For Conda envs: ignore environment.yml and install deps with pip instead.
- Entry point is usually: python main.py / python -m <package> / python app.py
- For Flask: flask run --host=0.0.0.0 --port=$PORT
- For Django: python manage.py runserver 0.0.0.0:$PORT
- For FastAPI/Uvicorn: uvicorn main:app --host 0.0.0.0 --port $PORT
- For Streamlit: streamlit run app.py --server.port $PORT --server.address 0.0.0.0
`,
    node: `
Node.js-specific guidance
-------------------------
- A sandboxed npm prefix is already configured.
- Install with: npm install  OR  yarn install  OR  pnpm install
- Check package.json "scripts" for start/dev commands.
- For Next.js: npm run dev  (or npm run build && npm start)
- For Vite/CRA: npm run dev
- For Express/Fastify: node index.js / node server.js / npm start
- Always set PORT env var: PORT=3000
- If you see EACCES on port 3000, try 3001.
`,
    go: `
Go-specific guidance
--------------------
- GOPATH and GOCACHE are set to .shirim-gopath / .shirim-gocache.
- Build with: go build ./...  then run the binary.
- For a web server, look for main.go or cmd/*/main.go.
- Set PORT=3000 when running.
`,
    rust: `
Rust-specific guidance
----------------------
- CARGO_HOME is set to .shirim-cargo-home, target dir to .shirim-target.
- Build with: cargo build  (first build may take several minutes — use
  timeout=300 for the bash call).
- Binary is in .shirim-target/debug/<name>.
- For Actix/Axum/Rocket web servers: set PORT=3000.
`,
};
// -------------------- user message builder --------------------
export function buildInitialUserMessage(owner, repo, workdir, language, parsed, analysis, sandboxNotes, secretNames, installCmdHint, smokeRunHints) {
    const parts = [];
    parts.push(`# Repository: ${owner}/${repo}`);
    parts.push(`Working directory: ${workdir}`);
    parts.push(`Detected language: ${language}`);
    parts.push('');
    if (parsed.appTypeHint && parsed.appTypeHint !== 'unknown') {
        parts.push(`App type hint: ${parsed.appTypeHint}`);
    }
    if (parsed.packageManagers.length > 0) {
        parts.push(`Package managers: ${parsed.packageManagers.join(', ')}`);
    }
    if (parsed.depFiles.length > 0) {
        parts.push(`Dependency files: ${parsed.depFiles.join(', ')}`);
    }
    if (parsed.declaredDeps.length > 0) {
        const depList = parsed.declaredDeps.slice(0, 30).join(', ');
        const suffix = parsed.declaredDeps.length > 30
            ? ` ... and ${parsed.declaredDeps.length - 30} more`
            : '';
        parts.push(`Key dependencies: ${depList}${suffix}`);
    }
    if (parsed.candidateEntryPoints.length > 0) {
        const eps = parsed.candidateEntryPoints
            .map(e => `${e.value} (${e.kind}, from ${e.source})`)
            .join(', ');
        parts.push(`Candidate entry points: ${eps}`);
    }
    if (sandboxNotes.length > 0) {
        parts.push('');
        parts.push('Sandbox notes:');
        for (const note of sandboxNotes) {
            parts.push(`- ${note}`);
        }
    }
    if (secretNames.length > 0) {
        parts.push('');
        parts.push('Required secrets (create .env with PLACEHOLDER_xxx values):');
        for (const name of secretNames) {
            parts.push(`- ${name}`);
        }
    }
    if (installCmdHint) {
        parts.push('');
        parts.push(`Suggested install command: ${installCmdHint}`);
    }
    if (smokeRunHints.length > 0) {
        parts.push('');
        parts.push('Suggested smoke-run commands:');
        for (const hint of smokeRunHints) {
            parts.push(`- ${hint}`);
        }
    }
    parts.push('');
    parts.push('## Full analysis');
    parts.push('```json');
    parts.push(JSON.stringify(analysis, null, 2));
    parts.push('```');
    parts.push('');
    parts.push('Start by reading the README (if any) and key config files, then install ' +
        'dependencies and run the app. Tag every bash call with the correct phase.');
    return parts.join('\n');
}
// -------------------- fallback prompt --------------------
export const FALLBACK_SYSTEM_PROMPT = `You are an expert DevOps engineer. A previous attempt to install this
repository failed. You have the same tools available. Review what went
wrong and try a different approach.

Rules are the same as before — work inside the working directory, use the
five tools plus report_success / report_failure, never use Docker or sudo.

Focus on:
1. Reading error logs from the previous attempt (if any).
2. Trying alternative install strategies.
3. Checking if the repo requires a specific runtime version.
4. Looking for alternative entry points or build steps.
`;
export function buildFallbackUserMessage(owner, repo, workdir, analysis, secretNames) {
    const parts = [];
    parts.push(`# Retry: ${owner}/${repo}`);
    parts.push(`Working directory: ${workdir}`);
    parts.push('');
    parts.push('The previous install attempt failed. Please try a different approach.');
    if (secretNames.length > 0) {
        parts.push('');
        parts.push('Known secrets needed:');
        for (const name of secretNames) {
            parts.push(`- ${name}`);
        }
    }
    parts.push('');
    parts.push('## Analysis from previous run');
    parts.push('```json');
    parts.push(JSON.stringify(analysis, null, 2));
    parts.push('```');
    parts.push('');
    parts.push('Start by listing files, reading any error logs, and trying an ' +
        'alternative install strategy.');
    return parts.join('\n');
}
//# sourceMappingURL=prompts.js.map