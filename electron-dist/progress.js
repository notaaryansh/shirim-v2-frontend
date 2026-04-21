/**
 * Progress computation for the agent runner.
 * Port of shirim-v2-backend/app/agent/progress.py
 */
// -------------------- step definitions --------------------
export const STEP_DEFS = [
    ['prepare', 'Preparing'],
    ['analyze', 'Analyzing'],
    ['install', 'Installing'],
    ['test', 'Testing'],
    ['finalize', 'Finalizing'],
];
/** Sentinels for activeIndex */
export const _SUCCESS = -1;
export const _FAILED = -2;
export const _CANCELLED = -3;
// -------------------- helpers --------------------
/**
 * Map runner status + phase to an index into STEP_DEFS,
 * or a sentinel (_SUCCESS, _FAILED, _CANCELLED).
 */
export function activeIndex(status, phase) {
    if (status === 'cancelled')
        return _CANCELLED;
    if (status === 'success')
        return _SUCCESS;
    if (status === 'failure' || status === 'error')
        return _FAILED;
    // Running — map phase to step index
    if (!phase)
        return 0; // prepare
    const phaseMap = {
        prepare: 0,
        clone: 0,
        analyze: 1,
        analysis: 1,
        install: 2,
        run: 3,
        test: 3,
        smoke: 3,
        fix: 2, // fix goes back to install stage
        finalize: 4,
        done: 4,
    };
    return phaseMap[phase] ?? 0;
}
/**
 * Walk the log stream to find the last stage before failure.
 * Returns the step index where we think the failure happened.
 */
export function inferFailedIndex(run) {
    let lastPhaseIdx = 0;
    for (const log of run.logs) {
        const phase = log['phase'];
        if (phase) {
            const idx = activeIndex('running', phase);
            if (idx >= 0 && idx > lastPhaseIdx) {
                lastPhaseIdx = idx;
            }
        }
    }
    return lastPhaseIdx;
}
/**
 * Map status string to an overall state.
 */
export function overall(status) {
    switch (status) {
        case 'pending':
        case 'queued':
            return 'pending';
        case 'running':
        case 'in_progress':
            return 'running';
        case 'success':
        case 'completed':
            return 'success';
        case 'failure':
        case 'error':
        case 'failed':
            return 'failure';
        case 'cancelled':
        case 'canceled':
            return 'cancelled';
        default:
            return 'pending';
    }
}
/**
 * Extract the most relevant error message from logs.
 */
export function extractError(run) {
    // Check result for error info
    if (run.result) {
        const reason = run.result['reason'];
        if (reason)
            return reason;
        const lastError = run.result['last_error'];
        if (lastError)
            return lastError;
    }
    // Walk logs backwards to find last error-like entry
    for (let i = run.logs.length - 1; i >= 0; i--) {
        const log = run.logs[i];
        const stderr = log['stderr'];
        if (stderr && stderr.length > 10 && !stderr.startsWith('<timeout')) {
            // Return last meaningful stderr, trimmed
            return stderr.length > 500 ? stderr.slice(-500) : stderr;
        }
        const error = log['error'];
        if (error)
            return error;
    }
    return null;
}
/**
 * Compute the full progress payload for a run.
 */
export function computeProgress(run) {
    const overallStatus = overall(run.status);
    const idx = activeIndex(run.status, run.phase);
    const failedIdx = overallStatus === 'failure' ? inferFailedIndex(run) : -1;
    const steps = STEP_DEFS.map(([id, label], i) => {
        let stepStatus;
        if (overallStatus === 'cancelled') {
            stepStatus = i <= (idx >= 0 ? idx : 0) ? 'skipped' : 'pending';
        }
        else if (overallStatus === 'success') {
            stepStatus = 'done';
        }
        else if (overallStatus === 'failure') {
            if (i < failedIdx) {
                stepStatus = 'done';
            }
            else if (i === failedIdx) {
                stepStatus = 'failed';
            }
            else {
                stepStatus = 'pending';
            }
        }
        else if (overallStatus === 'running') {
            if (idx < 0) {
                stepStatus = 'pending';
            }
            else if (i < idx) {
                stepStatus = 'done';
            }
            else if (i === idx) {
                stepStatus = 'active';
            }
            else {
                stepStatus = 'pending';
            }
        }
        else {
            // pending
            stepStatus = 'pending';
        }
        return { id, label, status: stepStatus };
    });
    const errorMsg = overallStatus === 'failure' ? extractError(run) : null;
    const now = Date.now();
    const elapsed = run.finishedAt
        ? (run.finishedAt - run.startedAt) / 1000
        : run.startedAt
            ? (now - run.startedAt) / 1000
            : 0;
    return {
        install_id: run.installId,
        owner: run.owner,
        repo: run.repo,
        overall: overallStatus,
        steps,
        error: errorMsg,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
        elapsed_seconds: Math.round(elapsed * 10) / 10,
    };
}
//# sourceMappingURL=progress.js.map