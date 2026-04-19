'use strict';

import { LanguageClient } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let startupError: unknown | undefined;

/** Max time to wait for the LSP handshake after activation (ms). */
const READY_WAIT_MS = 60_000;

/**
 * Called from extension activation after constructing the language client.
 */
export function setLanguageClient(c: LanguageClient): void {
    client = c;
    startupError = undefined;
}

/**
 * Call from activation's `lc.start().catch(...)` so that subsequent
 * `whenLanguageClientReady()` calls reject fast with the real reason.
 */
export function recordLanguageClientStartupError(err: unknown): void {
    startupError = err;
}

export function getLanguageClientStartupError(): unknown | undefined {
    return startupError;
}

/**
 * Clears holder state. For unit tests only.
 */
export function resetLanguageClientHolderForTest(): void {
    client = undefined;
    startupError = undefined;
}

/**
 * Resolves once the CML language client has completed its startup sequence
 * — that is, after the server has responded to `initialize`, the client has
 * sent `initialized`, *and* all client features (crucially including
 * `ExecuteCommandFeature`) have been registered with VS Code.
 *
 * Call this before executing LSP-backed commands (e.g. `cml.generate.*`,
 * including `cml.generate.contextmap` used by the CML preview panel).
 *
 * Implementation note:
 * ====================
 * vscode-languageclient v9 exposes its lifecycle through a `State` enum,
 * but the `State.Running` transition happens *before* `initializeFeatures()`
 * runs (see `doInitialize` in `vscode-languageclient/lib/common/client.js`).
 * That means commands contributed by the server via the
 * `executeCommandProvider` capability are not yet registered with VS Code
 * at the moment `onDidChangeState(State.Running)` fires.
 *
 * Awaiting `client.start()` is the reliable signal: `start()` caches the
 * in-flight startup promise in `_onStart` and returns it on subsequent
 * calls, so calling it again here is safe and idempotent. It only resolves
 * after `initializeFeatures()` has registered all server-advertised
 * commands with VS Code.
 *
 * If `lc.start()` rejected during activation, subsequent `client.start()`
 * calls may resolve without re-throwing; we therefore short-circuit when
 * `recordLanguageClientStartupError` was called.
 */
export async function whenLanguageClientReady(): Promise<void> {
    if (!client) {
        throw new Error('CML language client is not initialized.');
    }

    if (startupError !== undefined) {
        const msg = startupError instanceof Error ? startupError.message : String(startupError);
        throw new Error(
            `CML language server failed to start: ${msg}. ` +
                'Open the "CML Preview" or "CML Language Server" Output channel for details.'
        );
    }

    const startPromise = client.start();

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
            () =>
                reject(
                    new Error(
                        'CML language server did not become ready in time. Open the Output panel ' +
                            '("CML Language Server") for details.'
                    )
                ),
            READY_WAIT_MS
        );
    });

    try {
        await Promise.race([startPromise, timeoutPromise]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}
