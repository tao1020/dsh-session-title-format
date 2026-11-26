/**
 * Deterministic construction of `<number>-[<component>]<task>` session titles.
 *
 * The model only proposes wording; these helpers guarantee the shape even when
 * it answers with a bare phrase, an extra bracket, its own number, or Markdown.
 */

/** Same byte ceiling the session-title service normalizes to. */
export const MAX_TITLE_BYTES = 120
/** Component names are short; anything longer is model noise. */
const MAX_COMPONENT_CHARS = 24
/** Task wording is capped so the prefix and component never crowd out the title. */
const MAX_TASK_CHARS = 48
/** Used when the model never named a component. */
const PLACEHOLDER_COMPONENT = '其他'

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/gu
const EDGE_QUOTES = /^[`"'“”‘’「」『』*]+|[`"'“”‘’「」『』*]+$/gu
const ORDINAL_PREFIX = /^\d+\s*[-–—:：.、]?\s*/u
const STRUCTURED = /^(?<ordinal>\d+)\s*[-–—:：.、]?\s*\[\s*(?<component>[^[\]\n]{1,40})\s*\]\s*(?<task>.*)$/u
const ANY_BRACKET = /\[\s*([^[\]\n]{1,40})\s*\]/u
const LEADING_SEPARATORS = /^[\s\-–—:：,，;；、.。)）]+/u
const TRAILING_SEPARATORS = /[\s\-–—:：,，;；、]+$/u

/** Collapse control characters and runs of whitespace into single spaces. */
function cleanInline(value) {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/gu, ' ').trim()
}

/** Drop quoting and backtick decoration the model adds around a title. */
function stripQuotes(value) {
  let text = value
  for (let round = 0; round < 3; round += 1) {
    const next = cleanInline(text.replace(EDGE_QUOTES, ''))
    if (next === text) break
    text = next
  }
  return text
}

/** Take the first non-empty line, ignoring code fences and asterisk emphasis around the whole line. */
function firstMeaningfulLine(output) {
  const line = output
    .split(/\r?\n/u)
    .map(item => item.trim())
    .find(item => item.length > 0 && !item.startsWith('```')) ?? ''
  const emphasized = /^\*{1,3}(\S(?:.*\S)?)\*{1,3}$/u.exec(line)
  return stripQuotes(emphasized === null ? line : emphasized[1])
}

/** Keep one short, bracket-free component name. */
function cleanComponent(value) {
  const text = cleanInline(value).replace(/[[\]]/gu, '').trim()
  if (text.length === 0) return PLACEHOLDER_COMPONENT
  return Array.from(text).slice(0, MAX_COMPONENT_CHARS).join('')
}

/** Trim separators, cap the length, and return '' when nothing usable is left. */
function cleanTask(value) {
  const text = cleanInline(value)
    .replace(/[[\]{}]/gu, '')
    .replace(LEADING_SEPARATORS, '')
    .replace(TRAILING_SEPARATORS, '')
  return Array.from(text).slice(0, MAX_TASK_CHARS).join('').trim()
}

/** Split model output into component and task, tolerating decoration and stray numbers. */
function splitTitle(output) {
  const line = firstMeaningfulLine(output)
  if (line.length === 0) return undefined
  const structured = STRUCTURED.exec(line)
  if (structured?.groups !== undefined) {
    const rest = (structured.groups['task'] ?? '').replace(/^(?:\s*\[[^[\]]{1,40}\])+/u, '')
    const task = cleanTask(rest)
    if (task.length > 0) return { component: cleanComponent(structured.groups['component'] ?? ''), task }
  }
  const bracketed = ANY_BRACKET.exec(line)
  if (bracketed !== null) {
    const rest = `${line.slice(0, bracketed.index)} ${line.slice(bracketed.index + bracketed[0].length)}`
    const task = cleanTask(rest.replace(ORDINAL_PREFIX, ''))
    if (task.length > 0) return { component: cleanComponent(bracketed[1] ?? ''), task }
  }
  const task = cleanTask(line.replace(ORDINAL_PREFIX, ''))
  return task.length === 0 ? undefined : { component: PLACEHOLDER_COMPONENT, task }
}

/** Remove trailing code points until the title fits the service's byte ceiling. */
function fitTitle(title) {
  const chars = Array.from(title)
  while (chars.length > 0 && Buffer.byteLength(chars.join(''), 'utf8') > MAX_TITLE_BYTES) chars.pop()
  return chars.join('').replace(TRAILING_SEPARATORS, '').trim()
}

/**
 * Build the final title from model text.
 * @param output - raw model text; the first meaningful line is used.
 * @param ordinal - stable workspace number, or `undefined` for a subagent session.
 * @returns the formatted title, or `undefined` when the model produced nothing usable.
 */
export function formatTitleFromText(output, ordinal) {
  const split = splitTitle(output)
  if (split === undefined) return undefined
  const prefix = ordinal === undefined ? '' : `${ordinal}-`
  return fitTitle(`${prefix}[${split.component}]${split.task}`)
}
