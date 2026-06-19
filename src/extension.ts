import * as vscode from 'vscode';
import { CommitMessageService } from './commitMessageService';
import { CompletionService } from './completionService';
import { updateEnabled } from './config';
import { SelectionQuestionService } from './selectionQuestionService';

const API_KEY_SECRET = 'deepseekCompletion.apiKey';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DeepSeek Completion');
  const completionService = new CompletionService(context.secrets, output);
  const commitMessageService = new CommitMessageService(context.secrets, output);
  const selectionQuestionService = new SelectionQuestionService(context.secrets, output);

  const selector: vscode.DocumentSelector = [
    { scheme: 'file' },
    { notebookType: 'jupyter-notebook' }
  ];

  context.subscriptions.push(
    output,
    selectionQuestionService,
    vscode.languages.registerInlineCompletionItemProvider(selector, {
      provideInlineCompletionItems(document, position, inlineContext, token) {
        return completionService.provide(document, position, token);
      }
    }),
    vscode.commands.registerCommand('deepseekCompletion.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        title: 'Set DeepSeek API Key',
        prompt: 'Enter your DeepSeek API key. It will be stored in VS Code SecretStorage.',
        password: true,
        ignoreFocusOut: true,
        validateInput(value) {
          return value.trim().length === 0 ? 'API key is required.' : undefined;
        }
      });

      if (!apiKey) {
        return;
      }

      await context.secrets.store(API_KEY_SECRET, apiKey.trim());
      vscode.window.showInformationMessage('DeepSeek API key saved.');
    }),
    vscode.commands.registerCommand('deepseekCompletion.clearApiKey', async () => {
      await context.secrets.delete(API_KEY_SECRET);
      vscode.window.showInformationMessage('DeepSeek API key cleared.');
    }),
    vscode.commands.registerCommand('deepseekCompletion.enable', async () => {
      await updateEnabled(true);
      vscode.window.showInformationMessage('DeepSeek completion enabled.');
    }),
    vscode.commands.registerCommand('deepseekCompletion.disable', async () => {
      await updateEnabled(false);
      vscode.window.showInformationMessage('DeepSeek completion disabled.');
    }),
    vscode.commands.registerCommand('deepseekCompletion.generateCommitMessage', async () => {
      await commitMessageService.generate();
    }),
    vscode.commands.registerCommand('deepseekCompletion.askSelection', async () => {
      await selectionQuestionService.ask();
    })
  );
}

export function deactivate(): void {
  // Nothing to dispose manually; VS Code disposes subscriptions registered in activate.
}
