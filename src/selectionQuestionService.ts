import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from './config';
import { HttpDeepSeekClient, SelectionQuestionContext } from './deepseekClient';

export class SelectionQuestionService implements vscode.Disposable {
  private readonly answerDecoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
    after: {
      contentText: '  DeepSeek answer: hover to view',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic'
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
  });
  private answerEditor: vscode.TextEditor | undefined;
  private readonly documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === this.answerEditor?.document) {
      this.clearAnswer();
    }
  });

  public constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel
  ) {}

  public async ask(editor = vscode.window.activeTextEditor): Promise<void> {
    if (!editor || editor.selection.isEmpty) {
      vscode.window.showWarningMessage('Select text before asking DeepSeek a question.');
      return;
    }

    const config = await getConfig(this.secrets);
    if (!config.apiKey) {
      vscode.window.showWarningMessage('Set your DeepSeek API key before asking a question.');
      return;
    }

    const question = await vscode.window.showInputBox({
      title: 'Ask DeepSeek About Selection',
      prompt: 'What would you like to know about the selected text?',
      ignoreFocusOut: true,
      validateInput(value) {
        return value.trim().length === 0 ? 'A question is required.' : undefined;
      }
    });
    if (!question) {
      return;
    }

    const selectedText = editor.document.getText(editor.selection);
    const context = this.createContext(editor.document, selectedText, question.trim(), config.selectionQuestionMaxChars);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const answer = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Asking DeepSeek about selection...',
          cancellable: true
        },
        async (_, token) => {
          const cancellation = token.onCancellationRequested(() => abortController.abort());
          try {
            const client = new HttpDeepSeekClient(config);
            return await client.answerSelection(context, abortController.signal);
          } finally {
            cancellation.dispose();
          }
        }
      );

      this.output.appendLine(`Selection question answered in ${Date.now() - startedAt}ms.`);
      await this.showAnswer(editor, editor.selection, context, answer);
    } catch (error) {
      if (abortController.signal.aborted) {
        vscode.window.showInformationMessage('DeepSeek selection question was cancelled or timed out.');
      } else {
        const message = formatError(error);
        this.output.appendLine(message);
        vscode.window.showErrorMessage(message);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  public dispose(): void {
    this.clearAnswer();
    this.documentChangeDisposable.dispose();
    this.answerDecoration.dispose();
  }

  private createContext(
    document: vscode.TextDocument,
    selectedText: string,
    question: string,
    maxChars: number
  ): SelectionQuestionContext {
    const text = truncate(selectedText, maxChars);
    return {
      fileName: vscode.workspace.asRelativePath(document.uri, false) || path.basename(document.fileName),
      languageId: document.languageId,
      selectedText: text,
      question
    };
  }

  private async showAnswer(
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    context: SelectionQuestionContext,
    answer: string
  ): Promise<void> {
    this.clearAnswer();

    const hoverMessage = new vscode.MarkdownString();
    hoverMessage.isTrusted = false;
    hoverMessage.appendMarkdown('### DeepSeek Answer\n\n');
    hoverMessage.appendMarkdown(`**Question:** ${context.question}\n\n`);
    hoverMessage.appendMarkdown(answer.trim());

    editor.setDecorations(this.answerDecoration, [{
      range: selection,
      hoverMessage
    }]);
    this.answerEditor = editor;

    editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    await vscode.commands.executeCommand('editor.action.showHover');
  }

  private clearAnswer(): void {
    if (this.answerEditor) {
      this.answerEditor.setDecorations(this.answerDecoration, []);
      this.answerEditor = undefined;
    }
  }
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[Selection truncated before sending to DeepSeek.]`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `[DeepSeek Selection Question] ${error.message}`;
  }
  return `[DeepSeek Selection Question] ${String(error)}`;
}
