import { ExtensionConfig } from './config';
import { CompletionContext } from './contextBuilder';

export interface DeepSeekClient {
  complete(context: CompletionContext, signal: AbortSignal): Promise<string>;
}

interface CompletionChoice {
  text?: string;
  message?: {
    content?: string | null;
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
  public constructor(private readonly config: ExtensionConfig) {}

  public async complete(context: CompletionContext, signal: AbortSignal): Promise<string> {
    try {
      return await this.completeWithFim(context, signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }

      return this.completeWithChat(context, signal);
    }
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
