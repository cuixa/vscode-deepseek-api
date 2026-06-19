# DeepSeek Code Completion

A minimal VS Code extension that provides inline code completion through the DeepSeek API.

## Features

- Inline ghost-text completions through `InlineCompletionItemProvider`.
- Supports regular files and Jupyter `.ipynb` code cells.
- DeepSeek FIM completion first, chat completion fallback.
- Git commit message generation from staged changes in the Source Control input box.
- Ask questions about selected editor text with `Ctrl+Alt+D` (`Cmd+Alt+D` on macOS).
- API key stored in VS Code `SecretStorage`.
- Debounce, cancellation, timeout, short-lived cache, and output logging.

## Development

```powershell
npm.cmd install
npm.cmd run compile
```

Press `F5` in VS Code to launch an Extension Development Host.

Run `DeepSeek: Set API Key` before using completion.

To generate a commit message, stage your changes and click the sparkle button in the Source Control toolbar, or run `DeepSeek: Generate Commit Message`.

To ask a question about selected text, select it in the editor, press `Ctrl+Alt+D` (`Cmd+Alt+D` on macOS), then enter a question. The answer is attached to the selection in the editor; hover the highlighted text to read it. Editing the document clears the displayed answer.

## Important Settings

- `deepseekCompletion.model`: defaults to `deepseek-v4-pro`.
- `deepseekCompletion.commitMessageModel`: defaults to `deepseek-v4-flash`.
- `deepseekCompletion.selectionQuestionMaxChars`: defaults to `20000`.
- `deepseekCompletion.selectionQuestionMaxTokens`: defaults to `1024`.
- `deepseekCompletion.baseUrl`: defaults to `https://api.deepseek.com/beta`.
- `deepseekCompletion.chatBaseUrl`: defaults to `https://api.deepseek.com`.
- `deepseekCompletion.maxTokens`: defaults to `128`.
- `deepseekCompletion.enabledLanguages`: controls language IDs where the provider is active.
