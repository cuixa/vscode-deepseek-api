import { CompletionContext } from './contextBuilder';

export function postProcessCompletion(raw: string, context: CompletionContext): string {
  let text = raw.replace(/\r\n/g, '\n').trimEnd();
  text = stripMarkdownFence(text);
  text = stripRepeatedLinePrefix(text, context.linePrefix);
  text = trimOverlongBlankTail(text);

  if (text.trim().length === 0) {
    return '';
  }

  return text;
}

function stripMarkdownFence(text: string): string {
  const fenceMatch = text.match(/^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/);
  if (fenceMatch) {
    return fenceMatch[1].trimEnd();
  }
  return text.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/\n?```$/, '').trimEnd();
}

function stripRepeatedLinePrefix(text: string, linePrefix: string): string {
  const trimmedPrefix = linePrefix.trim();
  if (!trimmedPrefix) {
    return text;
  }

  const trimmedTextStart = text.trimStart();
  if (!trimmedTextStart.startsWith(trimmedPrefix)) {
    return text;
  }

  const leadingWhitespaceLength = text.length - trimmedTextStart.length;
  const afterPrefix = trimmedTextStart.slice(trimmedPrefix.length);
  return text.slice(0, leadingWhitespaceLength) + afterPrefix;
}

function trimOverlongBlankTail(text: string): string {
  return text.replace(/\n{3,}[\s\S]*$/, '\n\n').trimEnd();
}
