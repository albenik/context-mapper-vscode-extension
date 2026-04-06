/**
 * Helper functions for SCL editor
 */

import { window, Uri } from "vscode";

export function isNotSCLEditor(): boolean {
    const activeEditor = window.activeTextEditor;
    return !activeEditor || !activeEditor.document || activeEditor.document.languageId !== 'scl';
}

export function documentHasURI(): boolean {
    return window.activeTextEditor !== undefined && window.activeTextEditor.document.uri instanceof Uri;
}
