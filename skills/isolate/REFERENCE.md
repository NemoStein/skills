# Worktree Lifecycle Contract

`isolate`, `integrate`, and `discard` form one managed lifecycle:

```text
base -> isolate -> isolated worktree -> integrate -> base
                                    \-> discard -> base
```

This package is a round trip, not a worktree factory. `isolate` records the route back; `integrate` lands the work; `discard` abandons it. The lifecycle is not closed while its isolated branch or folder remains.

The package uses one implementation, [`scripts/worktree.mjs`](scripts/worktree.mjs). PowerShell and Bash files under each skill are thin platform launchers.

## Scope

- `<repo-root>` is any registered checkout in the repository. The launchers accept the current worktree root and resolve the stable base worktree themselves.
- New worktrees are siblings named after their lifecycle branch, replacing `/` with `_`: `type/short-kebab-description` creates `type_short-kebab-description` beside a bare-root base worktree. Conventional repositories prefix that name with the project and a period: `project.type_short-kebab-description`.
- Lifecycle branches use `type/short-kebab-description`.
- `integrate` and `discard` operate only on branches created by `isolate`.
- The package does not fetch, push, open pull requests, install dependencies, or operate on unmanaged branches.
- Node.js and Git are required tooling.

## Managed Identity

`isolate` records:

```text
branch.<branch>.isolate-base
branch.<branch>.isolate-worktree
```

The worktree value is an absolute path. Cleanup requires both values, resolves Git operations through the recorded base worktree, and verifies the target against `git worktree list`; caller-supplied paths cannot redirect deletion.

## Lifecycle Invariants

### Isolate

- The branch and sibling folder must not already exist.
- The base branch must have a registered worktree.
- The base worktree may have local changes; they remain there and are not copied into the new worktree.
- Shared agent directories are linked when their source exists.
- Dependency installation is reported as `setupCommand` and never run automatically.
- Failure after worktree creation rolls back the new worktree, branch, and metadata.

### Integrate

- The isolated worktree must be clean. The base worktree may have local changes when Git can fast-forward without overwriting them.
- Preview is a read-only state-validation gate and exits successfully with `state=preview`.
- The integration request authorizes apply when target, base, and commits match the preview; no second approval is required.
- Apply requires the exact preview token. Any changed head or file state invalidates it.
- The isolated branch rebases onto the base; a failed rebase is aborted.
- The base advances with `merge --ff-only`; integration never rebases or rewrites the base branch.
- Cleanup starts only after both branch heads are verified equal.

### Discard

- Protected branches and the recorded base worktree cannot be discarded.
- A clean branch with no unique commits may be removed immediately.
- Unique commits, tracked changes, or untracked files produce a read-only loss preview. The preview identifies unique commits, committed files, and any uncommitted or untracked files that would be lost.
- Ignored build artifacts are not itemized; approved cleanup removes them with the worktree.
- Destructive apply requires the exact preview token. A stale preview requires new approval.

### Cleanup

- Cleanup uses `git worktree remove --force`, deletes the lifecycle branch, and verifies the folder is gone.
- The implementation never edits `.git/worktrees` directly.
- When the caller is inside the target worktree, or another process locks it, output is `state=cleanup-pending`.
- Pending cleanup leaves the branch and Git registration intact and generates one temporary handoff script. `nextCommand...` invokes that script alone; it changes to the recorded base worktree before cleanup, then starts Codex there.

## Output States

Every successful run prints `operation`, `state`, `repoRoot`, `branch`, and relevant paths.

| State | Meaning | Agent action |
| --- | --- | --- |
| `ready` | Isolation exists and is verified | Hand off through `nextCommand...`; stop old-session work |
| `preview` | Read-only integration validation or discard loss report | Integrate if expected; require approval before destructive discard |
| `complete` | Git state, branch, and folder cleanup are verified | Continue from `nextWorkdir` |
| `cleanup-pending` | Git intent is settled but target deletion must happen after session exit | Hand off exact `nextCommand...`; do not claim cleanup complete |
| `failed` | A precondition or operation failed | Stop and report `error` |

`nextCommandPowerShell` and `nextCommandShell` are single-script executable handoffs. `fallbackPrompt` is the manual-session fallback. Never reconstruct a confirmed or cleanup command when the script printed one.

## Verification

Run the package lifecycle suite after changing instructions, launchers, or implementation:

```text
node --test .agents/skills/isolate/tests/worktree.test.mjs
```

The suite exercises the canonical runtime across isolate, integrate, and discard. Add a regression for every changed lifecycle behavior.
