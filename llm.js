/** One auxiliary model call for a session title, without depending on bundled packages. */

import { randomUUID } from 'node:crypto'

/** Largest delay `setTimeout` accepts; larger values fire immediately. */
const MAX_TIMER_DELAY_MS = 2147483647

/** Reject a value that is not a positive integer. */
function assertPositiveInteger(field, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title-format: ${field} must be a positive integer`)
  }
  return value
}

/**
 * Validate and detach the execution controls of the plugin configuration.
 * @param config - raw Cordis row configuration.
 * @returns the four positive-integer bounds plus the optional route pair.
 */
export function resolveExecutionConfig(config) {
  const value = config ?? {}
  const timeoutMs = assertPositiveInteger('timeoutMs', value.timeoutMs)
  if (timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`session-title-format: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const hasProvider = value.provider !== undefined
  if (hasProvider !== (value.model !== undefined)) {
    throw new Error('session-title-format: provider and model must be supplied together')
  }
  if (hasProvider && (typeof value.provider !== 'string' || value.provider.length === 0 || typeof value.model !== 'string' || value.model.length === 0)) {
    throw new Error('session-title-format: provider and model overrides must be non-empty strings')
  }
  return {
    maxInputBytes: assertPositiveInteger('maxInputBytes', value.maxInputBytes),
    maxOutputTokens: assertPositiveInteger('maxOutputTokens', value.maxOutputTokens),
    timeoutMs,
    ...hasProvider ? { provider: value.provider, model: value.model } : {},
  }
}

/** Build one identified user message holding the title input. */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'dsh-session-title-format' },
  }
}

/** Combine the caller's cancellation with this request's own time budget. */
function requestDeadline(signal, timeoutMs) {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
}

/** Turn one terminal failure chunk into a thrown error. */
function throwOnFailure(finish) {
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const error = new Error(finish.failure.message)
    error.code = finish.failure.code
    throw error
  }
}

/** Assemble text blocks and the terminal finish reason from raw chunks. */
export async function assembleChunks(stream, signal = new AbortController().signal) {
  const partials = new Map()
  const order = []
  let finish
  for await (const chunk of stream) {
    signal.throwIfAborted()
    switch (chunk.type) {
      case 'block-start': {
        if (!partials.has(chunk.index)) {
          order.push(chunk.index)
          partials.set(chunk.index, { blockType: chunk.blockType, text: '' })
        }
        break
      }
      case 'text-delta': {
        let partial = partials.get(chunk.index)
        if (partial === undefined) {
          order.push(chunk.index)
          partial = { blockType: 'text', text: '' }
          partials.set(chunk.index, partial)
        }
        if (partial.blockType === 'text') partial.text += chunk.text
        break
      }
      case 'finish': {
        finish = chunk.reason
        break
      }
      default: break
    }
  }
  if (finish === undefined) throw new Error('session-title-format: title stream ended without a finish reason')
  throwOnFailure(finish)
  const blocks = order
    .map(index => partials.get(index))
    .filter(partial => partial !== undefined && partial.blockType === 'text')
    .map(partial => ({ type: 'text', text: partial.text }))
  return { blocks, finish }
}

/**
 * Execute one prepared auxiliary title request on the session's own route.
 * @param ctx - context exposing the LLM and session services.
 * @param config - validated execution controls.
 * @param request - service-owned session, route, messages, and cancellation.
 * @param titleProvider - registered provider identity recorded with the request.
 * @param prepared - system prompt, framed input, source message seqs, and reasoning selector.
 * @returns assembled text blocks, the terminal finish, and the exact route used.
 */
export async function executeTitleRequest(ctx, config, request, titleProvider, prepared) {
  request.signal.throwIfAborted()
  if (prepared.messageSeqs.length === 0) throw new Error('session-title-format: at least one source message is required')
  const inputBytes = Buffer.byteLength(prepared.input, 'utf8')
  if (inputBytes > config.maxInputBytes) {
    throw new Error(`session-title-format: input is ${inputBytes} bytes, exceeding maxInputBytes ${config.maxInputBytes}`)
  }
  const route = config.provider !== undefined && config.model !== undefined
    ? { provider: config.provider, model: config.model }
    : request.route
  if (route === undefined) {
    throw new Error('session-title-format: no logged request route is available; configure provider and model together')
  }
  const messages = [userMessage(prepared.input)]
  const signal = requestDeadline(request.signal, config.timeoutMs)
  const maxTokens = config.maxOutputTokens
  const call = await ctx.llm.prepareCall({ ...route, maxTokens }, signal, (controls, model) => {
    const effort = prepared.selectReasoningEffort(model)
    return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
  })
  const options = {
    ...call.config,
    messages,
    system: prepared.system,
    sessionId: request.session.id,
    purpose: 'session-title',
    signal,
  }
  request.session.append('session/title-llm-request', {
    titleProvider,
    messageSeqs: [...prepared.messageSeqs],
    route,
    system: prepared.system,
    messages,
    maxTokens,
    ...call.config.reasoningEffort === undefined ? {} : { reasoningEffort: call.config.reasoningEffort },
  })
  signal.throwIfAborted()
  const { blocks, finish } = await assembleChunks(call.stream(options), signal)
  return { blocks, finish, model: route }
}
