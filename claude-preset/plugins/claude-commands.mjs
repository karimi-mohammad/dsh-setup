// Preset-local plugin: exposes Claude Code custom commands
// (`<projectRoot>/.claude/commands/**/*.md` and `~/.claude/commands/**/*.md`)
// as native slash commands of this harness.
//
// Claude semantics reproduced here:
// - the command name comes from the file path; subdirectories namespace the
//   name with `-`, because this registry only accepts `[a-z0-9_-]`;
// - YAML frontmatter is stripped; `description` and `argument-hint` feed the
//   command catalog;
// - `$ARGUMENTS` is replaced by the raw input and `$1`..`$9` by positional
//   arguments; when neither placeholder exists, arguments are appended;
// - a project's own command file shadows `~/.claude/commands` for that
//   workspace.
//
// Registration is name-static while command sets are per-project, so this
// plugin keeps ONE registration per discovered name and resolves the markdown
// at EXECUTION time from the invoking agent's own workspace (project root =
// nearest `.git` ancestor). The live set refreshes on agent/created and
// agent/disposed. Claude's newer `` !`command` `` execution and `@file`
// references are intentionally not interpreted.
import { readFile, readdir } from 'node:fs/promises'
import { join, relative, sep, dirname } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const COMMANDS_DIR = '.claude'
const MAX_DEPTH = 4
const MAX_FILE_BYTES = 262144

function expandHome(p) {
  if (p !== undefined && /^~([\\/]|$)/.test(p)) return join(homedir(), p.slice(1))
  return p
}

