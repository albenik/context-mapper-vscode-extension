'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { whenLanguageClientReady } from '../languageClientHolder';
import { getPreviewLogger } from './previewLogger';

export class CmlPreviewPanel implements vscode.Disposable {
    public static readonly viewType = 'cml.preview';

    private static _instance: CmlPreviewPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private _document: vscode.TextDocument | undefined;
    private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _generating = false;
    private _graphvizChecked = false;
    private _graphvizOk = false;

    private static readonly DEBOUNCE_MS = 1000;

    public static show(): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'cml') {
            getPreviewLogger().info('preview show() aborted: no active CML editor');
            vscode.window.showWarningMessage('Open a .cml file first to preview the context map.');
            return;
        }

        if (CmlPreviewPanel._instance) {
            getPreviewLogger().info('preview panel revealed (existing instance)', {
                documentUri: editor.document.uri.toString(),
                viewColumn: vscode.ViewColumn.Two,
            });
            CmlPreviewPanel._instance._panel.reveal(vscode.ViewColumn.Two, true);
            CmlPreviewPanel._instance.bindToDocument(editor.document);
            return;
        }

        const roots: vscode.Uri[] = [];
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) {
            roots.push(vscode.Uri.file(path.join(wsRoot, 'src-gen')));
        }
        const docDir = path.dirname(editor.document.uri.fsPath);
        roots.push(vscode.Uri.file(path.join(docDir, 'src-gen')));

        getPreviewLogger().info('preview panel opened (new instance)', {
            documentUri: editor.document.uri.toString(),
            viewColumn: vscode.ViewColumn.Two,
            localResourceRoots: roots.map((r) => r.fsPath),
        });

        const panel = vscode.window.createWebviewPanel(
            CmlPreviewPanel.viewType,
            'CML Preview',
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            {
                enableScripts: false,
                localResourceRoots: roots,
            }
        );

        CmlPreviewPanel._instance = new CmlPreviewPanel(panel, editor.document);
    }

    private constructor(panel: vscode.WebviewPanel, document: vscode.TextDocument) {
        this._panel = panel;
        this.bindToDocument(document);

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.onDidChangeViewState(() => {
            getPreviewLogger().debug('preview webview view state changed', {
                visible: this._panel.visible,
                active: this._panel.active,
                documentUri: this._document?.uri.toString(),
            });
            if (this._panel.visible) {
                this.render();
            }
        }, null, this._disposables);

        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc === this._document) {
                getPreviewLogger().debug('onDidSaveTextDocument (bound CML)', {
                    uri: doc.uri.toString(),
                });
                this.scheduleRender();
            }
        }, null, this._disposables);

        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === this._document && e.contentChanges.length > 0) {
                getPreviewLogger().debug('onDidChangeTextDocument (bound CML)', {
                    uri: e.document.uri.toString(),
                    changeCount: e.contentChanges.length,
                });
                this.scheduleRender();
            }
        }, null, this._disposables);

        vscode.window.onDidChangeActiveTextEditor(editor => {
            getPreviewLogger().debug('onDidChangeActiveTextEditor', {
                uri: editor?.document.uri.toString(),
                languageId: editor?.document.languageId,
            });
            if (editor && editor.document.languageId === 'cml') {
                this.bindToDocument(editor.document);
            }
        }, null, this._disposables);

        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc === this._document) {
                getPreviewLogger().debug('onDidCloseTextDocument (bound CML)', { uri: doc.uri.toString() });
                this._document = undefined;
                this.showMessage('The CML file has been closed.');
            }
        }, null, this._disposables);
    }

    private bindToDocument(document: vscode.TextDocument): void {
        if (this._document === document) { return; }
        this._document = document;
        getPreviewLogger().info('preview bound to document', { uri: document.uri.toString() });
        this._panel.title = `CML Preview – ${this.shortFileName(document)}`;
        this.render();
    }

    private shortFileName(document: vscode.TextDocument): string {
        const segments = document.uri.fsPath.split(/[\\/]/);
        return segments[segments.length - 1];
    }

    private scheduleRender(): void {
        getPreviewLogger().debug('render scheduled', { debounceMs: CmlPreviewPanel.DEBOUNCE_MS });
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = undefined;
            getPreviewLogger().debug('debounced render firing');
            this.render();
        }, CmlPreviewPanel.DEBOUNCE_MS);
    }

    private async render(): Promise<void> {
        if (!this._document) {
            getPreviewLogger().debug('render() skipped: no bound document');
            this.showMessage('No CML file is open.');
            return;
        }

        getPreviewLogger().debug('render() entered', {
            documentUri: this._document.uri.toString(),
            isDirty: this._document.isDirty,
            generating: this._generating,
        });

        if (this._generating) {
            getPreviewLogger().info('render skipped: already generating');
            return;
        }

        if (this._document.isDirty) {
            getPreviewLogger().info('saving dirty document before render', {
                uri: this._document.uri.toString(),
            });
            await this._document.save();
        }

        await this.generateAndShow();
    }

    private checkGraphviz(): boolean {
        if (this._graphvizChecked) {
            return this._graphvizOk;
        }
        try {
            const r = spawnSync('dot', ['-V'], { timeout: 3000, stdio: 'pipe' });
            this._graphvizOk = r.status === 0;
            getPreviewLogger().info('graphviz preflight', {
                ok: this._graphvizOk,
                stderr: r.stderr?.toString().trim(),
                status: r.status,
                error: r.error?.message,
            });
        } catch (err: unknown) {
            this._graphvizOk = false;
            getPreviewLogger().warn('graphviz preflight threw', err);
        }
        this._graphvizChecked = true;
        return this._graphvizOk;
    }

    private async generateAndShow(): Promise<void> {
        if (!this._document) { return; }

        this._generating = true;
        this.showMessage('Generating context map…');

        if (!this.checkGraphviz()) {
            getPreviewLogger().warn('graphviz missing: skipping LSP call');
            this.showMessage(
                'Graphviz is not installed on this machine. ' +
                'The CML preview needs the `dot` binary to render context maps. ' +
                'Install it (macOS: `brew install graphviz`, Linux: `apt-get install graphviz`, ' +
                'Windows: `choco install graphviz`), then reopen the preview.'
            );
            this._generating = false;
            return;
        }

        const documentUri = this._document.uri.toString();
        const configuration = vscode.workspace.getConfiguration('', this._document.uri);

        const params = {
            formats: ['svg', 'png'],
            fixWidth: configuration.get('generation.contextMapGenerator.fixImageWidth') as boolean,
            fixHeight: configuration.get('generation.contextMapGenerator.fixImageHeight') as boolean,
            width: configuration.get('generation.contextMapGenerator.imageWidth') as number,
            height: configuration.get('generation.contextMapGenerator.imageHeight') as number,
            generateLabels: configuration.get('generation.contextMapGenerator.generateLabels') as boolean,
            labelSpacingFactor: configuration.get('generation.contextMapGenerator.labelSpacingFactor') as number,
            clusterTeams: configuration.get('generation.contextMapGenerator.clusterTeams') as boolean
        };

        getPreviewLogger().info('generateAndShow begin', { documentUri, params });

        try {
            const lspWaitStarted = Date.now();
            await whenLanguageClientReady();
            const waitedMs = Date.now() - lspWaitStarted;
            getPreviewLogger().info('LSP ready', { waitedMs });

            const execStarted = Date.now();
            const returnVal: string = await vscode.commands.executeCommand(
                'cml.generate.contextmap', documentUri, [params]
            );
            const durationMs = Date.now() - execStarted;
            getPreviewLogger().info('executeCommand resolved', { durationMs, returnVal });

            if (returnVal && returnVal.startsWith('Error occurred:')) {
                getPreviewLogger().warn('LSP reported generation error', { returnVal });
                this.showMessage(returnVal);
                this._generating = false;
                return;
            }

            this.showGeneratedImage();
        } catch (err: unknown) {
            getPreviewLogger().error('generateAndShow failed', err);
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.startsWith('CML language server failed to start:')) {
                this.showMessage(
                    `${msg} Fix the language server issue and reload the window to retry.`
                );
            } else {
                this.showMessage(
                    `Generation failed: ${msg}. ` +
                    'If the language server is still starting, try again in a moment. ' +
                    'Otherwise check the Output panel ("CML Preview", "CML Language Server") for errors.'
                );
            }
        } finally {
            this._generating = false;
        }
    }

    /**
     * The LSP generator writes output to src-gen/ relative to the workspace
     * root that contains the CML file, or relative to the CML file's own
     * directory when it is opened stand-alone. We probe both locations.
     */
    private findGeneratedFile(baseName: string, ext: string): string | undefined {
        const candidates: string[] = [];

        // 1. src-gen next to the CML document
        if (this._document) {
            const docDir = path.dirname(this._document.uri.fsPath);
            candidates.push(path.join(docDir, 'src-gen', `${baseName}_ContextMap.${ext}`));
        }

        // 2. src-gen at workspace root
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) {
            candidates.push(path.join(wsRoot, 'src-gen', `${baseName}_ContextMap.${ext}`));
        }

        getPreviewLogger().debug('probing artifact', { baseName, ext, candidates });

        for (const p of candidates) {
            if (fs.existsSync(p)) {
                getPreviewLogger().info('artifact found', { path: p });
                return p;
            }
        }
        getPreviewLogger().warn('no artifact in canonical locations', { baseName, ext, candidates });
        return undefined;
    }

    private showGeneratedImage(): void {
        if (!this._document) { return; }

        const baseName = path.basename(this._document.uri.fsPath, '.cml');

        const svgPath = this.findGeneratedFile(baseName, 'svg');
        if (svgPath) {
            getPreviewLogger().info('selected artifact', { kind: 'svg', path: svgPath });
            this.displaySvgFile(svgPath);
            return;
        }

        const pngPath = this.findGeneratedFile(baseName, 'png');
        if (pngPath) {
            getPreviewLogger().info('selected artifact', { kind: 'png', path: pngPath });
            this.displayPngFile(pngPath);
            return;
        }

        // Broad search in possible src-gen directories
        const searchDirs: string[] = [];
        const docDir = path.dirname(this._document.uri.fsPath);
        searchDirs.push(path.join(docDir, 'src-gen'));
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) { searchDirs.push(path.join(wsRoot, 'src-gen')); }

        getPreviewLogger().debug('broad artifact search', { baseName, searchDirs });

        for (const dir of searchDirs) {
            if (!fs.existsSync(dir)) { continue; }
            const files = fs.readdirSync(dir)
                .filter(f => f.startsWith(baseName) && (f.endsWith('.svg') || f.endsWith('.png')))
                .sort((a, b) => {
                    if (a.endsWith('.svg') && !b.endsWith('.svg')) { return -1; }
                    if (!a.endsWith('.svg') && b.endsWith('.svg')) { return 1; }
                    return 0;
                });
            if (files.length > 0) {
                const filePath = path.join(dir, files[0]);
                const kind = files[0].endsWith('.svg') ? 'svg' : 'png';
                getPreviewLogger().info('selected artifact (broad search)', { kind, path: filePath });
                if (files[0].endsWith('.svg')) {
                    this.displaySvgFile(filePath);
                } else {
                    this.displayPngFile(filePath);
                }
                return;
            }
        }

        getPreviewLogger().warn('no artifact after broad search', { baseName, searchDirs });
        this.showMessage(
            'No generated context map image found. ' +
            'Ensure Graphviz is installed and a ContextMap is defined in the CML file.'
        );
    }

    private displaySvgFile(svgPath: string): void {
        try {
            const buf = fs.readFileSync(svgPath);
            const svgContent = buf.toString('utf-8');
            getPreviewLogger().debug('rendering svg', { path: svgPath, bytes: buf.byteLength });
            this._panel.webview.html = this.buildHtmlForSvg(svgContent);
        } catch (err: unknown) {
            getPreviewLogger().error('failed to read svg', err);
            this.showMessage('Failed to read generated SVG file.');
        }
    }

    private displayPngFile(pngPath: string): void {
        try {
            const stat = fs.statSync(pngPath);
            const pngUri = this._panel.webview.asWebviewUri(vscode.Uri.file(pngPath));
            getPreviewLogger().debug('rendering png', { path: pngPath, bytes: stat.size });
            this._panel.webview.html = this.buildHtmlForImg(pngUri.toString());
        } catch (err: unknown) {
            getPreviewLogger().error('failed to read png', err);
            this.showMessage('Failed to read generated PNG file.');
        }
    }

    private buildHtmlForSvg(svgContent: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${this._panel.webview.cspSource} data:;">
    <title>CML Preview</title>
    <style>
        body {
            margin: 0;
            padding: 16px;
            background: #fff;
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

    private buildHtmlForImg(imgSrc: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${this._panel.webview.cspSource} data:;">
    <title>CML Preview</title>
    <style>
        body {
            margin: 0;
            padding: 16px;
            background: #fff;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            min-height: 100vh;
            overflow: auto;
        }
        img {
            max-width: 100%;
            height: auto;
        }
    </style>
</head>
<body>
    <img src="${imgSrc}" alt="Context Map" />
</body>
</html>`;
    }

    private showMessage(message: string): void {
        getPreviewLogger().debug('showing panel message', { message });
        this._panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <title>CML Preview</title>
    <style>
        body {
            margin: 0;
            padding: 40px;
            background: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            color: #555;
            display: flex;
            justify-content: center;
            align-items: flex-start;
        }
        .message {
            max-width: 500px;
            text-align: center;
            line-height: 1.5;
        }
    </style>
</head>
<body>
    <div class="message">${this.escapeHtml(message)}</div>
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
        getPreviewLogger().info('preview disposed');
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
