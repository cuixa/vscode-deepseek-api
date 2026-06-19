import * as vscode from 'vscode';

export interface ExtensionConfig {
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  chatBaseUrl: string;
  model: string;
  commitMessageModel: string;
  commitMessageMaxDiffChars: number;
  selectionQuestionMaxChars: number;
  selectionQuestionMaxTokens: number;
  maxTokens: number;
  temperature: number;
  debounceMs: number;
  requestTimeoutMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
  fimFallbackCooldownMs: number;
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
    commitMessageModel: config.get<string>('commitMessageModel', 'deepseek-v4-flash'),
    commitMessageMaxDiffChars: config.get<number>('commitMessageMaxDiffChars', 12000),
    selectionQuestionMaxChars: config.get<number>('selectionQuestionMaxChars', 20000),
    selectionQuestionMaxTokens: config.get<number>('selectionQuestionMaxTokens', 1024),
    maxTokens: config.get<number>('maxTokens', 128),
    temperature: config.get<number>('temperature', 0.1),
    debounceMs: config.get<number>('debounceMs', 300),
    requestTimeoutMs: config.get<number>('requestTimeoutMs', 10000),
    cacheTtlMs: config.get<number>('cacheTtlMs', 120000),
    cacheMaxEntries: config.get<number>('cacheMaxEntries', 300),
    fimFallbackCooldownMs: config.get<number>('fimFallbackCooldownMs', 300000),
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
