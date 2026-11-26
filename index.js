/** Automatic session titles shaped as `<number>-[<component>]<task>`. */

import { executeTitleRequest, resolveExecutionConfig } from './llm.js'
import { formatTitleFromText } from './format.js'
import { OrdinalRegistry } from './numbers.js'

export const name = 'session-title-format'
export const inject = ['llm', 'sessionTitle']

/** Validate one positive title-length target. */
function assertTarget(field, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title-format: ${field} must be a positive integer`)
  }
  return value
}

/** Validate and detach the plugin configuration. */
function resolveConfig(config) {
  const { targetWords, targetCjkCharacters, ...execution } = config ?? {}
  return {
    ...resolveExecutionConfig(execution),
    targetWords: assertTarget('targetWords', targetWords),
    targetCjkCharacters: assertTarget('targetCjkCharacters', targetCjkCharacters),
  }
}

/**
 * Resolve the session's frozen number, assigning one on first use.
 * @param registry - per-workspace number bookkeeping.
 * @param header - the session's immutable creation metadata.
 * @returns the number, or `undefined` for subagent sessions.
 */
function ordinalFor(registry, header) {
  if (header.origin === 'subagent') return undefined
  const workspace = header.cwd ?? ''
  const known = registry.known(workspace, header.id)
  if (known !== undefined) return known
  return registry.assign({
    workspace,
    sessionId: header.id,
    createdAt: header.createdAt,
    ordinal: registry.nextOrdinal(workspace),
  })
}

/** Keep title requests on the route's cheapest reasoning effort. */
const selectReasoningEffort = model => model.reasoning?.efforts[0]?.id

/** Format instruction; stability rules apply only when a provider title is anchored. */
function systemPrompt(config, hasOrdinal, hasCurrentTitle) {
  return [
    'You name sessions of an AI coding assistant. A title names the component the work belongs to and what the user is doing now.',
    'Return exactly one line in plain text, in this shape:',
    hasOrdinal ? '<number>-[<component>]<task>' : '[<component>]<task>',
    ...hasOrdinal ? [
      'Start with the integer from the input JSON "number" field, followed by one hyphen. Print that number unchanged; never count sessions yourself and never invent a different number.',
    ] : [],
    'Then exactly one component in square brackets: the repository, product component, or feature the work belongs to, such as clinic, cdc, premium, essential, or 集成. Prefer the most specific name the messages support; keep it to one to three words and at most 24 characters, lowercase for English. Never write a second bracket pair.',
    'Then the current task with no space after the closing bracket: what the user asks for or is doing, not the tools used and not a file path.',
    'Write the task in the language the human messages use.',
    `Aim for about ${config.targetWords} words or ${config.targetCjkCharacters} CJK characters in the task part; shorter is fine for a simple topic.`,
    'No quotes, no Markdown, no explanation, no trailing period, no second line.',
    'Never include secrets, tokens, or terminal control characters.',
    ...hasCurrentTitle ? [
      'An existing title is supplied as currentTitle. If it still accurately describes the main topic or task, return it exactly unchanged, including its number and bracket.',
      'Follow-up questions, extra detail within the same topic, and acknowledgements do not justify a new title. Change it only when the topic materially changes.',
    ] : [],
  ].join('\n')
}

/** Frame messages as JSON so user text cannot break structural delimiters. */
function frameMessages(messages, ordinal, currentTitle) {
  const body = ordinal === undefined
    ? { messages, ...currentTitle === undefined ? {} : { currentTitle } }
    : { number: ordinal, messages, ...currentTitle === undefined ? {} : { currentTitle } }
  return `${currentTitle === undefined ? 'Generate' : 'Update'} the session title from this JSON object:\n${JSON.stringify(body)}`
}

/** Reject non-text or truncated output and join the text blocks in stream order. */
function textFromResponse(response) {
  if (response.finish.kind === 'tool-calls' || response.blocks.some(block => block.type === 'tool-call')) {
    throw new Error('session-title-format: title output must contain text only')
  }
  if (response.finish.kind === 'max-tokens') {
    throw new Error('session-title-format: title output reached maxOutputTokens')
  }
  if (response.finish.kind !== 'stop') {
    throw new Error(`session-title-format: unexpected title finish "${String(response.finish.kind)}"`)
  }
  return response.blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/**
 * Register the `<number>-[<component>]<task>` title provider.
 * @param ctx - context exposing session-title and LLM services.
 * @param config - route, length targets, byte, token, and timeout policy.
 */
export function apply(ctx, config) {
  const resolved = resolveConfig(config)
  const registry = new OrdinalRegistry()
  const titleProvider = name
  ctx.sessionTitle.register({
    id: titleProvider,
    automatic: 'all-prompts',
    async generate(request) {
      const messageSeqs = request.messages.map(message => message.seq)
      const header = request.session.header
      const ordinal = ordinalFor(registry, header)
      const anchor = request.currentTitle?.source.kind === 'provider' ? request.currentTitle.title : undefined
      const response = await executeTitleRequest(ctx, resolved, request, titleProvider, {
        system: systemPrompt(resolved, ordinal !== undefined, anchor !== undefined),
        input: frameMessages(request.messages, ordinal, anchor),
        messageSeqs,
        selectReasoningEffort,
      })
      const title = formatTitleFromText(textFromResponse(response), ordinal)
      if (title === undefined) throw new Error('session-title-format: title output contained no usable words')
      return { title, messageSeqs, model: response.model }
    },
  })
}
