import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const script = path.resolve(testDirectory, '..', 'scripts', 'worktree.mjs')
const skillsDirectory = path.resolve(testDirectory, '..', '..')
const shell = process.platform === 'win32' ? 'powershell' : 'shell'

const command = (program, arguments_, cwd) => {
  const result = spawnSync(program, arguments_, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
  if (result.status !== 0) {
    throw new Error(`${program} ${arguments_.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

const git = (cwd, ...arguments_) => command('git', arguments_, cwd)

const run = (cwd, operation, options = {}) => {
  const arguments_ = [script, operation]
  for (const [key, value] of Object.entries({ ...options, shell })) {
    if (value === undefined || value === '') continue
    arguments_.push(`--${key}`)
    if (value !== true) arguments_.push(String(value))
  }
  return spawnSync(process.execPath, arguments_, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
}

const runLauncher = (cwd, operation, arguments_) => {
  const extension = process.platform === 'win32' ? 'ps1' : 'sh'
  const launcher = path.join(skillsDirectory, operation, 'scripts', `${operation}.${extension}`)
  const commandName = process.platform === 'win32' ? 'pwsh' : 'bash'
  const launcherArguments = process.platform === 'win32'
    ? ['-NoProfile', '-File', launcher, ...arguments_]
    : [launcher, ...arguments_]
  return spawnSync(commandName, launcherArguments, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
}

const values = (stdout) => Object.fromEntries(
  stdout.split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const separator = line.indexOf('=')
      return [line.slice(0, separator), line.slice(separator + 1)]
    })
)

const fixture = () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'worktree-package-'))
  const seed = path.join(fixtureRoot, 'seed')
  const repoRoot = path.join(fixtureRoot, 'repo')
  mkdirSync(seed)
  git(seed, 'init', '-b', 'main')
  git(seed, 'config', 'user.name', 'Worktree Package Tests')
  git(seed, 'config', 'user.email', 'worktree-tests@example.invalid')
  writeFileSync(path.join(seed, '.gitignore'), '.agents/\n.codex/\n.issues/\n.lean-spec/\n')
  git(seed, 'add', '.gitignore')
  git(seed, 'commit', '-m', 'chore: initialize fixture')

  mkdirSync(repoRoot)
  command('git', ['clone', '--bare', seed, path.join(repoRoot, '.git')], fixtureRoot)
  git(repoRoot, 'worktree', 'add', path.join(repoRoot, 'main'), 'main')
  git(path.join(repoRoot, 'main'), 'config', 'user.name', 'Worktree Package Tests')
  git(path.join(repoRoot, 'main'), 'config', 'user.email', 'worktree-tests@example.invalid')
  for (const directoryName of ['.agents', '.codex', '.issues', '.lean-spec']) {
    mkdirSync(path.join(repoRoot, 'main', directoryName))
  }

  return {
    repoRoot,
    main: path.join(repoRoot, 'main'),
    cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

const conventionalFixture = () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'worktree-conventional-'))
  const main = path.join(fixtureRoot, 'project')
  mkdirSync(main)
  git(main, 'init', '-b', 'main')
  git(main, 'config', 'user.name', 'Worktree Package Tests')
  git(main, 'config', 'user.email', 'worktree-tests@example.invalid')
  writeFileSync(path.join(main, '.gitignore'), '.agents/\n.codex/\n.issues/\n.lean-spec/\n')
  git(main, 'add', '.gitignore')
  git(main, 'commit', '-m', 'chore: initialize fixture')

  return {
    repoRoot: main,
    main,
    cleanup: () => rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

const isolate = (context, branch) => {
  const result = run(context.main, 'isolate', {
    'repo-root': context.repoRoot,
    branch,
    base: 'main',
    prompt: 'Implement the fixture change.'
  })
  assert.equal(result.status, 0, result.stderr)
  const output = values(result.stdout)
  assert.equal(output.state, 'ready')
  assert.equal(output.branch, branch)
  assert.equal(git(context.repoRoot, 'config', '--get', `branch.${branch}.isolate-base`), 'main')
  assert.equal(path.resolve(git(context.repoRoot, 'config', '--get', `branch.${branch}.isolate-worktree`)), path.resolve(output.targetWorktree))
  return output.targetWorktree
}

test('isolate creates a managed sibling worktree', () => {
  const context = fixture()
  try {
    const target = isolate(context, 'feat/isolate-fixture')
    assert.equal(git(target, 'branch', '--show-current'), 'feat/isolate-fixture')
    assert.match(git(context.repoRoot, 'worktree', 'list', '--porcelain'), /branch refs\/heads\/feat\/isolate-fixture/)
  } finally {
    context.cleanup()
  }
})

test('conventional clones create and close sibling worktrees', () => {
  const context = conventionalFixture()
  try {
    const branch = 'feat/conventional-layout'
    const target = isolate(context, branch)
    assert.equal(target, path.join(path.dirname(context.main), 'project-feat-conventional-layout'))
    git(target, 'commit', '--allow-empty', '-m', 'feat: support conventional clones')

    const preview = values(run(target, 'integrate', {
      'repo-root': target,
      branch
    }).stdout)
    assert.equal(preview.state, 'preview')
    assert.equal(preview.repoRoot, context.main)

    const applied = run(context.main, 'integrate', {
      'repo-root': target,
      branch,
      apply: true,
      'preview-token': preview.previewToken
    })
    assert.equal(applied.status, 0, applied.stderr)
    assert.equal(values(applied.stdout).state, 'complete')
    assert.equal(git(context.main, 'log', '-1', '--format=%s'), 'feat: support conventional clones')
  } finally {
    context.cleanup()
  }
})

test('integrate previews successfully and fast-forwards the base before cleanup', () => {
  const context = fixture()
  try {
    const branch = 'feat/integrate-fixture'
    const target = isolate(context, branch)
    git(target, 'commit', '--allow-empty', '-m', 'feat: add fixture behavior')

    const preview = run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch
    })
    assert.equal(preview.status, 0, preview.stderr)
    const previewOutput = values(preview.stdout)
    assert.equal(previewOutput.state, 'preview')
    assert.equal(previewOutput.approvalRequired, 'false')

    const apply = run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch,
      apply: true,
      'preview-token': previewOutput.previewToken
    })
    assert.equal(apply.status, 0, apply.stderr)
    assert.equal(values(apply.stdout).state, 'complete')
    assert.equal(git(context.main, 'log', '-1', '--format=%s'), 'feat: add fixture behavior')
    assert.equal(git(context.repoRoot, 'branch', '--list', branch), '')
  } finally {
    context.cleanup()
  }
})

test('isolate and integrate preserve non-overlapping dirty base changes', () => {
  const context = fixture()
  try {
    writeFileSync(path.join(context.main, 'base-dirty.txt'), 'keep this local change')
    const branch = 'feat/dirty-base'
    const target = isolate(context, branch)
    writeFileSync(path.join(target, 'integrated.txt'), 'land this commit')
    git(target, 'add', 'integrated.txt')
    git(target, 'commit', '-m', 'feat: land alongside dirty base')

    const preview = values(run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch
    }).stdout)
    const apply = run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch,
      apply: true,
      'preview-token': preview.previewToken
    })

    assert.equal(apply.status, 0, apply.stderr)
    assert.equal(values(apply.stdout).state, 'complete')
    assert.equal(readFileSync(path.join(context.main, 'base-dirty.txt'), 'utf8'), 'keep this local change')
    assert.equal(readFileSync(path.join(context.main, 'integrated.txt'), 'utf8'), 'land this commit')
  } finally {
    context.cleanup()
  }
})

test('integrate rejects a stale preview without changing the base', () => {
  const context = fixture()
  try {
    const branch = 'feat/stale-preview'
    const target = isolate(context, branch)
    git(target, 'commit', '--allow-empty', '-m', 'feat: first fixture commit')
    const baseHead = git(context.main, 'rev-parse', 'HEAD')
    const preview = values(run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch
    }).stdout)
    git(target, 'commit', '--allow-empty', '-m', 'feat: second fixture commit')

    const apply = run(context.main, 'integrate', {
      'repo-root': context.repoRoot,
      branch,
      apply: true,
      'preview-token': preview.previewToken
    })
    assert.equal(apply.status, 1)
    assert.match(apply.stderr, /preview is missing or stale/i)
    assert.equal(git(context.main, 'rev-parse', 'HEAD'), baseHead)
  } finally {
    context.cleanup()
  }
})

test('discard reports loss and deletes exactly the approved state', () => {
  const context = fixture()
  try {
    const branch = 'chore/discard-fixture'
    const target = isolate(context, branch)
    writeFileSync(path.join(target, 'committed.txt'), 'discard this commit')
    git(target, 'add', 'committed.txt')
    git(target, 'commit', '-m', 'chore: disposable commit')
    writeFileSync(path.join(target, 'untracked.txt'), 'discard me')

    const previewResult = run(context.main, 'discard', {
      'repo-root': context.repoRoot,
      branch
    })
    assert.equal(previewResult.status, 0, previewResult.stderr)
    const preview = values(previewResult.stdout)
    assert.equal(preview.state, 'preview')
    assert.equal(preview.approvalRequired, 'true')
    assert.equal(preview.lossDetected, 'true')
    assert.equal(preview['commitsToDiscardCount'], '1')
    assert.equal(preview['committedFilesToDiscardCount'], '1')
    assert.equal(preview['committedFilesToDiscard[0]'], 'A\tcommitted.txt')
    assert.equal(preview['untrackedFilesToDiscardCount'], '1')

    const apply = run(context.main, 'discard', {
      'repo-root': context.repoRoot,
      branch,
      apply: true,
      'preview-token': preview.previewToken
    })
    assert.equal(apply.status, 0, apply.stderr)
    assert.equal(values(apply.stdout).state, 'complete')
    assert.equal(git(context.repoRoot, 'branch', '--list', branch), '')
  } finally {
    context.cleanup()
  }
})

test('cleanup is deferred when the command runs inside its target worktree', () => {
  const context = fixture()
  try {
    const branch = 'feat/deferred-cleanup'
    const target = isolate(context, branch)
    git(target, 'commit', '--allow-empty', '-m', 'feat: deferred fixture')
    const preview = values(run(target, 'integrate', {
      'repo-root': context.repoRoot,
      branch
    }).stdout)
    const apply = run(target, 'integrate', {
      'repo-root': context.repoRoot,
      branch,
      apply: true,
      'preview-token': preview.previewToken
    })
    assert.equal(apply.status, 0, apply.stderr)
    const output = values(apply.stdout)
    assert.equal(output.state, 'cleanup-pending')
    assert.equal(output.cleanupReason, 'active-session')
    assert.notEqual(git(context.repoRoot, 'branch', '--list', branch), '')

    const cleanupScript = process.platform === 'win32'
      ? output.cleanupScriptPowerShell
      : output.cleanupScriptShell
    const nextCommand = process.platform === 'win32'
      ? output.nextCommandPowerShell
      : output.nextCommandShell
    assert.equal(nextCommand, process.platform === 'win32' ? `& '${cleanupScript}'` : `'${cleanupScript}'`)
    assert.match(readFileSync(cleanupScript, 'utf8'), process.platform === 'win32'
      ? new RegExp(`Set-Location -LiteralPath '${context.main.replace(/\\/g, "\\\\")}'`)
      : new RegExp(`cd '${context.main}'`))

    // The handoff script deliberately starts Codex after cleanup, so this
    // test inspects the generated contract instead of launching a new session.
  } finally {
    context.cleanup()
  }
})

test('platform launchers preserve the managed lifecycle contract', () => {
  const context = fixture()
  try {
    const integrateBranch = 'feat/launcher-integration'
    const isolateArguments = process.platform === 'win32'
      ? ['-RepoRoot', context.repoRoot, '-BranchName', integrateBranch, '-BaseBranch', 'main', '-HandoffPrompt', 'Test the launchers.']
      : [context.repoRoot, integrateBranch, 'main', 'Test the launchers.']
    const isolated = runLauncher(context.main, 'isolate', isolateArguments)
    assert.equal(isolated.status, 0, isolated.stderr)
    const target = values(isolated.stdout).targetWorktree
    git(target, 'commit', '--allow-empty', '-m', 'feat: exercise launchers')

    const previewArguments = process.platform === 'win32'
      ? ['-RepoRoot', context.repoRoot, '-BranchName', integrateBranch]
      : [context.repoRoot, integrateBranch]
    const preview = runLauncher(context.main, 'integrate', previewArguments)
    assert.equal(preview.status, 0, preview.stderr)
    const previewOutput = values(preview.stdout)
    assert.equal(previewOutput.state, 'preview')

    const applyArguments = process.platform === 'win32'
      ? ['-RepoRoot', context.repoRoot, '-BranchName', integrateBranch, '-ConfirmIntegrate', '-PreviewToken', previewOutput.previewToken]
      : [context.repoRoot, integrateBranch, '', '', '', '--confirm-integrate', previewOutput.previewToken]
    const applied = runLauncher(context.main, 'integrate', applyArguments)
    assert.equal(applied.status, 0, applied.stderr)
    assert.equal(values(applied.stdout).state, 'complete')

    const discardBranch = 'chore/launcher-discard'
    const discardIsolateArguments = process.platform === 'win32'
      ? ['-RepoRoot', context.repoRoot, '-BranchName', discardBranch, '-BaseBranch', 'main']
      : [context.repoRoot, discardBranch, 'main']
    assert.equal(runLauncher(context.main, 'isolate', discardIsolateArguments).status, 0)
    const discardArguments = process.platform === 'win32'
      ? ['-RepoRoot', context.repoRoot, '-BranchName', discardBranch]
      : [context.repoRoot, discardBranch]
    const discarded = runLauncher(context.main, 'discard', discardArguments)
    assert.equal(discarded.status, 0, discarded.stderr)
    assert.equal(values(discarded.stdout).state, 'complete')
  } finally {
    context.cleanup()
  }
})