async function importHarnessPackage(...segments) {
  const dshHome = expandHome(process.env.DSH_HOME) ?? join(homedir(), '.dsh')
  const bases = [join(dshHome, 'profiles', 'node_modules'), join(dshHome, 'node_modules')]
  let lastError
  for (const base of bases) {
    try {
      return await import(pathToFileURL(join(base, ...segments)).href)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

const { createUserMessage } = await importHarnessPackage('@deepseek-ai', 'dsh-llm', 'lib', 'index.js')

const name = 'claude-commands'
const inject = ['commands']

export function apply(ctx) {
  const liveCwds = new Set()
  const registered = new Map()
  const meta = new Map()

  function userCommandsRoot() {
    return join(homedir(), '.claude', 'commands')
  }

  async function pathExists(path) {
    try {
      await readFile(path)
      return true
    } catch {
      return false
    }
  }

  async function findProjectRoot(cwd) {
    let current = cwd
    for (;;) {
      if (await pathExists(join(current, '.git'))) return current
      const parent = dirname(current)
      if (parent === current) return cwd
      current = parent
    }
  }

  async function listCommandFiles(root, depth = 0) {
    const found = []
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return found
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(root, entry.name)
      if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) found.push(...(await listCommandFiles(full, depth + 1)))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        found.push({ rel: relative(root, full).split(sep).join('/'), path: full })
      }
    }
    return found
  }

  function commandNameFor(rel) {
    const base = rel.replace(/\.md$/i, '').toLowerCase().split('/').join('-')
    return /^[a-z0-9][a-z0-9_-]*$/.test(base) ? base : undefined
  }

  function parseFrontmatter(raw) {
    if (!raw.startsWith('---')) return { data: {}, body: raw }
    const end = raw.indexOf('\n---', 3)
    if (end < 0) return { data: {}, body: raw }
    const head = raw.slice(3, end)
    const bodyStart = raw.indexOf('\n', end + 1)
    const data = {}
    for (const line of head.split('\n')) {
      const match = /^([A-Za-z][\w-]*):\s*(.*)\r?$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      data[match[1].toLowerCase()] = value
    }
    return { data, body: raw.slice(bodyStart + 1) }
  }

  function substituteArguments(body, rawInput) {
    const trimmed = rawInput.trim()
    const positional = trimmed === '' ? [] : trimmed.split(/\s+/)
    let out = body.split('$ARGUMENTS').join(trimmed)
    for (let i = 0; i < positional.length && i < 9; i += 1) {
      out = out.split(`$${i + 1}`).join(positional[i])
    }
    if (trimmed !== '' && !body.includes('$ARGUMENTS') && !/\$\d/.test(body)) {
      out = `${out.trimEnd()}\n\n${trimmed}`
    }
    return out
  }

  async function readCommandText(cwd, cmdName) {
    const roots = [join(await findProjectRoot(cwd), COMMANDS_DIR, 'commands'), userCommandsRoot()]
    for (const root of roots) {
      for (const file of await listCommandFiles(root)) {
        if (commandNameFor(file.rel) !== cmdName) continue
        const content = await readFile(file.path, { encoding: 'utf8' }).catch(() => undefined)
        if (content !== undefined && Buffer.byteLength(content) <= MAX_FILE_BYTES) return content
      }
    }
    return undefined
  }

  function makeHandler(cmdName) {
    return async ({ agent, rawInput }) => {
      let cwd
      try {
        cwd = agent.session.header.cwd
      } catch {
        return { kind: 'error', text: `Cannot resolve the workspace for /${cmdName}.` }
      }
      if (cwd === undefined) {
        return { kind: 'error', text: `This session has no working directory; /${cmdName} cannot be resolved.` }
      }
      const raw = await readCommandText(cwd, cmdName)
      if (raw === undefined) {
        return {
          kind: 'error',
          text: `No Claude command file for /${cmdName} in this workspace (searched the project's ${COMMANDS_DIR}/commands and ~/.claude/commands).`,
        }
      }
      const text = substituteArguments(parseFrontmatter(raw).body, rawInput ?? '')
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
      return { kind: 'success', text: `Submitted Claude command /${cmdName}.` }
    }
  }

  function registerCommand(cmdName) {
    const info = meta.get(cmdName) ?? {}
    const disposer = ctx.commands.register({
      name: cmdName,
      description: info.description ?? `Claude custom command ${cmdName}`,
      input: {
        hint: info.hint ?? '[arguments]',
        images: false,
      },
      handler: makeHandler(cmdName),
    })
    registered.set(cmdName, disposer)
  }

  function unregisterCommand(cmdName) {
    const disposer = registered.get(cmdName)
    if (disposer === undefined) return
    registered.delete(cmdName)
    try {
      disposer()
    } catch {
      /* already gone */
    }
  }

  async function collectMetaFromRoot(root) {
    for (const file of await listCommandFiles(root)) {
      const cmdName = commandNameFor(file.rel)
      if (cmdName === undefined || meta.has(cmdName)) continue
      const content = await readFile(file.path, { encoding: 'utf8' }).catch(() => undefined)
      if (content === undefined) continue
      const { data } = parseFrontmatter(content)
      meta.set(cmdName, {
        description: typeof data.description === 'string' && data.description !== '' ? data.description : undefined,
        hint: typeof data['argument-hint'] === 'string' && data['argument-hint'] !== ''
          ? data['argument-hint']
          : undefined,
      })
    }
  }

  async function sync() {
    await collectMetaFromRoot(userCommandsRoot())
    for (const cwd of liveCwds) {
      const projectRoot = await findProjectRoot(cwd)
      await collectMetaFromRoot(join(projectRoot, COMMANDS_DIR, 'commands'))
    }
    for (const cmdName of [...registered.keys()]) {
      if (!meta.has(cmdName)) unregisterCommand(cmdName)
    }
    for (const cmdName of meta.keys()) {
      if (!registered.has(cmdName)) registerCommand(cmdName)
    }
  }

  let syncScheduled = false
  function scheduleSync() {
    if (syncScheduled) return
    syncScheduled = true
    queueMicrotask(() => {
      syncScheduled = false
      void sync().catch(() => {})
    })
  }

  ctx.on('agent/created', ({ agent }) => {
    try {
      const cwd = agent.session.header.cwd
      if (typeof cwd === 'string') liveCwds.add(cwd)
    } catch {
      /* header not ready yet */
    }
    scheduleSync()
  })

  ctx.on('agent/disposed', () => {
    scheduleSync()
  })

  scheduleSync()

  ctx.effect(function* () {
    yield () => {
      for (const cmdName of [...registered.keys()]) unregisterCommand(cmdName)
    }
  }, 'claude-commands registrations')
}

export { name, inject }
