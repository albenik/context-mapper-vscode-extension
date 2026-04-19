'use strict';

import { strict as assert } from 'assert';

import * as vscode from 'vscode';

import {
    disposePreviewLoggerForTest,
    getPreviewLogger,
    registerPreviewLogger,
} from '../../preview/previewLogger';

function createMinimalExtensionContext(): vscode.ExtensionContext {
    return { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
}

function createCaptureChannel(): vscode.OutputChannel & { readonly captured: string[] } {
    const captured: string[] = [];
    const channel = {
        name: 'CML Preview Test',
        captured,
        append(value: string): void {
            captured.push(value);
        },
        appendLine(value: string): void {
            captured.push(value);
        },
        replace(): void {
            /* no-op */
        },
        clear(): void {
            /* no-op */
        },
        show(): void {
            /* no-op */
        },
        hide(): void {
            /* no-op */
        },
        dispose(): void {
            /* no-op */
        },
    };
    return channel as vscode.OutputChannel & { readonly captured: string[] };
}

suite('previewLogger', () => {
    teardown(() => {
        disposePreviewLoggerForTest();
    });

    suiteTeardown(async () => {
        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', undefined, vscode.ConfigurationTarget.Global, true);
    });

    test('off suppresses info, debug, and warn', async () => {
        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'off', vscode.ConfigurationTarget.Global, true);

        const channel = createCaptureChannel();
        registerPreviewLogger(createMinimalExtensionContext(), { channel });

        getPreviewLogger().info('should-not-appear');
        getPreviewLogger().debug('should-not-appear');
        getPreviewLogger().warn('should-not-appear');

        assert.strictEqual(channel.captured.length, 0);
    });

    test('info allows info, warn, and error but drops debug', async () => {
        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'info', vscode.ConfigurationTarget.Global, true);

        const channel = createCaptureChannel();
        registerPreviewLogger(createMinimalExtensionContext(), { channel });

        channel.captured.length = 0;

        getPreviewLogger().info('hello-info');
        getPreviewLogger().debug('hello-debug');
        getPreviewLogger().warn('hello-warn');
        getPreviewLogger().error('hello-error', new Error('boom'));

        const joined = channel.captured.join('\n');

        assert.ok(joined.includes('[INFO]') && joined.includes('hello-info'));
        assert.ok(!joined.includes('hello-debug'));
        assert.ok(joined.includes('[WARN]') && joined.includes('hello-warn'));
        assert.ok(joined.includes('[ERROR]') && joined.includes('hello-error'));
    });

    test('debug writes debug lines', async () => {
        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'debug', vscode.ConfigurationTarget.Global, true);

        const channel = createCaptureChannel();
        registerPreviewLogger(createMinimalExtensionContext(), { channel });

        channel.captured.length = 0;

        getPreviewLogger().debug('hello-debug');

        const joined = channel.captured.join('\n');
        assert.ok(joined.includes('[DEBUG]') && joined.includes('hello-debug'));
    });

    test('error() serializes Error message and stack', async () => {
        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'info', vscode.ConfigurationTarget.Global, true);

        const channel = createCaptureChannel();
        registerPreviewLogger(createMinimalExtensionContext(), { channel });

        channel.captured.length = 0;

        const err = new Error('serialized');
        err.stack = 'Error: serialized\n    at fake-stack-frame';
        getPreviewLogger().error('failed', err);

        const joined = channel.captured.join('\n');
        assert.ok(joined.includes('[ERROR]') && joined.includes('failed'));
        assert.ok(joined.includes('fake-stack-frame'));
    });

    test('updating cml.preview.logLevel re-reads the level (info -> debug)', async function () {
        this.timeout(10_000);

        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'info', vscode.ConfigurationTarget.Global, true);

        const channel = createCaptureChannel();
        registerPreviewLogger(createMinimalExtensionContext(), { channel });

        channel.captured.length = 0;
        getPreviewLogger().debug('before-flip');
        assert.ok(!channel.captured.join('\n').includes('before-flip'));

        await vscode.workspace
            .getConfiguration('cml.preview')
            .update('logLevel', 'debug', vscode.ConfigurationTarget.Global, true);

        await new Promise<void>((resolve) => setTimeout(resolve, 150));

        channel.captured.length = 0;
        getPreviewLogger().debug('after-flip');
        assert.ok(channel.captured.join('\n').includes('after-flip'));
    });
});
