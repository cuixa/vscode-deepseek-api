import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from './config';
import { HttpDeepSeekClient } from './deepseekClient';

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

interface GitAPI {
  repositories: GitRepository[];
}

interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: {
    value: string;
  };
  diff(cached?: boolean): Promise<string>;
}

const MAX_REPOSITORY_CHOICES = 20;

export class CommitMessageService {
  public constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel
  ) {}

  public async generate(): Promise<void> {
    const config = await getConfig(this.secrets);
    if (!config.apiKey) {
      vscode.window.showWarningMessage('Set your DeepSeek API key before generating a commit message.');
      return;
    }

    const repository = await this.pickRepository();
    if (!repository) {
      return;
    }

    let diff = await repository.diff(true);
    if (!diff.trim()) {
      vscode.window.showInformationMessage('Stage changes before generating a commit message.');
      return;
    }

    if (diff.length > config.commitMessageMaxDiffChars) {
      diff = diff.slice(0, config.commitMessageMaxDiffChars);
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), config.requestTimeoutMs);
    const startedAt = Date.now();

    try {
      const message = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.SourceControl,
          title: 'Generating commit message with DeepSeek...'
        },
        async () => {
          const client = new HttpDeepSeekClient(config);
          return client.generateCommitMessage(diff, abortController.signal);
        }
      );

      repository.inputBox.value = cleanCommitMessage(message);
      this.output.appendLine(`Commit message generated in ${Date.now() - startedAt}ms.`);
    } catch (error) {
      if (!abortController.signal.aborted) {
        const message = formatError(error);
        this.output.appendLine(message);
        vscode.window.showErrorMessage(message);
      } else {
        vscode.window.showErrorMessage('DeepSeek commit message generation timed out.');
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private async pickRepository(): Promise<GitRepository | undefined> {
    const git = vscode.extensions.getExtension<GitExtension>('vscode.git');
    const gitExtension = git?.isActive ? git.exports : await git?.activate();
    const api = gitExtension?.getAPI(1);
    const repositories = api?.repositories ?? [];

    if (repositories.length === 0) {
      vscode.window.showWarningMessage('Open a Git repository before generating a commit message.');
      return undefined;
    }

    const activeRepository = this.findRepositoryForActiveEditor(repositories);
    if (activeRepository) {
      return activeRepository;
    }

    if (repositories.length === 1) {
      return repositories[0];
    }

    const items = repositories.slice(0, MAX_REPOSITORY_CHOICES).map((repository) => ({
      label: vscode.workspace.asRelativePath(repository.rootUri, false),
      repository
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Generate Commit Message',
      placeHolder: 'Select a Git repository'
    });

    return picked?.repository;
  }

  private findRepositoryForActiveEditor(repositories: GitRepository[]): GitRepository | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (!activeUri || activeUri.scheme !== 'file') {
      return undefined;
    }

    const activePath = activeUri.fsPath.toLowerCase();
    return repositories.find((repository) => {
      const rootPath = repository.rootUri.fsPath.toLowerCase();
      return activePath === rootPath || activePath.startsWith(`${rootPath}${path.sep}`);
    });
  }
}

function cleanCommitMessage(value: string): string {
  const firstLine = value
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-z]*\n?/gi, '').replace(/```/g, ''))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? '';

  return firstLine.replace(/^["']|["']$/g, '').trim();
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `[DeepSeek Commit Message] ${error.message}`;
  }
  return `[DeepSeek Commit Message] ${String(error)}`;
}
