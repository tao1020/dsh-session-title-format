import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { OrdinalRegistry } from '../numbers.js'

function registryFile() {
  return join(mkdtempSync(join(tmpdir(), 'title-numbers-')), 'numbers.json')
}

test('the first titled session in a workspace is 1 and the next is 2', () => {
  const registry = new OrdinalRegistry(registryFile())
  assert.equal(registry.nextOrdinal('/w'), 1)
  assert.equal(registry.assign({ workspace: '/w', sessionId: 'a', createdAt: 100, ordinal: 1 }), 1)
  assert.equal(registry.nextOrdinal('/w'), 2)
  assert.equal(registry.assign({ workspace: '/w', sessionId: 'b', createdAt: 200, ordinal: 2 }), 2)
  assert.equal(registry.nextOrdinal('/w'), 3)
})

test('a number is frozen on first use and survives restarts', () => {
  const file = registryFile()
  const first = new OrdinalRegistry(file)
  assert.equal(first.assign({ workspace: '/w', sessionId: 'a', createdAt: 100, ordinal: 1 }), 1)
  const restarted = new OrdinalRegistry(file)
  assert.equal(restarted.known('/w', 'a'), 1)
  assert.equal(restarted.assign({ workspace: '/w', sessionId: 'a', createdAt: 100, ordinal: 1 }), 1)
  assert.equal(restarted.nextOrdinal('/w'), 2)
})

test('an unknown session has no number yet', () => {
  const registry = new OrdinalRegistry(registryFile())
  assert.equal(registry.known('/w', 'missing'), undefined)
})

test('workspaces keep independent numbers', () => {
  const registry = new OrdinalRegistry(registryFile())
  registry.assign({ workspace: '/a', sessionId: 'a1', createdAt: 1, ordinal: 1 })
  registry.assign({ workspace: '/b', sessionId: 'b1', createdAt: 1, ordinal: 1 })
  registry.assign({ workspace: '/a', sessionId: 'a2', createdAt: 2, ordinal: 2 })
  assert.equal(registry.known('/a', 'a2'), 2)
  assert.equal(registry.known('/b', 'b1'), 1)
  assert.equal(registry.nextOrdinal('/b'), 2)
})

test('a reused number is bumped so live sessions stay unique', () => {
  const registry = new OrdinalRegistry(registryFile())
  registry.assign({ workspace: '/w', sessionId: 'a', createdAt: 100, ordinal: 1 })
  registry.assign({ workspace: '/w', sessionId: 'b', createdAt: 200, ordinal: 2 })
  assert.equal(registry.assign({ workspace: '/w', sessionId: 'c', createdAt: 300, ordinal: 2 }), 3)
})

test('a corrupt registry is moved aside instead of crashing', () => {
  const file = registryFile()
  writeFileSync(file, 'not json')
  const registry = new OrdinalRegistry(file)
  assert.equal(registry.assign({ workspace: '/w', sessionId: 'a', createdAt: 100, ordinal: 1 }), 1)
  assert.ok(readdirSync(join(file, '..')).some(name => name.startsWith('numbers.json.corrupt-')))
})
