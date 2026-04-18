'use strict';

import * as vscode from 'vscode';

export type PreviewLogLevel = 'off' | 'info' | 'debug';

export interface PreviewLogger extends vscode.Disposable {
    info(msg: string, data?: unknown): void;
    debug(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, err?: unknown): void;
    show(preserveFocus?: boolean): void;
    readonly channel: vscode.OutputChannel;
}

const CHANNEL_NAME = 'CML Preview';

let instance: PreviewLoggerImpl | undefined;

function readLevelFromConfig(): PreviewLogLevel {
    const raw = vscode.workspace.getConfiguration('cml.preview').get<string>('logLevel', 'info');
    if (raw === 'off' || raw === 'info' || raw === 'debug') {
        return raw;
    }
    return 'info';
}

function levelRank(level: PreviewLogLevel): number {
    switch (level) {
        case 'off':
            return 0;
        case 'info':
            return 1;
        case 'debug':
            return 2;
        default:
            return 1;
    }
}

function formatTimestamp(): string {
    return new Date().toISOString();
}

function serializeData(data: unknown): string {
    try {
        return JSON.stringify(data, undefined, 2);
    } catch {
        return String(data);
    }
}

function formatError(err: unknown): { message: string; stack?: string } {
    if (err instanceof Error) {
        return { message: err.message, stack: err.stack };
    }
    return { message: String(err) };
}

class PreviewLoggerImpl implements PreviewLogger {
    private _level: PreviewLogLevel = 'info';
    private _disposed = false;
    private readonly _ownsChannel: boolean;
    private readonly _configListener: vscode.Disposable;

    constructor(
        private readonly _channel: vscode.OutputChannel,
        injectedChannel: boolean
    ) {
        this._ownsChannel = !injectedChannel;
        this.refreshLevel();
        this._configListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('cml.preview.logLevel')) {
                this.refreshLevel();
            }
        });
    }

    refreshLevel(): void {
        this._level = readLevelFromConfig();
    }

    getLevel(): PreviewLogLevel {
        return this._level;
    }

    get channel(): vscode.OutputChannel {
        return this._channel;
    }

    show(preserveFocus?: boolean): void {
        this._channel.show(preserveFocus);
    }

    private append(level: 'INFO' | 'DEBUG' | 'WARN' | 'ERROR', msg: string, extra?: string): void {
        const line = `[${formatTimestamp()}] [${level}] ${msg}`;
        this._channel.appendLine(line);
        if (extra !== undefined && extra.length > 0) {
            this._channel.appendLine(extra);
        }
    }

    private shouldLogInfoOrDebug(kind: 'info' | 'debug'): boolean {
        if (this._level === 'off') {
            return false;
        }
        if (kind === 'info') {
            return levelRank(this._level) >= levelRank('info');
        }
        return levelRank(this._level) >= levelRank('debug');
    }

    info(msg: string, data?: unknown): void {
        if (!this.shouldLogInfoOrDebug('info')) {
            return;
        }
        const extra = data !== undefined ? serializeData(data) : undefined;
        this.append('INFO', msg, extra);
    }

    debug(msg: string, data?: unknown): void {
        if (!this.shouldLogInfoOrDebug('debug')) {
            return;
        }
        const extra = data !== undefined ? serializeData(data) : undefined;
        this.append('DEBUG', msg, extra);
    }

    warn(msg: string, data?: unknown): void {
        if (this._level === 'off') {
            return;
        }
        const extra = data !== undefined ? serializeData(data) : undefined;
        this.append('WARN', msg, extra);
    }

    error(msg: string, err?: unknown): void {
        if (this._level === 'off') {
            return;
        }
        let extra: string | undefined;
        if (err !== undefined) {
            const { message, stack } = formatError(err);
            extra = serializeData({ message, stack });
        }
        this.append('ERROR', msg, extra);
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._configListener.dispose();
        if (this._ownsChannel) {
            this._channel.dispose();
        }
        if (instance === this) {
            instance = undefined;
        }
    }
}

export interface RegisterPreviewLoggerOptions {
    channel?: vscode.OutputChannel;
}

/**
 * Register the singleton preview logger. Call once from `activate`.
 * Tests may pass `{ channel }` to capture output without creating a real channel.
 */
export function registerPreviewLogger(
    context: vscode.ExtensionContext,
    options?: RegisterPreviewLoggerOptions
): PreviewLogger {
    if (instance) {
        throw new Error('Preview logger is already registered');
    }
    const injected = options?.channel;
    const channel = injected ?? vscode.window.createOutputChannel(CHANNEL_NAME);
    const impl = new PreviewLoggerImpl(channel, Boolean(injected));
    instance = impl;
    context.subscriptions.push(impl);
    impl.info('Preview logger ready', { level: impl.getLevel() });
    return impl;
}

export function getPreviewLogger(): PreviewLogger {
    if (!instance) {
        throw new Error('Preview logger is not registered; call registerPreviewLogger from extension activate');
    }
    return instance;
}

/**
 * Disposes the current logger and clears the singleton. For unit tests only.
 */
export function disposePreviewLoggerForTest(): void {
    instance?.dispose();
}
