// Preset-local plugin: teaches the shipped filesystem skill provider about
// Claude Code's `<projectRoot>/.claude/skills` root.
//
// It subclasses @deepseek-ai/dsh-skill-filesystem's exported provider and only
// overrides the root list, so frontmatter parsing, ctx.fs-backed reads,
// invocation policy, dedup, and Chokidar watching are all inherited unchanged.
// The inserted root sits between `.dsh/skills` (100) and `.agents/skills`
// (200): lower rank wins within a layer, so a project's own DSH skills may
// still shadow a Claude skill of the same name.
//
// A preset-local file cannot resolve bare package names against the host's
// node_modules, so the two harness packages are imported through absolute
// file: URLs resolved from DSH_HOME at load time.
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

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

const skillFilesystem = await importHarnessPackage('@deepseek-ai', 'dsh-skill-filesystem', 'lib', 'index.js')
const { default: z } = await importHarnessPackage('@deepseek-ai', 'schemastery', 'lib', 'index.mjs')
const { FileSystemSkillProvider } = skillFilesystem

const PROJECT_CLAUDE_RANK = 150
const CUSTOM_CLAUDE_RANK = 300

const name = 'claude-skill-filesystem'
const inject = ['skills']

const Config = z.object({
  providerName: z.string().min(1).default('claude'),
  extraDirs: z.array(z.string()).default([]),
})

class ClaudeAwareSkillProvider extends FileSystemSkillProvider {
  constructor(ctx, control, config = {}) {
    super(ctx, control, config)
    this.extraDirs = (config.extraDirs ?? []).map((root) => resolve(root))
  }

  async roots(cwd) {
    const roots = await super.roots(cwd)
    if (cwd !== undefined) {
      const anchor = roots.findIndex((root) => root.source === 'project-agents')
      if (anchor >= 0 && roots[anchor].projectRoot !== undefined) {
        const projectRoot = roots[anchor].projectRoot
        roots.splice(anchor + 1, 0, {
          path: join(projectRoot, '.claude', 'skills'),
          source: 'project-claude',
          rank: PROJECT_CLAUDE_RANK,
          projectRoot,
        })
      }
    }
    for (const dir of this.extraDirs) {
      roots.push({ path: resolve(dir), source: 'custom-claude', rank: CUSTOM_CLAUDE_RANK })
    }
    return roots
  }
}

export function apply(ctx, config = {}) {
  let provider
  ctx.skills.registerProvider((control) => {
    provider = new ClaudeAwareSkillProvider(ctx, control, config)
    return provider
  })
  ctx.effect(function* () {
    yield async () => {
      await provider.dispose()
    }
  }, 'claude-skill-filesystem watcher')
}

export { name, inject, Config }
