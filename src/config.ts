import * as vscode from 'vscode';

export interface ExtensionConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  chatBaseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
  debounceMs: number;
  requestTimeoutMs: number;
  prefixChars: number;
  suffixChars: number;
  enabledLanguages: string[];
  stop: string[];
}

const SECTION = 'deepseekCompletion';

export async function getConfig(secrets: vscode.SecretStorage): Promise<ExtensionConfig> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const secretApiKey = await secrets.get('deepseekCompletion.apiKey');

  return {
    enabled: config.get<boolean>('enabled', true),
    apiKey: secretApiKey || config.get<string>('apiKey', ''),
    baseUrl: trimTrailingSlash(config.get<string>('baseUrl', 'https://api.deepseek.com/beta')),
    chatBaseUrl: trimTrailingSlash(config.get<string>('chatBaseUrl', 'https://api.deepseek.com')),
    model: config.get<string>('model', 'deepseek-v4-pro'),
    maxTokens: config.get<number>('maxTokens', 128),
    temperature: config.get<number>('temperature', 0.1),
    debounceMs: config.get<number>('debounceMs', 300),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', 10000),
    prefixChars: config.get<number>('prefixChars', 8000),
    suffixChars: config.get<number>('suffixChars', 4000),
    enabledLanguages: config.get<string[]>('enabledLanguages', []),
    stop: config.get<string[]>('stop', ['\n\n\n'])
  };
}

export async function updateEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('enabled', enabled, vscode.ConfigurationTarget.Global);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
