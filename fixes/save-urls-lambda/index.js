'use strict';

const mysql = require('mysql2/promise');

const NOT_APPLICABLE_PROPERTIES = [
    'mp4Outputs',
    'mp4Urls',
    'hlsPlaylist',
    'hlsUrl',
    'dashPlaylist',
    'dashUrl',
    'mssPlaylist',
    'mssUrl',
    'cmafDashPlaylist',
    'cmafDashUrl',
    'cmafHlsPlaylist',
    'cmafHlsUrl'
];

const CONNECT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [500, 1500];

const TRANSIENT_MYSQL_CODES = new Set([
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'ER_LOCK_DEADLOCK',
    'ER_LOCK_WAIT_TIMEOUT',
    'ER_CON_COUNT_ERROR',
    'ER_TOO_MANY_USER_CONNECTIONS'
]);

const CONFIG_ERROR_CODES = new Set([
    'ER_NO_SUCH_TABLE',
    'ER_BAD_DB_ERROR',
    'ER_BAD_FIELD_ERROR'
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logStructured(payload) {
    console.log(JSON.stringify(payload));
}

function isTransient(err) {
    if (!err) return false;
    if (TRANSIENT_MYSQL_CODES.has(err.code)) return true;
    // Network-level timeouts sometimes surface as generic Error without a code.
    if (/timeout/i.test(err.message || '')) return true;
    return false;
}

function isConfigError(err) {
    return !!err && CONFIG_ERROR_CODES.has(err.code);
}

async function updateVideosInDatabase(dbName, srcVideo, egressEndpoints) {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: dbName,
        connectTimeout: CONNECT_TIMEOUT_MS,
        multipleStatements: false
    });

    try {
        const [rows] = await conn.execute(
            'SELECT id FROM videos WHERE src_video = ?',
            [srcVideo]
        );

        if (rows.length === 0) {
            logStructured({
                stage: 'save-urls',
                db: dbName,
                srcVideo,
                matched: 0,
                note: 'no rows matched — nothing to update in this database'
            });
            return { db: dbName, matched: 0, updated: 0 };
        }

        const videoUrlJson = JSON.stringify(egressEndpoints);
        let updated = 0;
        for (const row of rows) {
            const [result] = await conn.execute(
                "UPDATE videos SET status = 'COMPLETED', video_url = ? WHERE id = ?",
                [videoUrlJson, row.id]
            );
            updated += result.affectedRows || 0;
        }

        return { db: dbName, matched: rows.length, updated };
    } finally {
        try {
            await conn.end();
        } catch (endErr) {
            logStructured({
                stage: 'save-urls',
                db: dbName,
                warn: 'connection.end() failed',
                error: endErr.message
            });
        }
    }
}

async function updateVideosWithRetry(dbName, srcVideo, egressEndpoints) {
    let lastErr;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const result = await updateVideosInDatabase(dbName, srcVideo, egressEndpoints);
            logStructured({
                stage: 'save-urls',
                db: dbName,
                srcVideo,
                attempt,
                matched: result.matched,
                updated: result.updated,
                status: 'ok'
            });
            return result;
        } catch (err) {
            lastErr = err;

            if (isConfigError(err)) {
                // Missing table/db/column is a config problem, not a runtime one.
                // Do not retry, do not crash the whole invocation for the other DB.
                logStructured({
                    stage: 'save-urls',
                    db: dbName,
                    srcVideo,
                    attempt,
                    status: 'skipped-config-error',
                    code: err.code,
                    error: err.message
                });
                return { db: dbName, matched: 0, updated: 0, skipped: true, reason: err.code };
            }

            const transient = isTransient(err);
            logStructured({
                stage: 'save-urls',
                db: dbName,
                srcVideo,
                attempt,
                status: transient ? 'transient-error' : 'error',
                code: err.code,
                error: err.message,
                willRetry: transient && attempt < MAX_ATTEMPTS
            });

            if (!transient || attempt === MAX_ATTEMPTS) {
                break;
            }
            await sleep(RETRY_BACKOFF_MS[attempt - 1] || 2000);
        }
    }
    throw lastErr;
}

exports.handler = async (event) => {
    if (event.workflowStatus !== 'Complete') {
        logStructured({
            stage: 'save-urls',
            skipped: true,
            reason: 'workflowStatus !== Complete',
            workflowStatus: event.workflowStatus,
            guid: event.guid
        });
        return event;
    }

    if (!event.srcVideo) {
        throw new Error(`save-urls: missing srcVideo (guid=${event.guid})`);
    }
    if (!event.egressEndpoints || Object.keys(event.egressEndpoints).length === 0) {
        throw new Error(
            `save-urls: missing or empty egressEndpoints (guid=${event.guid}, srcVideo=${event.srcVideo})`
        );
    }

    const targets = [process.env.DB_NAME, process.env.DB_NAME2].filter(Boolean);
    if (targets.length === 0) {
        throw new Error('save-urls: neither DB_NAME nor DB_NAME2 is set');
    }

    // Run both DB updates in parallel with per-DB retries.
    // Both must at least be attempted; the invocation only fails if updates
    // to any DB truly could not complete after retries (excluding config errors,
    // which are logged and skipped so the other DB is not held hostage).
    const results = await Promise.allSettled(
        targets.map(db => updateVideosWithRetry(db, event.srcVideo, event.egressEndpoints))
    );

    const perDb = results.map((r, i) => ({
        db: targets[i],
        status: r.status,
        value: r.status === 'fulfilled' ? r.value : undefined,
        error: r.status === 'rejected' ? (r.reason && r.reason.message) || String(r.reason) : undefined
    }));

    logStructured({
        stage: 'save-urls',
        guid: event.guid,
        srcVideo: event.srcVideo,
        summary: perDb
    });

    const hardFailures = perDb.filter(x => x.status === 'rejected');
    if (hardFailures.length > 0) {
        // Any hard failure surfaces so Step Functions marks the execution FAILED
        // and the state machine's retry / error-handler can react. The successful
        // side (if any) was already persisted, so retries are idempotent —
        // the UPDATE is a no-op on rows already set to COMPLETED with the same URL.
        const detail = hardFailures.map(f => `${f.db}: ${f.error}`).join(' | ');
        throw new Error(
            `save-urls: ${hardFailures.length}/${targets.length} database(s) failed after retries — ${detail}`
        );
    }

    const msg = { ...event };
    delete msg.srcMediainfo;
    delete msg.jobTemplate_2160p;
    delete msg.jobTemplate_1080p;
    delete msg.jobTemplate_720p;
    delete msg.encodingJob;
    delete msg.encodingOutput;

    if (event.enableMediaPackage) {
        NOT_APPLICABLE_PROPERTIES.forEach(prop => delete msg[prop]);
    }

    return msg;
};
