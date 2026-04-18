'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { whenLanguageClientReady } from '../languageClientHolder';

export class CmlPreviewPanel implements vscode.Disposable {
    public static readonly viewType = 'cml.preview';

    private static _instance: CmlPreviewPanel | undefined;

    private readonly _panel: vscode.WebviewPanel;
    private readonly _disposables: vscode.Disposable[] = [];
    private _document: vscode.TextDocument | undefined;
    private _debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private _generating = false;

    private static readonly DEBOUNCE_MS = 1000;

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

        const roots: vscode.Uri[] = [];
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) {
            roots.push(vscode.Uri.file(path.join(wsRoot, 'src-gen')));
        }
        const docDir = path.dirname(editor.document.uri.fsPath);
        roots.push(vscode.Uri.file(path.join(docDir, 'src-gen')));

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
            if (this._panel.visible) {
                this.render();
            }
        }, null, this._disposables);

        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc === this._document) {
                this.scheduleRender();
            }
        }, null, this._disposables);

        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === this._document && e.contentChanges.length > 0) {
                this.scheduleRender();
            }
        }, null, this._disposables);

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'cml') {
                this.bindToDocument(editor.document);
            }
        }, null, this._disposables);

        vscode.workspace.onDidCloseTextDocument(doc => {
            if (doc === this._document) {
                this._document = undefined;
                this.showMessage('The CML file has been closed.');
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
        const segments = document.uri.fsPath.split(/[\\/]/);
        return segments[segments.length - 1];
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

    private async render(): Promise<void> {
        if (!this._document) {
            this.showMessage('No CML file is open.');
            return;
        }

        if (this._generating) {
            return;
        }

        if (this._document.isDirty) {
            await this._document.save();
        }

        await this.generateAndShow();
    }

    private async generateAndShow(): Promise<void> {
        if (!this._document) { return; }

        this._generating = true;
        this.showMessage('Generating context map…');

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

        try {
            await whenLanguageClientReady();
            const returnVal: string = await vscode.commands.executeCommand(
                'cml.generate.contextmap', documentUri, [params]
            );

            if (returnVal && returnVal.startsWith('Error occurred:')) {
                this.showMessage(returnVal);
                this._generating = false;
                return;
            }

            this.showGeneratedImage();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            this.showMessage(
                `Generation failed: ${msg}. ` +
                'If the language server is still starting, try again in a moment. ' +
                'Otherwise check the Output panel (CML Language Server) for errors.'
            );
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

        for (const p of candidates) {
            if (fs.existsSync(p)) { return p; }
        }
        return undefined;
    }

    private showGeneratedImage(): void {
        if (!this._document) { return; }

        const baseName = path.basename(this._document.uri.fsPath, '.cml');

        const svgPath = this.findGeneratedFile(baseName, 'svg');
        if (svgPath) {
            this.displaySvgFile(svgPath);
            return;
        }

        const pngPath = this.findGeneratedFile(baseName, 'png');
        if (pngPath) {
            this.displayPngFile(pngPath);
            return;
        }

        // Broad search in possible src-gen directories
        const searchDirs: string[] = [];
        const docDir = path.dirname(this._document.uri.fsPath);
        searchDirs.push(path.join(docDir, 'src-gen'));
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot) { searchDirs.push(path.join(wsRoot, 'src-gen')); }

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
                if (files[0].endsWith('.svg')) {
                    this.displaySvgFile(filePath);
                } else {
                    this.displayPngFile(filePath);
                }
                return;
            }
        }

        this.showMessage(
            'No generated context map image found. ' +
            'Ensure Graphviz is installed and a ContextMap is defined in the CML file.'
        );
    }

    private displaySvgFile(svgPath: string): void {
        try {
            const svgContent = fs.readFileSync(svgPath, 'utf-8');
            this._panel.webview.html = this.buildHtmlForSvg(svgContent);
        } catch {
            this.showMessage('Failed to read generated SVG file.');
        }
    }

    private displayPngFile(pngPath: string): void {
        try {
            const pngUri = this._panel.webview.asWebviewUri(vscode.Uri.file(pngPath));
            this._panel.webview.html = this.buildHtmlForImg(pngUri.toString());
        } catch {
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
