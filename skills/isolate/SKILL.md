---
name: isolate
description: Isolate new repository work in a managed sibling Git worktree. Use when the user requests an isolated worktree or concurrent work must not share a checkout.
---

# Isolate

Begin a managed worktree round trip: create one branch and sibling worktree with a recorded route back to its base.

Consult the [package contract](../worktree-package/REFERENCE.md) when recovering from failure or changing package behavior; the steps below are the execution path.

## Steps

1. Resolve the task, `<repo-root>`, `<branch>`, and `<base>`.

   - Resolve `<repo-root>` with `git rev-parse --show-toplevel` from the current checkout.
   - Name `<branch>` as `type/short-kebab-description`, for example `feat/power-management`.
   - Use the user-selected `<base>`, otherwise the current branch, otherwise `main`.
   - Rewrite the request as a compact handoff prompt containing only task intent and explicit constraints. Omit `$isolate` so the next session continues the task.

   This step is complete when all four values are explicit and the handoff prompt continues the task instead of invoking isolation again.

   The base worktree may be dirty: isolation starts the new branch at the base branch's committed `HEAD` and leaves local base changes in place.

2. Run the platform launcher once.

   PowerShell:

   ```text
   <skill-dir>\scripts\isolate.ps1 -RepoRoot <repo-root> -BranchName <branch> -BaseBranch <base> -HandoffPrompt <prompt>
   ```

   Bash:

   ```text
   bash <skill-dir>/scripts/isolate.sh <repo-root> <branch> <base> <prompt>
   ```

   This step is complete only when output says `state=ready`, `targetWorktree` is registered on `<branch>`, and `nextCommand...` is present. Stop on `state=failed`.

3. Hand off the new session.

   Tell the user to close this session and run the exact `nextCommand...`. Include `fallbackPrompt` for manual recovery. If `setupCommand` is present, mention it as optional worktree setup.

   This session is complete when the user has one exact restart command and no task work continues from the base session.
