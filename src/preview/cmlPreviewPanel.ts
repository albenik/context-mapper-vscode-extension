'use strict';

import * as vscode from 'vscode';
import { parseCml } from './cmlParser';
import { renderSvg } from './svgRenderer';

export class CmlPreviewPanel implements vscode.Disposable {
    public static readonly viewType = 'cml.preview';

    private static _instance: CmlPreviewPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private _document: vscode.TextDocument | undefined;
    private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

    private static readonly DEBOUNCE_MS = 400;

    public static show(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'cml') {
            vscode.window.showWarningMessage('Open a .cml file first to preview the context map.');
            return;
        }

        if (CmlPreviewPanel._instance) {
            CmlPreviewPanel._instance._panel.reveal(vscode.ViewColumn.Two, true);
            CmlPreviewPanel._instance.bindToDocument(editor.document);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            CmlPreviewPanel.viewType,
            'CML Preview',
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            {
                enableScripts: false,
                localResourceRoots: [],
            }
        );

        CmlPreviewPanel._instance = new CmlPreviewPanel(panel, editor.document);
    }

    private constructor(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
        this._panel = panel;
        this.bindToDocument(document);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Re-render when the panel becomes visible
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible) {
                this.render();
            }
        }, null, this._disposables);

        // Re-render on text changes in any CML document
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === this._document && e.contentChanges.length > 0) {
                this.scheduleRender();
            }
        }, null, this._disposables);

        // Follow the active editor when switching between CML files
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'cml') {
                this.bindToDocument(editor.document);
            }
        }, null, this._disposables);

        // Handle document close
        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc === this._document) {
                this._document = undefined;
                this.renderEmpty('The CML file has been closed.');
            }
        }, null, this._disposables);
    }

    private bindToDocument(document: vscode.TextDocument): void {
        if (this._document === document) { return; }
        this._document = document;
        this._panel.title = `CML Preview – ${this.shortFileName(document)}`;
        this.render();
    }

    private shortFileName(document: vscode.TextDocument): string {
        const parts = document.uri.fsPath.split(/[\\/]/);
        return parts[parts.length - 1];
    }

    private scheduleRender(): void {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = undefined;
            this.render();
        }, CmlPreviewPanel.DEBOUNCE_MS);
    }

    private render(): void {
        if (!this._document) {
            this.renderEmpty('No CML file is open.');
            return;
        }

        const text = this._document.getText();
        const model = parseCml(text);
        const svgContent = renderSvg(model);

        this._panel.webview.html = this.buildHtml(svgContent);
    }

    private renderEmpty(message: string): void {
        this._panel.webview.html = this.buildHtml(
            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">` +
            `<rect width="100%" height="100%" fill="#1a202c"/>` +
            `<text x="200" y="55" text-anchor="middle" font-family="'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" fill="#718096">${this.escapeHtml(message)}</text>` +
            `</svg>`
        );
    }

    private buildHtml(svgContent: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <title>CML Preview</title>
    <style>
        body {
            margin: 0;
            padding: 16px;
            background: #1a202c;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            overflow: auto;
        }
        .container {
            max-width: 100%;
            overflow: auto;
        }
        svg {
            max-width: 100%;
            height: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        ${svgContent}
    </div>
</body>
</html>`;
    }

    private escapeHtml(s: string): string {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    public dispose(): void {
        CmlPreviewPanel._instance = undefined;

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;

        this._panel.dispose();
    }
}
