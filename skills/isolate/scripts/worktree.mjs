#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const operations = new Set(['isolate', 'integrate', 'discard'])
const branchPattern = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert|spec)\/[a-z0-9]+(?:-[a-z0-9]+)*$/
const protectedBranches = new Set(['main', 'master', 'develop', 'trunk'])
const sharedDirectoryNames = ['.agents', '.codex', '.issues', '.lean-spec']
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const skillsDirectory = path.resolve(scriptDirectory, '..', '..')

class WorktreeError extends Error {}

const parseArguments = (arguments_) => {
  const [operation, ...rest] = arguments_
  if (!operations.has(operation)) {
    throw new WorktreeError('Usage: worktree.mjs <isolate|integrate|discard> [options]')
  }

  const options = { operation }
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]
    if (!argument.startsWith('--')) {
      throw new WorktreeError(`Unexpected argument: ${argument}`)
    }

    const key = argument.slice(2)
    if (key === 'apply') {
      options.apply = true
      continue
    }

    const value = rest[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new WorktreeError(`Missing value for ${argument}`)
    }
    options[key] = value
    index += 1
  }

  return options
}

const requiredOption = (options, name) => {
  const value = options[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorktreeError(`Missing required option --${name}`)
  }
  return value
}

const commandResult = (command, arguments_, workingDirectory) => {
  const result = spawnSync(command, arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
    windowsHide: true
  })

  if (result.error) {
    return {
      status: 1,
      stdout: '',
      stderr: result.error.message
    }
  }

  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? '').replace(/\r?\n$/, ''),
    stderr: (result.stderr ?? '').replace(/\r?\n$/, '')
  }
}

const gitResult = (workingTree, arguments_) => commandResult('git', ['-C', workingTree, ...arguments_])

