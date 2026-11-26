import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const config = {
  targetWords: 6,
  targetCjkCharacters: 14,
  maxInputBytes: 4096,
  maxOutputTokens: 96,
  timeoutMs: 1000,
}

/** Capture the registered provider against a fake context. */
async function loadProvider(configuration = config) {
  process.env.HOME = mkdtempSync(join(tmpdir(), 'title-home-'))
  const plugin = await import('../index.js')
  let provider
  const ctx = {
    logger: { warn() {}, info() {} },
    sessionTitle: { register(candidate) { provider = candidate } },
    llm: {
      prepareCall() {
        return Promise.resolve({
          config: { provider: 'fake', model: 'fake-model' },
          stream: async function* stream() {
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: '1-[cdc]测试kafka' }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: '1-[cdc]测试kafka' } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        })
      },
    },
  }
  plugin.apply(ctx, configuration)
  return { provider, plugin }
}

function request(header) {
  return {
    session: {
      id: header.id,
      header,
      append() {},
    },
    messages: [{ seq: 3, text: '帮我测一下 kafka changefeed' }],
    route: { provider: 'fake', model: 'fake-model' },
    signal: new AbortController().signal,
  }
}

test('the plugin registers one all-prompts provider', async () => {
  const { provider, plugin } = await loadProvider()
  assert.equal(plugin.name, 'session-title-format')
  assert.deepEqual(plugin.inject, ['llm', 'sessionTitle'])
  assert.equal(provider.automatic, 'all-prompts')
  assert.equal(provider.id, 'session-title-format')
})

test('the first titled session is numbered 1 and keeps it', async () => {
  const { provider } = await loadProvider()
  const first = await provider.generate(request({ id: 's1', cwd: '/w', createdAt: 1 }))
  assert.equal(first.title, '1-[cdc]测试kafka')
  const again = await provider.generate(request({ id: 's1', cwd: '/w', createdAt: 1 }))
  assert.equal(again.title, '1-[cdc]测试kafka')
})

test('subagent sessions are titled without a number', async () => {
  const { provider } = await loadProvider()
  const subagent = await provider.generate(request({ id: 's2', cwd: '/w', createdAt: 2, origin: 'subagent' }))
  assert.equal(subagent.title, '[cdc]测试kafka')
})

test('invalid configuration fails at apply time with a clear message', async () => {
  await assert.rejects(() => loadProvider({ ...config, timeoutMs: 0 }), /timeoutMs must be a positive integer/)
})
