import * as vscode from 'vscode';
import { ExtensionConfig, getConfig } from './config';
import { CompletionContext, buildCompletionContext, shouldRequestCompletion } from './contextBuilder';
import { HttpDeepSeekClient } from './deepseekClient';
import { postProcessCompletion } from './postProcess';

interface CacheEntry {
  value: string;
  expiresAt: number;
  uri: string;
  languageId: string;
  requestSignature: string;
  prefix: string;
  suffix: string;
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
    const cacheKey = this.createCacheKey(document, context, config);
    const cached = this.getCachedCompletion(document, context, config, cacheKey);
    if (cached !== undefined) {
      return this.toInlineItems(cached, position);
    }

    await this.delay(config.debounceMs, token);
    if (token.isCancellationRequested) {
      return undefined;
    }

    const cachedAfterDelay = this.getCachedCompletion(document, context, config, cacheKey);
    if (cachedAfterDelay !== undefined) {
      return this.toInlineItems(cachedAfterDelay, position);
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

      if (!completion) {
        return undefined;
      }

      this.setCached(cacheKey, completion, document, context, config);
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

  private createCacheKey(
    document: vscode.TextDocument,
    context: CompletionContext,
    config: ExtensionConfig
  ): string {
    return [
      document.uri.toString(),
      document.languageId,
      createRequestSignature(config),
      hash(context.prefix),
      hash(context.suffix)
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

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  private getCachedCompletion(
    document: vscode.TextDocument,
    context: CompletionContext,
    config: ExtensionConfig,
    exactKey: string
  ): string | undefined {
    const exact = this.getCached(exactKey);
    if (exact !== undefined) {
      return exact;
    }

    const derived = this.getPrefixContinuation(document, context, config);
    if (derived !== undefined) {
      this.setCached(exactKey, derived, document, context, config);
    }

    return derived;
  }

  private getPrefixContinuation(
    document: vscode.TextDocument,
    context: CompletionContext,
    config: ExtensionConfig
  ): string | undefined {
    const now = Date.now();
    const uri = document.uri.toString();
    const requestSignature = createRequestSignature(config);

    for (const [key, entry] of Array.from(this.cache.entries()).reverse()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        continue;
      }

      if (
        entry.uri !== uri ||
        entry.languageId !== document.languageId ||
        entry.requestSignature !== requestSignature ||
        entry.suffix !== context.suffix ||
        !context.prefix.startsWith(entry.prefix)
      ) {
        continue;
      }

      const acceptedPrefix = context.prefix.slice(entry.prefix.length);
      if (!acceptedPrefix || !entry.value.startsWith(acceptedPrefix)) {
        continue;
      }

      const remainder = entry.value.slice(acceptedPrefix.length);
      if (!remainder) {
        continue;
      }

      this.cache.delete(key);
      this.cache.set(key, entry);
      return remainder;
    }

    return undefined;
  }

  private setCached(
    key: string,
    value: string,
    document: vscode.TextDocument,
    context: CompletionContext,
    config: ExtensionConfig
  ): void {
    if (!value) {
      return;
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + config.cacheTtlMs,
      uri: document.uri.toString(),
      languageId: document.languageId,
      requestSignature: createRequestSignature(config),
      prefix: context.prefix,
      suffix: context.suffix
    });

    while (this.cache.size > config.cacheMaxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      } else {
        break;
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

function createRequestSignature(config: ExtensionConfig): string {
  return [
    config.baseUrl,
    config.chatBaseUrl,
    config.model,
    config.maxTokens,
    config.temperature,
    config.stop.join('\u0000')
  ].join('|');
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `[DeepSeek Completion] ${error.message}`;
  }
  return `[DeepSeek Completion] ${String(error)}`;
}
