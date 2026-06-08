import * as vscode from 'vscode';

export interface CompletionContext {
  prefix: string;
  suffix: string;
  languageId: string;
  fileName: string;
  linePrefix: string;
}

export function buildCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  prefixChars: number,
  suffixChars: number
): CompletionContext {
  const cursorOffset = document.offsetAt(position);
  const fullText = document.getText();
  const prefixStart = Math.max(0, cursorOffset - prefixChars);
  const suffixEnd = Math.min(fullText.length, cursorOffset + suffixChars);
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);

  return {
    prefix: fullText.slice(prefixStart, cursorOffset),
    suffix: fullText.slice(cursorOffset, suffixEnd),
    languageId: document.languageId,
    fileName: document.fileName,
    linePrefix
  };
}

export function shouldRequestCompletion(
  document: vscode.TextDocument,
  position: vscode.Position,
  enabledLanguages: string[]
): boolean {
  if (document.isClosed || !isSupportedDocumentScheme(document.uri.scheme)) {
    return false;
  }

  if (enabledLanguages.length > 0 && !enabledLanguages.includes(document.languageId)) {
    return false;
  }

  const line = document.lineAt(position.line).text;
  const beforeCursor = line.slice(0, position.character);

  if (beforeCursor.trim().length === 0 && position.line > 0) {
    return false;
  }

  if (isInsideStringLiteralHeuristic(beforeCursor)) {
    return false;
  }

  return true;
}

function isSupportedDocumentScheme(scheme: string): boolean {
  return scheme === 'file' || scheme === 'vscode-notebook-cell';
}

function isInsideStringLiteralHeuristic(text: string): boolean {
  const withoutEscapedQuotes = text.replace(/\\["'`]/g, '');
  const single = countChar(withoutEscapedQuotes, "'");
  const double = countChar(withoutEscapedQuotes, '"');
  const backtick = countChar(withoutEscapedQuotes, '`');
  return single % 2 === 1 || double % 2 === 1 || backtick % 2 === 1;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const current of text) {
    if (current === char) {
      count += 1;
    }
  }
  return count;
}
