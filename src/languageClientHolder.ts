'use strict';

import { LanguageClient, State } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

/** Max time to wait for the LSP handshake after activation (ms). */
const READY_WAIT_MS = 60_000;

/**
 * Called from extension activation after constructing the language client.
 */
export function setLanguageClient(c: LanguageClient): void {
    client = c;
}

/**
 * Resolves when the CML language client has reached {@link State.Running}.
 * Call before executing LSP-backed commands (e.g. generators from preview).
 *
 * vscode-languageclient v9 removed `onReady()`; readiness is reflected in {@link State}.
 */
export async function whenLanguageClientReady(): Promise<void> {
    if (!client) {
        throw new Error('CML language client is not initialized.');
    }

    if (client.state === State.Running) {
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            disposable.dispose();
            reject(
                new Error(
                    'CML language server did not become ready in time. Open the Output panel ' +
                        '("CML Language Server") for details.'
                )
            );
        }, READY_WAIT_MS);

        const disposable = client!.onDidChangeState(e => {
            if (e.newState === State.Running) {
                clearTimeout(timeout);
                disposable.dispose();
                resolve();
            }
        });

        if (client!.state === State.Running) {
            clearTimeout(timeout);
            disposable.dispose();
            resolve();
        }
    });
}