const git = (workingTree, arguments_) => {
  const result = gitResult(workingTree, arguments_)
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new WorktreeError(`git ${arguments_.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }
  return result.stdout
}

const outputLines = (value) => value === '' ? [] : value.split(/\r?\n/)

const normalizePath = (value, base = process.cwd()) => path.resolve(base, value)

const pathKey = (value) => {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const samePath = (left, right) => pathKey(left) === pathKey(right)

const removeSharedLinks = (worktreePath) => {
  for (const directoryName of sharedDirectoryNames) {
    const candidate = path.join(worktreePath, directoryName)
    if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
      unlinkSync(candidate)
    }
  }
}

const quotePowerShell = (value) => `'${String(value).replaceAll("'", "''")}'`

const quoteShell = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

const emit = (key, value) => {
  process.stdout.write(`${key}=${value}\n`)
}

const printList = (key, values) => {
  emit(`${key}Count`, values.length)
  for (const [index, value] of values.entries()) {
    emit(`${key}[${index}]`, value)
  }
}

const validateRoot = (repoRoot) => {
  const resolvedRoot = normalizePath(repoRoot)
  const probe = gitResult(resolvedRoot, ['rev-parse', '--git-common-dir'])
  if (probe.status !== 0) {
    throw new WorktreeError(`<repo-root> must be a Git repository or worktree: ${resolvedRoot}`)
  }

  const probePath = path.join(resolvedRoot, `.worktree-skill-probe-${process.pid}`)
  try {
    writeFileSync(probePath, 'probe')
    rmSync(probePath, { force: true })
  } catch {
    throw new WorktreeError(`<repo-root> is not writable in this session: ${resolvedRoot}`)
  }

  return resolvedRoot
}

const listWorktrees = (repoRoot) => {
  const records = []
  let record = {}

  const finishRecord = () => {
    if (record.path) {
      records.push(record)
    }
    record = {}
  }

  for (const line of outputLines(git(repoRoot, ['worktree', 'list', '--porcelain']))) {
    if (line === '') {
      finishRecord()
    } else if (line.startsWith('worktree ')) {
      record.path = normalizePath(line.slice('worktree '.length))
    } else if (line.startsWith('branch refs/heads/')) {
      record.branch = line.slice('branch refs/heads/'.length)
    } else if (line === 'bare') {
      record.bare = true
    } else if (line === 'detached') {
      record.detached = true
    }
  }
  finishRecord()
  return records
}

const worktreeForBranch = (repoRoot, branch) => listWorktrees(repoRoot).find((record) => record.branch === branch)

const registeredWorktree = (repoRoot, worktreePath) => listWorktrees(repoRoot).find((record) => samePath(record.path, worktreePath))

const branchExists = (repoRoot, branch) => gitResult(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0

const configValue = (repoRoot, key) => {
  const result = gitResult(repoRoot, ['config', '--get', key])
  return result.status === 0 ? result.stdout.trim() : ''
}

const unsetConfig = (repoRoot, key) => {
  gitResult(repoRoot, ['config', '--unset-all', key])
}

const branchMetadata = (repoRoot, branch) => ({
  base: configValue(repoRoot, `branch.${branch}.isolate-base`),
  worktree: configValue(repoRoot, `branch.${branch}.isolate-worktree`)
})

const currentWorktree = () => {
  const inside = gitResult(process.cwd(), ['rev-parse', '--is-inside-work-tree'])
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
    return undefined
  }

  const topLevel = gitResult(process.cwd(), ['rev-parse', '--show-toplevel'])
  const branch = gitResult(process.cwd(), ['branch', '--show-current'])
  if (topLevel.status !== 0 || branch.status !== 0 || branch.stdout.trim() === '') {
    return undefined
  }

  return {
    path: normalizePath(topLevel.stdout.trim()),
    branch: branch.stdout.trim()
  }
}

const requireBranchName = (branch) => {
  if (!branchPattern.test(branch)) {
    throw new WorktreeError('Branch must use type/short-kebab-description, for example feat/power-management.')
  }
}

const resolveManagedTarget = (repoRoot, options, allowCurrentBranch) => {
  const current = currentWorktree()
  const branch = oneLine(options.branch) || (allowCurrentBranch ? current?.branch ?? '' : '')
  if (!branch) {
    throw new WorktreeError('Branch is required when the command is not run from the isolated worktree.')
  }
  requireBranchName(branch)

  const metadata = branchMetadata(repoRoot, branch)
  if (!metadata.base || !metadata.worktree) {
    throw new WorktreeError(`Branch ${branch} has no complete isolate metadata; refusing package cleanup.`)
  }

  const configuredPath = path.isAbsolute(metadata.worktree)
    ? normalizePath(metadata.worktree)
    : normalizePath(metadata.worktree, repoRoot)
  const requestedPath = oneLine(options.worktree)
    ? normalizePath(options.worktree, repoRoot)
    : configuredPath

  if (!samePath(requestedPath, configuredPath)) {
    throw new WorktreeError(`Requested worktree does not match isolate metadata: ${requestedPath}`)
  }

  const record = registeredWorktree(repoRoot, requestedPath)
  if (!record || record.branch !== branch) {
    throw new WorktreeError(`Worktree is not registered for branch ${branch}: ${requestedPath}`)
  }

  const requestedBase = oneLine(options.base)
  if (requestedBase && requestedBase !== metadata.base) {
    throw new WorktreeError(`Requested base ${requestedBase} does not match recorded base ${metadata.base}.`)
  }
  const base = metadata.base
  if (branch === base) {
    throw new WorktreeError(`Target branch cannot equal its base branch: ${branch}`)
  }
  if (!branchExists(repoRoot, branch)) {
    throw new WorktreeError(`Target branch does not exist: ${branch}`)
  }
  if (!branchExists(repoRoot, base)) {
    throw new WorktreeError(`Base branch does not exist: ${base}`)
  }

  const baseRecord = worktreeForBranch(repoRoot, base)
  if (!baseRecord || baseRecord.bare) {
    throw new WorktreeError(`Base branch must have a registered worktree: ${base}`)
  }

  if (samePath(requestedPath, baseRecord.path)) {
    throw new WorktreeError(`Refusing to clean a protected worktree: ${requestedPath}`)
  }

  return {
    repoRoot: baseRecord.path,
    branch,
    base,
    targetPath: requestedPath,
    basePath: baseRecord.path,
    current
  }
}

const snapshot = (context) => {
  const status = outputLines(git(context.targetPath, ['status', '--porcelain=v1', '-uall']))
  const commits = outputLines(git(context.repoRoot, ['log', '--oneline', `${context.base}..${context.branch}`]))
  const committedFiles = outputLines(git(context.repoRoot, ['diff', '--name-status', `${context.base}..${context.branch}`]))
  const untracked = outputLines(git(context.targetPath, ['ls-files', '--others', '--exclude-standard']))
  const baseHead = git(context.repoRoot, ['rev-parse', `refs/heads/${context.base}`]).trim()
  const branchHead = git(context.repoRoot, ['rev-parse', `refs/heads/${context.branch}`]).trim()
  const token = createHash('sha256').update(JSON.stringify({
    branch: context.branch,
    base: context.base,
    targetPath: pathKey(context.targetPath),
    baseHead,
    branchHead,
    status
  })).digest('hex')

  return { status, commits, committedFiles, untracked, baseHead, branchHead, token }
}

const launcherPath = (operation, extension) => path.join(skillsDirectory, operation, 'scripts', `${operation}.${extension}`)

const confirmedCommand = (operation, context, options, token) => {
  const intent = oneLine(options.intent)
  if (options.shell === 'shell') {
    const flag = operation === 'integrate' ? '--confirm-integrate' : '--confirm-discard'
    return [
      'bash',
      quoteShell(launcherPath(operation, 'sh')),
      quoteShell(context.repoRoot),
      quoteShell(context.branch),
      quoteShell(context.targetPath),
      quoteShell(context.base),
      quoteShell(intent),
      flag,
      quoteShell(token)
    ].join(' ')
  }

  const switchName = operation === 'integrate' ? '-ConfirmIntegrate' : '-ConfirmDiscard'
  return [
    '&',
    quotePowerShell(launcherPath(operation, 'ps1')),
    '-RepoRoot',
    quotePowerShell(context.repoRoot),
    '-BranchName',
    quotePowerShell(context.branch),
    '-Worktree',
    quotePowerShell(context.targetPath),
    '-BaseBranch',
    quotePowerShell(context.base),
    '-UserInstruction',
    quotePowerShell(intent),
    switchName,
    '-PreviewToken',
    quotePowerShell(token)
  ].join(' ')
}

const writeRestartScript = (shell, worktreePath, prompt) => {
  if (shell === 'shell') {
    const scriptPath = path.join(tmpdir(), `codex-worktree-restart-${randomUUID()}.sh`)
    const content = `#!/usr/bin/env bash
set -euo pipefail
success=0
cleanup() {
  if [[ "$success" -eq 1 ]]; then rm -f -- "$0"; fi
}
trap cleanup EXIT
cd ${quoteShell(worktreePath)}
success=1
codex ${quoteShell(prompt)}
`
    writeFileSync(scriptPath, content, { mode: 0o700 })
    return {
      commandKey: 'nextCommandShell',
      command: quoteShell(scriptPath),
      scriptKey: 'restartScriptShell',
      scriptPath
    }
  }

  const scriptPath = path.join(tmpdir(), `codex-worktree-restart-${randomUUID()}.ps1`)
  const content = `$success = $false
try {
  Set-Location -LiteralPath ${quotePowerShell(worktreePath)}
  $success = $true
  codex ${quotePowerShell(prompt)}
} finally {
  if ($success) {
    Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
  }
}
`
  writeFileSync(scriptPath, content, 'utf8')
  return {
    commandKey: 'nextCommandPowerShell',
    command: `& ${quotePowerShell(scriptPath)}`,
    scriptKey: 'restartScriptPowerShell',
    scriptPath
  }
}

const writeCleanupScript = (operation, shell, context, prompt) => {
  const branchFlag = operation === 'discard' ? '-D' : '-d'
  const sharedPaths = sharedDirectoryNames.map((directoryName) => path.join(context.targetPath, directoryName))

  if (shell === 'shell') {
    const scriptPath = path.join(tmpdir(), `codex-worktree-cleanup-${randomUUID()}.sh`)
    const content = `#!/usr/bin/env bash
set -euo pipefail
cd ${quoteShell(context.basePath)}
for shared_path in ${sharedPaths.map(quoteShell).join(' ')}; do
  [[ ! -L "$shared_path" ]] || rm -- "$shared_path"
done
git -C ${quoteShell(context.repoRoot)} worktree remove --force ${quoteShell(context.targetPath)}
[[ ! -e ${quoteShell(context.targetPath)} ]] || rm -rf -- ${quoteShell(context.targetPath)}
git -C ${quoteShell(context.repoRoot)} branch ${branchFlag} ${quoteShell(context.branch)}
git -C ${quoteShell(context.repoRoot)} config --unset-all ${quoteShell(`branch.${context.branch}.isolate-base`)} 2>/dev/null || true
git -C ${quoteShell(context.repoRoot)} config --unset-all ${quoteShell(`branch.${context.branch}.isolate-worktree`)} 2>/dev/null || true
[[ ! -e ${quoteShell(context.targetPath)} ]] || { printf '%s\n' ${quoteShell(`Cleanup left the worktree folder behind: ${context.targetPath}`)} >&2; exit 1; }
rm -f -- "$0"
codex ${quoteShell(prompt)}
`
    writeFileSync(scriptPath, content, { mode: 0o700 })
    return {
      scriptPath,
      scriptKey: 'cleanupScriptShell',
      cleanupKey: 'cleanupCommandShell',
      cleanupCommand: quoteShell(scriptPath)
    }
  }

  const scriptPath = path.join(tmpdir(), `codex-worktree-cleanup-${randomUUID()}.ps1`)
  const content = `$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath ${quotePowerShell(context.basePath)}
foreach ($sharedPath in @(${sharedPaths.map(quotePowerShell).join(', ')})) {
  if (Test-Path -LiteralPath $sharedPath) {
    $item = Get-Item -Force -LiteralPath $sharedPath
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Remove-Item -LiteralPath $sharedPath -Force
    }
  }
}
$removeOutput = & git -C ${quotePowerShell(context.repoRoot)} worktree remove --force ${quotePowerShell(context.targetPath)} 2>&1
if ($LASTEXITCODE -ne 0) { throw ($removeOutput -join "\`n") }
if (Test-Path -LiteralPath ${quotePowerShell(context.targetPath)}) {
  Remove-Item -LiteralPath ${quotePowerShell(context.targetPath)} -Recurse -Force
}
$branchOutput = & git -C ${quotePowerShell(context.repoRoot)} branch ${branchFlag} ${quotePowerShell(context.branch)} 2>&1
if ($LASTEXITCODE -ne 0) { throw ($branchOutput -join "\`n") }
& git -C ${quotePowerShell(context.repoRoot)} config --unset-all ${quotePowerShell(`branch.${context.branch}.isolate-base`)} 2>$null
& git -C ${quotePowerShell(context.repoRoot)} config --unset-all ${quotePowerShell(`branch.${context.branch}.isolate-worktree`)} 2>$null
if (Test-Path -LiteralPath ${quotePowerShell(context.targetPath)}) {
  throw ${quotePowerShell(`Cleanup left the worktree folder behind: ${context.targetPath}`)}
}
Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue
codex ${quotePowerShell(prompt)}
`
  writeFileSync(scriptPath, content, 'utf8')
  return {
    scriptPath,
    scriptKey: 'cleanupScriptPowerShell',
    cleanupKey: 'cleanupCommandPowerShell',
    cleanupCommand: `& ${quotePowerShell(scriptPath)}`
  }
}

const continuation = (shell, basePath, prompt, cleanup) => {
  if (cleanup) {
    return {
      key: shell === 'shell' ? 'nextCommandShell' : 'nextCommandPowerShell',
      command: cleanup.cleanupCommand
    }
  }

  const restart = writeRestartScript(shell, basePath, prompt)
  return { key: restart.commandKey, command: restart.command }
}

const removeBranchMetadata = (context) => {
  unsetConfig(context.repoRoot, `branch.${context.branch}.isolate-base`)
  unsetConfig(context.repoRoot, `branch.${context.branch}.isolate-worktree`)
}

const finishCleanup = (operation, context, options, prompt) => {
  const activeTarget = context.current && samePath(context.current.path, context.targetPath)
  if (!activeTarget) {
    removeSharedLinks(context.targetPath)
    const removeArguments = ['worktree', 'remove', '--force', context.targetPath]
    const removal = gitResult(context.repoRoot, removeArguments)
    if (removal.status === 0) {
      if (existsSync(context.targetPath)) {
        rmSync(context.targetPath, { recursive: true, force: true })
      }
      git(context.repoRoot, ['branch', operation === 'discard' ? '-D' : '-d', context.branch])
      removeBranchMetadata(context)
      if (existsSync(context.targetPath)) {
        throw new WorktreeError(`Git unregistered the worktree but left its folder behind: ${context.targetPath}`)
      }
      return { pending: false }
    }
  }

  return {
    pending: true,
    cleanup: writeCleanupScript(operation, options.shell, context, prompt),
    reason: activeTarget ? 'active-session' : 'folder-locked'
  }
}

const emitContext = (operation, state, context) => {
  emit('operation', operation)
  emit('state', state)
  emit('repoRoot', context.repoRoot)
  emit('branch', context.branch)
  emit('baseBranch', context.base)
  emit('targetWorktree', context.targetPath)
  emit('nextWorkdir', context.basePath)
}

const runIsolate = (options) => {
  const repoRoot = validateRoot(requiredOption(options, 'repo-root'))
  const branch = requiredOption(options, 'branch')
  requireBranchName(branch)
  if (protectedBranches.has(branch)) {
    throw new WorktreeError(`Refusing protected branch name: ${branch}`)
  }
  if (branchExists(repoRoot, branch)) {
    throw new WorktreeError(`Branch already exists; isolate only creates new lifecycle branches: ${branch}`)
  }

  const current = currentWorktree()
  const base = oneLine(options.base) || current?.branch || 'main'
  if (!branchExists(repoRoot, base)) {
    throw new WorktreeError(`Base branch does not exist: ${base}`)
  }
  const baseRecord = worktreeForBranch(repoRoot, base)
  if (!baseRecord || baseRecord.bare) {
    throw new WorktreeError(`Base branch must have a registered worktree: ${base}`)
  }

  const worktreeName = branch.replaceAll('/', '_')
  const worktrees = listWorktrees(repoRoot)
  const bareRootLayout = worktrees.some((record) => record.bare)
  const projectWorktree = worktrees.find((record) => record.branch === 'main') ?? baseRecord
  const folderName = bareRootLayout
    ? worktreeName
    : `${path.basename(projectWorktree.path)}.${worktreeName}`
  const targetPath = path.join(path.dirname(baseRecord.path), folderName)
  if (existsSync(targetPath) || registeredWorktree(repoRoot, targetPath)) {
    throw new WorktreeError(`Target worktree already exists: ${targetPath}`)
  }

  let created = false
  try {
    git(repoRoot, ['worktree', 'add', '-b', branch, targetPath, base])
    created = true

    const linked = []
    const skipped = []
    for (const directoryName of sharedDirectoryNames) {
      const source = path.join(baseRecord.path, directoryName)
      const target = path.join(targetPath, directoryName)
      if (!existsSync(source) || existsSync(target)) {
        skipped.push(directoryName)
        continue
      }
      try {
        symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
        linked.push(directoryName)
      } catch {
        skipped.push(directoryName)
      }
    }

    git(repoRoot, ['config', `branch.${branch}.isolate-base`, base])
    git(repoRoot, ['config', `branch.${branch}.isolate-worktree`, targetPath])

    const status = outputLines(git(targetPath, ['status', '--porcelain=v1', '-uall']))
    if (status.length > 0) {
      throw new WorktreeError(`New worktree is not clean:\n${status.join('\n')}`)
    }

    const taskPrompt = oneLine(options.prompt) || 'Continue from this isolated worktree.'
    const handoffPrompt = `Continue this task from the isolated worktree. Branch: ${branch}. Base branch: ${base}. Worktree: ${targetPath}. Task: ${taskPrompt}`
    const restart = writeRestartScript(options.shell, targetPath, handoffPrompt)
    const baseDirty = outputLines(git(baseRecord.path, ['status', '--porcelain=v1', '-uall']))

    process.stdout.write(`Done: created isolated worktree ${targetPath}\n`)
    process.stdout.write('Next: close this session and run the printed next command.\n')
    emit('operation', 'isolate')
    emit('state', 'ready')
    emit('repoRoot', baseRecord.path)
    emit('branch', branch)
    emit('baseBranch', base)
    emit('targetWorktree', targetPath)
    emit('nextWorkdir', targetPath)
    emit('approvalRequired', 'false')
    printList('sharedDirectoriesLinked', linked)
    printList('sharedDirectoriesSkipped', skipped)
    printList('baseStatus', baseDirty)
    if (existsSync(path.join(targetPath, 'package-lock.json'))) {
      emit('setupCommand', `npm ci --prefix ${targetPath}`)
    } else if (existsSync(path.join(targetPath, 'package.json'))) {
      emit('setupCommand', `npm install --prefix ${targetPath}`)
    }
    emit(restart.scriptKey, restart.scriptPath)
    emit(restart.commandKey, restart.command)
    emit('fallbackPrompt', handoffPrompt)
  } catch (error) {
    if (created) {
      removeSharedLinks(targetPath)
      gitResult(repoRoot, ['worktree', 'remove', '--force', targetPath])
      if (existsSync(targetPath)) {
        rmSync(targetPath, { recursive: true, force: true })
      }
      gitResult(repoRoot, ['branch', '-D', branch])
      unsetConfig(repoRoot, `branch.${branch}.isolate-base`)
      unsetConfig(repoRoot, `branch.${branch}.isolate-worktree`)
    }
    throw error
  }
}

const runIntegrate = (options) => {
  const repoRoot = validateRoot(requiredOption(options, 'repo-root'))
  const context = resolveManagedTarget(repoRoot, options, false)
  const targetStatus = outputLines(git(context.targetPath, ['status', '--porcelain=v1', '-uall']))
  if (targetStatus.length > 0) {
    throw new WorktreeError(`Isolated worktree has uncommitted changes:\n${targetStatus.join('\n')}`)
  }

  const preview = snapshot(context)
  if (!options.apply) {
    process.stdout.write(`Preview: integrate ${context.branch} into ${context.base}, then remove its worktree and branch.\n`)
    process.stdout.write('Next: validate the target, base, and commits, then run the confirmed command if they match the integration request.\n')
    emitContext('integrate', 'preview', context)
    emit('approvalRequired', 'false')
    emit('previewToken', preview.token)
    emit('baseHead', preview.baseHead)
    emit('branchHead', preview.branchHead)
    printList('commitsToIntegrate', preview.commits)
    emit(options.shell === 'shell' ? 'confirmedCommandShell' : 'confirmedCommandPowerShell', confirmedCommand('integrate', context, options, preview.token))
    return
  }

  if (!options['preview-token'] || options['preview-token'] !== preview.token) {
    throw new WorktreeError('Integration preview is missing or stale. Run preview again before applying.')
  }

  const rebase = gitResult(context.targetPath, ['rebase', context.base])
  if (rebase.status !== 0) {
    gitResult(context.targetPath, ['rebase', '--abort'])
    const detail = [rebase.stdout, rebase.stderr].filter(Boolean).join('\n')
    throw new WorktreeError(`Rebase failed and was aborted${detail ? `:\n${detail}` : ''}`)
  }

  git(context.basePath, ['merge', '--ff-only', context.branch])
  const integratedHead = git(context.repoRoot, ['rev-parse', `refs/heads/${context.branch}`]).trim()
  const baseHead = git(context.repoRoot, ['rev-parse', `refs/heads/${context.base}`]).trim()
  if (integratedHead !== baseHead) {
    throw new WorktreeError(`Integration verification failed: ${context.base} and ${context.branch} have different heads.`)
  }

  const prompt = `Continue from the base worktree after integrating ${context.branch} into ${context.base}.`
  const cleanupResult = finishCleanup('integrate', context, options, prompt)
  const next = continuation(options.shell, context.basePath, prompt, cleanupResult.cleanup)
  const state = cleanupResult.pending ? 'cleanup-pending' : 'complete'

  process.stdout.write(cleanupResult.pending
    ? `Done: integrated ${context.branch} into ${context.base}; worktree cleanup is pending.\n`
    : `Done: integrated ${context.branch} into ${context.base} and removed its worktree and branch.\n`)
  process.stdout.write(cleanupResult.pending
    ? 'Next: close the old worktree session and run the printed next command.\n'
    : `Next: continue from ${context.basePath}.\n`)
  emitContext('integrate', state, context)
  emit('approvalRequired', 'false')
  emit('cleanupPending', String(cleanupResult.pending))
  if (cleanupResult.pending) {
    emit('cleanupReason', cleanupResult.reason)
    emit(cleanupResult.cleanup.scriptKey, cleanupResult.cleanup.scriptPath)
    emit(cleanupResult.cleanup.cleanupKey, cleanupResult.cleanup.cleanupCommand)
  }
  emit(next.key, next.command)
  emit('fallbackPrompt', prompt)
}

const runDiscard = (options) => {
  const repoRoot = validateRoot(requiredOption(options, 'repo-root'))
  const context = resolveManagedTarget(repoRoot, options, true)
  if (protectedBranches.has(context.branch)) {
    throw new WorktreeError(`Refusing to discard protected branch: ${context.branch}`)
  }

  const preview = snapshot(context)
  const lossDetected = preview.status.length > 0 || preview.commits.length > 0
  if (!options.apply && lossDetected) {
    process.stdout.write(`Preview: discard would permanently delete work from ${context.branch}.\n`)
    process.stdout.write('Next: show this loss report to the user and run the confirmed command only after approval.\n')
    emitContext('discard', 'preview', context)
    emit('approvalRequired', 'true')
    emit('lossDetected', 'true')
    emit('previewToken', preview.token)
    printList('statusToDiscard', preview.status)
    printList('commitsToDiscard', preview.commits)
    printList('committedFilesToDiscard', preview.committedFiles)
    printList('untrackedFilesToDiscard', preview.untracked)
    emit(options.shell === 'shell' ? 'confirmedCommandShell' : 'confirmedCommandPowerShell', confirmedCommand('discard', context, options, preview.token))
    return
  }

  if (lossDetected && (!options['preview-token'] || options['preview-token'] !== preview.token)) {
    throw new WorktreeError('Discard preview is missing or stale. Run preview again before applying.')
  }

  const prompt = `Continue from the base worktree after discarding ${context.branch}.`
  const cleanupResult = finishCleanup('discard', context, options, prompt)
  const next = continuation(options.shell, context.basePath, prompt, cleanupResult.cleanup)
  const state = cleanupResult.pending ? 'cleanup-pending' : 'complete'

  process.stdout.write(cleanupResult.pending
    ? `Done: discard approved for ${context.branch}; destructive cleanup is pending.\n`
    : `Done: discarded ${context.branch} and removed its worktree and branch.\n`)
  process.stdout.write(cleanupResult.pending
    ? 'Next: close the old worktree session and run the printed next command.\n'
    : `Next: continue from ${context.basePath}.\n`)
  emitContext('discard', state, context)
  emit('approvalRequired', 'false')
  emit('lossDetected', String(lossDetected))
  emit('cleanupPending', String(cleanupResult.pending))
  if (cleanupResult.pending) {
    emit('cleanupReason', cleanupResult.reason)
    emit(cleanupResult.cleanup.scriptKey, cleanupResult.cleanup.scriptPath)
    emit(cleanupResult.cleanup.cleanupKey, cleanupResult.cleanup.cleanupCommand)
  }
  emit(next.key, next.command)
  emit('fallbackPrompt', prompt)
}

const main = () => {
  const options = parseArguments(process.argv.slice(2))
  options.shell = options.shell === 'shell' ? 'shell' : 'powershell'

  if (options.operation === 'isolate') {
    runIsolate(options)
  } else if (options.operation === 'integrate') {
    runIntegrate(options)
  } else {
    runDiscard(options)
  }
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Error: ${message}\n`)
  emit('state', 'failed')
  emit('error', oneLine(message))
  process.exitCode = 1
}
