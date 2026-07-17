---
name: discard
description: Discard a managed isolated worktree, its branch, and its files without integrating them. Use when isolated work should be abandoned rather than kept.
---

# Discard

Finish the managed round trip by abandoning isolated work, leaving the recorded base unchanged, and removing the isolated branch and folder.

Consult the [package contract](../worktrees/REFERENCE.md) when recovering from failure or changing package behavior; the steps below are the execution path.

## Steps

1. Resolve the managed target.

   Resolve `<repo-root>` with `git rev-parse --show-toplevel` from the current checkout. Prefer the user-provided branch; inside the isolated worktree, omit it and let the launcher resolve the current branch.

   This step is complete when the target has isolate metadata and is neither the base worktree nor a protected branch.

2. Run discard once.

   PowerShell:

   ```text
   <skill-dir>\scripts\discard.ps1 -RepoRoot <repo-root> [-BranchName <branch>]
   ```

   Bash:

   ```text
   bash <skill-dir>/scripts/discard.sh <repo-root> [branch]
   ```

   This step is complete in one of three states:

   - `state=complete`: nothing unique would be lost and cleanup finished.
   - `state=cleanup-pending`: nothing unique would be lost, but cleanup must run after the old session closes.
   - `state=preview`: loss was detected and nothing was deleted.

3. For `state=preview`, give a concise loss summary and wait for explicit approval:

   - unique commits from `commitsToDiscard...` (short hash and subject)
   - committed files from `committedFilesToDiscard...` (Git status and path)
   - uncommitted and untracked files, when present

   Omit launcher metadata, paths, tokens, and the confirmation command from the summary. Then run `confirmedCommand...` exactly after approval; its token binds approval to the displayed branch head and file state.

   This step is complete only when output changes to `state=complete` or `state=cleanup-pending`. If the preview is stale, preview again and seek approval again.

4. Finish at the session boundary.

   - For `state=complete`, report that the round trip is closed and continue only from `nextWorkdir`.
   - For `state=cleanup-pending`, report that the round trip remains open. Tell the user to close every session using `targetWorktree`, then run the exact `nextCommand...`; include `fallbackPrompt`.

   This session is complete after a pending-cleanup handoff; the lifecycle is complete only when the generated command verifies that both branch and folder are gone.
