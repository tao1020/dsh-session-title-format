# Numbered session titles

Repository: https://github.com/tao1020/dsh-session-title-format

A DeepSeek Harness bundle that replaces the shipped free-form session-title provider and formats every automatic title as:

```
3-[cdc]测试kafkachangefeed
```

- `3` — a stable per-workspace number, handed out in the order sessions first get a title (`1`, `2`, ...), never reused.
- `[cdc]` — one component name chosen by the model from the conversation (repository, product component, or feature).
- `测试kafkachangefeed` — what the user is doing now, in the conversation's language.

Deterministic post-processing guarantees the shape even when the model answers with a bare phrase, its own number, a second bracket pair, Markdown, or quotes.

## Files

| File | Purpose |
| --- | --- |
| `index.js` | Provider registration, prompt, model-output validation |
| `llm.js` | One auxiliary LLM call: route, deadline, stream assembly |
| `format.js` | Title parsing and assembly, byte fitting |
| `numbers.js` | Creation-rank numbering and the frozen registry |
| `cordis.patch.yml` | Disables the shipped provider, inserts this one |
| `test/` | `node --test` unit tests (format, numbers, stream assembly, provider glue) |

## Install

Install the directory as a local bundle (`plugin_manager` `install_bundle`, or **Plugins** > **Add plugin**), then start a new session or send a message in an existing one. No extra dependencies are needed: the plugin imports nothing from DSH. Uninstall or disable the bundle to return to the shipped free-form titles.

## Configuration

`targetWords`, `targetCjkCharacters`, `maxInputBytes`, `maxOutputTokens`, and `timeoutMs` live in `cordis.patch.yml`. The title request reuses the current session's model route.

The number registry lives at `~/.local/state/dsh-session-title-format/numbers.json`; deleting it restarts numbering at `1` for sessions titled afterwards and can duplicate numbers already shown.

See `docs/DETAIL.md` (Chinese) for the rules and limitations.
