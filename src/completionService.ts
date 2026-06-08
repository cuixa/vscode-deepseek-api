import * as vscode from 'vscode';
import { getConfig } from './config';
import { buildCompletionContext, shouldRequestCompletion } from './contextBuilder';
import { HttpDeepSeekClient } from './deepseekClient';
import { postProcessCompletion } from './postProcess';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class CompletionService {
  private readonly cache = new Map<string, CacheEntry>();
  private activeAbortController: AbortController | undefined;

  public constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly output: vscode.OutputChannel
  ) {}

  public async provide(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = await getConfig(this.secrets);
    if (!config.enabled || !config.apiKey) {
      return undefined;
    }

    if (!shouldRequestCompletion(document, position, config.enabledLanguages)) {
      return undefined;
    }

    const context = buildCompletionContext(document, position, config.prefixChars, config.suffixChars);
    const cacheKey = this.createCacheKey(document, position, context.prefix, context.suffix);
    const cached = this.getCached(cacheKey);
    if (cached !== undefined) {
      return this.toInlineItems(cached, position);
    }

    await this.delay(config.debounceMs, token);
    if (token.isCancellationRequested) {
      return undefined;
    }

    this.activeAbortController?.abort();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const timeout = setTimeout(() => abortController.abort(), config.requestTimeoutMs);
    const tokenDisposable = token.onCancellationRequested(() => abortController.abort());
    const startedAt = Date.now();

    try {
      const client = new HttpDeepSeekClient(config);
      const raw = await client.complete(context, abortController.signal);
      const completion = postProcessCompletion(raw, context);
      this.setCached(cacheKey, completion);

      if (!completion) {
        return undefined;
      }

      this.output.appendLine(`Completion returned in ${Date.now() - startedAt}ms for ${document.languageId}.`);
      return this.toInlineItems(completion, position);
    } catch (error) {
      if (!token.isCancellationRequested && !abortController.signal.aborted) {
        this.output.appendLine(formatError(error));
      }
      return undefined;
    } finally {
      clearTimeout(timeout);
      tokenDisposable.dispose();
      if (this.activeAbortController === abortController) {
        this.activeAbortController = undefined;
      }
    }
  }

  private toInlineItems(completion: string, position: vscode.Position): vscode.InlineCompletionItem[] | undefined {
    if (!completion) {
      return undefined;
    }

    return [
      new vscode.InlineCompletionItem(
        completion,
        new vscode.Range(position, position)
      )
    ];
  }

  private async delay(ms: number, token: vscode.CancellationToken): Promise<void> {
    if (ms <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, ms);
      let disposable: vscode.Disposable | undefined;
      disposable = token.onCancellationRequested(() => {
        clearTimeout(timeout);
        disposable?.dispose();
        resolve();
      });
    });
  }

  private createCacheKey(document: vscode.TextDocument, position: vscode.Position, prefix: string, suffix: string): string {
    return [
      document.uri.toString(),
      document.version,
      position.line,
      position.character,
      hash(prefix),
      hash(suffix)
    ].join(':');
  }

  private getCached(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  private setCached(key: string, value: string): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + 30_000
    });

    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }
}

function hash(value: string): string {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return result.toString(36);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `[DeepSeek Completion] ${error.message}`;
  }
  return `[DeepSeek Completion] ${String(error)}`;
}
