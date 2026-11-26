import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleChunks, resolveExecutionConfig } from '../llm.js'

async function* chunks(...items) {
  for (const item of items) yield item
}

const base = {
  maxInputBytes: 4096,
  maxOutputTokens: 64,
  timeoutMs: 1000,
}

test('text deltas are assembled per block in stream order', async () => {
  const stream = chunks(
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '1-[cdc]' },
    { type: 'text-delta', index: 0, text: '测试' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '1-[cdc]测试' } },
    { type: 'finish', reason: { kind: 'stop' } },
  )
  const { blocks, finish } = await assembleChunks(stream)
  assert.deepEqual(blocks, [{ type: 'text', text: '1-[cdc]测试' }])
  assert.equal(finish.kind, 'stop')
})

test('delta-only streams without block-start still assemble', async () => {
  const stream = chunks(
    { type: 'text-delta', index: 0, text: 'a' },
    { type: 'text-delta', index: 0, text: 'b' },
    { type: 'finish', reason: { kind: 'max-tokens' } },
  )
  const { blocks, finish } = await assembleChunks(stream)
  assert.deepEqual(blocks, [{ type: 'text', text: 'ab' }])
  assert.equal(finish.kind, 'max-tokens')
})

test('a stream without a finish reason is rejected', async () => {
  const stream = chunks({ type: 'text-delta', index: 0, text: 'x' })
  await assert.rejects(() => assembleChunks(stream), /ended without a finish reason/)
})

test('an operational finish failure is rethrown with its code', async () => {
  const stream = chunks({ type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'PROVIDER_DOWN' } } })
  await assert.rejects(() => assembleChunks(stream), error => error.message === 'boom' && error.code === 'PROVIDER_DOWN')
})

test('execution config rejects missing, non-positive, and unpaired values', () => {
  assert.throws(() => resolveExecutionConfig({ ...base, timeoutMs: undefined }), /timeoutMs must be a positive integer/)
  assert.throws(() => resolveExecutionConfig({ ...base, maxOutputTokens: 0 }), /maxOutputTokens must be a positive integer/)
  assert.throws(() => resolveExecutionConfig({ ...base, provider: 'p' }), /provider and model must be supplied together/)
  assert.deepEqual(resolveExecutionConfig(base), base)
  assert.deepEqual(
    resolveExecutionConfig({ ...base, provider: 'p', model: 'm' }),
    { ...base, provider: 'p', model: 'm' },
  )
})
