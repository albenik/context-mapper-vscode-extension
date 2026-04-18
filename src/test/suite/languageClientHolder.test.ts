'use strict';

import { strict as assert } from 'assert';
import { PassThrough } from 'stream';

import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import {
    createMessageConnection,
    MessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
} from 'vscode-jsonrpc/node';

import {
    recordLanguageClientStartupError,
    resetLanguageClientHolderForTest,
    setLanguageClient,
    whenLanguageClientReady,
} from '../../languageClientHolder';

interface FakeLsp {
    readonly client: LanguageClient;
    readonly serverConn: MessageConnection;
    dispose(): Promise<void>;
}

/**
 * Build a unique LSP-advertised command id per test so we can distinguish
 * our fake server's commands from any other VS Code command registrations.
 */
function uniqueLspCommand(): string {
    return `cml.test.fake.${Date.now().toString(36)}.${Math.random()
        .toString(36)
        .slice(2)}`;
}

/**
 * Build an in-process fake LSP server that advertises the given commands via
 * the `executeCommandProvider` capability, plus a real `LanguageClient` wired
 * to it through a pair of `PassThrough` streams. This exercises the real
 * `vscode-languageclient` state machine (including feature initialization)
 * without needing the Java-based Context Mapper LSP.
 */
function createFakeLsp(commands: readonly string[]): FakeLsp {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();

    const serverConn = createMessageConnection(
        new StreamMessageReader(clientToServer),
        new StreamMessageWriter(serverToClient)
    );

    serverConn.onRequest('initialize', () => ({
        capabilities: {
            textDocumentSync: 0,
            executeCommandProvider: { commands: [...commands] },
        },
    }));
    serverConn.onNotification('initialized', () => {
        /* no-op */
    });
    serverConn.onRequest('shutdown', () => null);
    serverConn.onNotification('exit', () => {
        /* no-op */
    });
    serverConn.onRequest(
        'workspace/executeCommand',
        (params: { command: string; arguments?: unknown[] }) => ({
            command: params?.command,
            arguments: params?.arguments ?? [],
        })
    );

    serverConn.listen();

    const client = new LanguageClient(
        'cml-test-fake-lsp',
        'CML Test Fake LSP',
        async () => ({
            reader: new StreamMessageReader(serverToClient),
            writer: new StreamMessageWriter(clientToServer),
        }),
        { documentSelector: [{ scheme: 'file', language: 'plaintext' }] }
    );

    return {
        client,
        serverConn,
        async dispose() {
            try {
                await client.stop();
            } catch {
                /* ignore shutdown errors during teardown */
            }
            try {
                serverConn.dispose();
            } catch {
                /* ignore dispose errors during teardown */
            }
        },
    };
}

suite('languageClientHolder / CML preview readiness', () => {
    let lsp: FakeLsp | undefined;

    teardown(async () => {
        if (lsp) {
            await lsp.dispose();
            lsp = undefined;
        }
        resetLanguageClientHolderForTest();
    });

    test('whenLanguageClientReady() throws when no client is set', async () => {
        setLanguageClient(undefined as unknown as LanguageClient);
        await assert.rejects(
            () => whenLanguageClientReady(),
            /not initialized/i
        );
    });

    test('whenLanguageClientReady() rejects fast when recordLanguageClientStartupError was called', async () => {
        setLanguageClient({} as LanguageClient);
        recordLanguageClientStartupError(new Error('boom'));

        const started = Date.now();
        await assert.rejects(
            () => whenLanguageClientReady(),
            /failed to start.*boom/i
        );
        assert.ok(
            Date.now() - started < 2000,
            'expected immediate rejection, not a 60s timeout'
        );
    });

    test('setLanguageClient clears a previously recorded startup error', async function () {
        this.timeout(15_000);

        recordLanguageClientStartupError(new Error('prior failure'));

        const lspCmd = uniqueLspCommand();
        lsp = createFakeLsp([lspCmd]);
        setLanguageClient(lsp.client);

        void lsp.client.start();

        await whenLanguageClientReady();

        const result = (await vscode.commands.executeCommand(
            lspCmd,
            'hello',
            42
        )) as { command: string; arguments: unknown[] };

        assert.strictEqual(result.command, lspCmd);
        assert.deepStrictEqual(result.arguments, ['hello', 42]);
    });

    test('whenLanguageClientReady() only resolves after ExecuteCommandFeature has registered LSP commands', async function () {
        this.timeout(15_000);

        const lspCmd = uniqueLspCommand();
        lsp = createFakeLsp([lspCmd]);
        setLanguageClient(lsp.client);

        void lsp.client.start();

        await whenLanguageClientReady();

        // The CML preview pane opens `cml.generate.contextmap` via VS Code's
        // command registry immediately after this awaits. That command is
        // *registered* by `ExecuteCommandFeature.initialize()` — which in
        // vscode-languageclient v9 runs *after* the client transitions to
        // `State.Running`. If `whenLanguageClientReady()` resolves as soon as
        // the state becomes `Running`, the LSP-advertised command is not yet
        // registered with VS Code and calling it immediately will fail with
        // "command 'cml.generate.contextmap' not found" — i.e. the preview
        // cannot reach the Context Mapper renderer.
        //
        // We assert the fix synchronously against the feature's internal
        // registration state so the regression test is deterministic
        // regardless of microtask interleaving with the VS Code command
        // registry.
        const execCommandFeature = lsp.client.getFeature(
            'workspace/executeCommand'
        );
        assert.ok(
            execCommandFeature,
            'ExecuteCommandFeature should be present on the LanguageClient'
        );

        const featureState = execCommandFeature.getState() as {
            registrations?: boolean;
        };
        assert.strictEqual(
            featureState.registrations,
            true,
            'whenLanguageClientReady() resolved before LSP-advertised commands were registered with VS Code; ' +
                'the CML preview pane will fail to call cml.generate.contextmap.'
        );
    });

    test('LSP-advertised commands are usable via vscode.commands immediately after whenLanguageClientReady()', async function () {
        this.timeout(15_000);

        const lspCmd = uniqueLspCommand();
        lsp = createFakeLsp([lspCmd]);
        setLanguageClient(lsp.client);

        void lsp.client.start();

        await whenLanguageClientReady();

        const result = (await vscode.commands.executeCommand(
            lspCmd,
            'hello',
            42
        )) as { command: string; arguments: unknown[] };

        assert.strictEqual(
            result.command,
            lspCmd,
            'fake LSP should have received the command id'
        );
        assert.deepStrictEqual(
            result.arguments,
            ['hello', 42],
            'fake LSP should have received the forwarded arguments'
        );
    });
});
