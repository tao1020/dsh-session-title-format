import assert from 'node:assert/strict'
import test from 'node:test'
import { formatTitleFromText, MAX_TITLE_BYTES } from '../format.js'

test('keeps the model wording and overrides its own number', () => {
  assert.equal(formatTitleFromText('3-[cdc]测试kafkachangefeed', 7), '7-[cdc]测试kafkachangefeed')
  assert.equal(formatTitleFromText('99 - [clinic] 修复登录', 12), '12-[clinic]修复登录')
})

test('accepts a bare phrase and uses the placeholder component', () => {
  assert.equal(formatTitleFromText('fix kafka changefeed lag', 4), '4-[其他]fix kafka changefeed lag')
})

test('strips emphasis, quotes, and trailing newlines', () => {
  assert.equal(formatTitleFromText('**“2-[premium]调整计费”**\nand a second line', 1), '1-[premium]调整计费')
  assert.equal(formatTitleFromText('```\n1-[essential]扩容测试\n```', 2), '2-[essential]扩容测试')
})

test('drops surplus brackets', () => {
  assert.equal(formatTitleFromText('5-[cdc][clinic]测试变更流', 5), '5-[cdc]测试变更流')
})

test('omits the number for subagent sessions', () => {
  assert.equal(formatTitleFromText('9-[集成]跑一遍冒烟测试', undefined), '[集成]跑一遍冒烟测试')
})

test('returns undefined when the model produced no words', () => {
  assert.equal(formatTitleFromText('', 3), undefined)
  assert.equal(formatTitleFromText('   \n\n - [ ] ', 3), undefined)
})

test('fits the service byte ceiling without cutting the prefix', () => {
  const title = formatTitleFromText(`2-[cdc]${'测'.repeat(80)}`, 2)
  assert.ok(Buffer.byteLength(title, 'utf8') <= MAX_TITLE_BYTES)
  assert.ok(title.startsWith('2-[cdc]测'))
})
