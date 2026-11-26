/**
 * Stable per-workspace session numbering.
 *
 * A session keeps the number it was first given, so renames, restarts, and later
 * topics never move it. A new number is one more than the highest number already
 * handed out in that workspace, so the first session titled after installation is
 * `1` and numbers never repeat, even after sessions are deleted.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Registry of assigned numbers, outside the DSH profile so no profile file is hand-edited. */
export const DEFAULT_STATE_FILE = join(homedir(), '.local', 'state', 'dsh-session-title-format', 'numbers.json')

const STATE_VERSION = 1

/** One session's assigned number and creation time. */
function isEntry(value) {
  return value !== null
    && typeof value === 'object'
    && Number.isSafeInteger(value.ordinal)
    && value.ordinal > 0
    && Number.isSafeInteger(value.createdAt)
    && value.createdAt >= 0
}

/** Accept only the documented shape; anything else is treated as corrupt. */
function isState(value) {
  if (value === null || typeof value !== 'object' || value.version !== STATE_VERSION) return false
  const workspaces = value.workspaces
  if (workspaces === null || typeof workspaces !== 'object' || Array.isArray(workspaces)) return false
  return Object.values(workspaces).every(entries =>
    entries !== null
    && typeof entries === 'object'
    && !Array.isArray(entries)
    && Object.values(entries).every(isEntry))
}

/** Per-workspace, per-session number bookkeeping with atomic writes. */
export class OrdinalRegistry {
  /** @param {string} [stateFile] - registry path; defaults to {@link DEFAULT_STATE_FILE}. */
  constructor(stateFile = DEFAULT_STATE_FILE) {
    this.stateFile = stateFile
    this.state = undefined
  }

  /** Read the registry once; a corrupt file is moved aside instead of overwritten silently. */
  load() {
    if (this.state !== undefined) return this.state
    let text
    try {
      text = readFileSync(this.stateFile, 'utf8')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      this.state = { version: STATE_VERSION, workspaces: {} }
      return this.state
    }
    try {
      const parsed = JSON.parse(text)
      if (!isState(parsed)) throw new Error('unexpected registry shape')
      this.state = parsed
    } catch (error) {
      const aside = `${this.stateFile}.corrupt-${Date.now()}`
      renameSync(this.stateFile, aside)
      console.warn(`session-title-format: registry was unreadable (${String(error)}); moved to ${aside}`)
      this.state = { version: STATE_VERSION, workspaces: {} }
    }
    return this.state
  }

  /** Write the registry atomically so a crash cannot truncate it. */
  save() {
    const state = this.load()
    mkdirSync(dirname(this.stateFile), { recursive: true })
    const temporary = `${this.stateFile}.tmp-${process.pid}`
    writeFileSync(temporary, `${JSON.stringify(state, undefined, 2)}\n`)
    renameSync(temporary, this.stateFile)
  }

  /** Return the frozen number for a session, if it already has one. */
  known(workspace, sessionId) {
    return this.load().workspaces[workspace ?? '']?.[sessionId]?.ordinal
  }

  /**
   * Freeze a number for one session and return it.
   * @param request - workspace path, session id, creation time, and chosen number.
   * @returns the number now stored for the session.
   */
  assign(request) {
    const workspaces = this.load().workspaces
    const entries = workspaces[request.workspace ?? ''] ?? (workspaces[request.workspace ?? ''] = {})
    const existing = entries[request.sessionId]
    if (existing !== undefined) return existing.ordinal
    const used = new Set(Object.entries(entries)
      .filter(([id]) => id !== request.sessionId)
      .map(([, entry]) => entry.ordinal))
    let ordinal = request.ordinal
    while (used.has(ordinal)) ordinal += 1
    entries[request.sessionId] = { ordinal, createdAt: request.createdAt }
    this.save()
    return ordinal
  }

  /** Next unused number in a workspace: one more than the highest already handed out. */
  nextOrdinal(workspace) {
    const entries = Object.values(this.load().workspaces[workspace ?? ''] ?? {})
    if (entries.length === 0) return 1
    return 1 + Math.max(...entries.map(entry => entry.ordinal))
  }
}
