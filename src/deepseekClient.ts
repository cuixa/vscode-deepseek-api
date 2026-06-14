import { ExtensionConfig } from './config';
import { CompletionContext } from './contextBuilder';

export interface DeepSeekClient {
  complete(context: CompletionContext, signal: AbortSignal): Promise<string>;
  generateCommitMessage(diff: string, signal: AbortSignal): Promise<string>;
}

interface CompletionChoice {
  text?: string;
  finish_reason?: string;
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
  };
}

interface CompletionResponse {
  choices?: CompletionChoice[];
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export class HttpDeepSeekClient implements DeepSeekClient {
  private static readonly fimCooldownUntil = new Map<string, number>();

  public constructor(private readonly config: ExtensionConfig) {}

  public async complete(context: CompletionContext, signal: AbortSignal): Promise<string> {
    const fimCooldownKey = this.createFimCooldownKey();
    if (HttpDeepSeekClient.isFimCoolingDown(fimCooldownKey)) {
      return this.completeWithChat(context, signal);
    }

    try {
      return await this.completeWithFim(context, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      this.coolDownFim(fimCooldownKey);
      return this.completeWithChat(context, signal);
    }
  }

  public async generateCommitMessage(diff: string, signal: AbortSignal): Promise<string> {
    const body = {
      model: this.config.commitMessageModel,
      thinking: {
        type: 'disabled'
      },
      messages: [
        {
          role: 'system',
          content: [
            'You write concise Git commit messages from staged diffs.',
            'Return exactly one commit message.',
            'Use Conventional Commits format when possible, such as feat:, fix:, docs:, refactor:, test:, chore:, or build:.',
            'Keep the commit type and optional scope in English, for example feat(api): or chore:.',
            'The summary after the colon must be Simplified Chinese.',
            'Only keep English words in the summary when they are necessary identifiers, APIs, package names, commands, or file names.',
            'Keep it under 72 characters.',
            'Do not wrap the answer in Markdown.',
            'Do not add explanations.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            'Staged diff:',
            '```diff',
            diff,
            '```'
          ].join('\n')
        }
      ],
      max_tokens: 80,
      temperature: 0.2
    };

    const data = await this.post(`${this.config.chatBaseUrl}/chat/completions`, body, signal);
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error(`DeepSeek commit message generation returned no text. ${summarizeResponse(data)}`);
    }
    return text;
  }

  private async completeWithFim(context: CompletionContext, signal: AbortSignal): Promise<string> {
    const body = {
      model: this.config.model,
      prompt: context.prefix,
      suffix: context.suffix,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stop: this.config.stop
    };

    const data = await this.post(`${this.config.baseUrl}/completions`, body, signal);
    const text = data.choices?.[0]?.text;
    if (!text) {
      throw new Error('DeepSeek FIM returned no completion text.');
    }
    return text;
  }

  private async completeWithChat(context: CompletionContext, signal: AbortSignal): Promise<string> {
    const body = {
      model: this.config.model,
      messages: [
        {
          role: 'system',
          content: [
            'You are a code completion engine.',
            'Return only the code that should be inserted at the cursor.',
            'Do not explain.',
            'Do not wrap the answer in Markdown.'
          ].join('\n')
        },
        {
          role: 'user',
          content: [
            `Language: ${context.languageId}`,
            `File: ${context.fileName}`,
            'Prefix:',
            '```',
            context.prefix,
            '```',
            'Suffix:',
            '```',
            context.suffix,
            '```'
          ].join('\n')
        }
      ],
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stop: this.config.stop
    };

    const data = await this.post(`${this.config.chatBaseUrl}/chat/completions`, body, signal);
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('DeepSeek chat fallback returned no completion text.');
    }
    return text;
  }

  private createFimCooldownKey(): string {
    return [
      this.config.baseUrl,
      this.config.chatBaseUrl,
      this.config.model
    ].join('|');
  }

  private coolDownFim(key: string): void {
    if (this.config.fimFallbackCooldownMs <= 0) {
      return;
    }

    HttpDeepSeekClient.fimCooldownUntil.set(key, Date.now() + this.config.fimFallbackCooldownMs);
  }

  private static isFimCoolingDown(key: string): boolean {
    const cooldownUntil = HttpDeepSeekClient.fimCooldownUntil.get(key);
    if (!cooldownUntil) {
      return false;
    }

    if (cooldownUntil <= Date.now()) {
      HttpDeepSeekClient.fimCooldownUntil.delete(key);
      return false;
    }

    return true;
  }

  private async post(url: string, body: unknown, signal: AbortSignal): Promise<CompletionResponse> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal
    });

    const responseText = await response.text();
    const data = parseJson(responseText);

    if (!response.ok) {
      const message = data.error?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`DeepSeek API error ${response.status}: ${message}`);
    }

    return data;
  }
}

function parseJson(text: string): CompletionResponse {
  try {
    return JSON.parse(text) as CompletionResponse;
  } catch {
    return {};
  }
}

function summarizeResponse(data: CompletionResponse): string {
  const choice = data.choices?.[0];
  const parts = [
    choice?.finish_reason ? `finish_reason=${choice.finish_reason}` : undefined,
    choice?.message?.reasoning_content ? 'reasoning_content=present' : undefined,
    data.error?.message ? `error=${data.error.message}` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : 'No choices were returned.';
}
