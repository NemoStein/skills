import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const directory = path.dirname(fileURLToPath(import.meta.url))
const skillsDirectory = path.resolve(directory, '..', '..')
const runtime = path.resolve(directory, '..', 'scripts', 'worktree.mjs')
const shell = process.platform === 'win32' ? 'powershell' : 'shell'

const command = (program, arguments_, cwd) => {
  const result = spawnSync(program, arguments_, { cwd, encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, `${program} ${arguments_.join(' ')} failed:\n${result.stderr}`)
  return result.stdout.trim()
}

const git = (cwd, ...arguments_) => command('git', arguments_, cwd)
const values = (output) => Object.fromEntries(output.split(/\r?\n/).filter((line) => line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator), line.slice(separator + 1)]
  }))

const run = (cwd, operation, options = {}) => spawnSync(process.execPath, [
  runtime,
  operation,
  '--shell', shell,
  ...Object.entries(options).flatMap(([key, value]) => value === true ? [`--${key}`] : [`--${key}`, String(value)])
], { cwd, encoding: 'utf8', windowsHide: true })

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'worktree-lifecycle-'))
  const repository = path.join(root, 'repository')
  mkdirSync(repository)
  git(repository, 'init', '-b', 'main')
  git(repository, 'config', 'user.name', 'Worktree Lifecycle Tests')
  git(repository, 'config', 'user.email', 'worktree-tests@example.invalid')
  writeFileSync(path.join(repository, 'README.md'), 'fixture\n')
  git(repository, 'add', 'README.md')
  git(repository, 'commit', '-m', 'chore: initialize fixture')
  return { repository, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('the three skills share the isolate-owned runtime for a complete lifecycle', () => {
  assert.equal(path.basename(runtime), 'worktree.mjs')
  for (const operation of ['isolate', 'integrate', 'discard']) {
    const extension = process.platform === 'win32' ? 'ps1' : 'sh'
    assert.ok(existsSync(path.resolve(skillsDirectory, operation, 'scripts', `${operation}.${extension}`)))
  }

  const context = fixture()
  try {
    const branch = 'feat/lifecycle-test'
    const isolated = run(context.repository, 'isolate', { 'repo-root': context.repository, branch, base: 'main' })
    assert.equal(isolated.status, 0, isolated.stderr)
    const target = values(isolated.stdout).targetWorktree
    git(target, 'commit', '--allow-empty', '-m', 'feat: exercise integration')

    const preview = run(context.repository, 'integrate', { 'repo-root': context.repository, branch })
    assert.equal(preview.status, 0, preview.stderr)
    const previewToken = values(preview.stdout).previewToken
    const integrated = run(context.repository, 'integrate', { 'repo-root': context.repository, branch, apply: true, 'preview-token': previewToken })
    assert.equal(integrated.status, 0, integrated.stderr)
    assert.equal(values(integrated.stdout).state, 'complete')

    const discardedBranch = 'chore/discard-test'
    assert.equal(run(context.repository, 'isolate', { 'repo-root': context.repository, branch: discardedBranch, base: 'main' }).status, 0)
    const discarded = run(context.repository, 'discard', { 'repo-root': context.repository, branch: discardedBranch })
    assert.equal(discarded.status, 0, discarded.stderr)
    assert.equal(values(discarded.stdout).state, 'complete')
  } finally {
    context.cleanup()
  }
})
