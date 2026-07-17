---
name: integrate
description: Integrate completed managed-worktree commits into their recorded base and remove the isolated branch and folder. Use when isolated work is finished and should be kept.
---

# Integrate

Finish the managed round trip by landing completed work on its recorded base and removing the isolated branch and folder.

Consult the [package contract](../worktree-package/REFERENCE.md) when recovering from failure or changing package behavior; the steps below are the execution path.

## Steps

1. Verify the isolated task from its worktree.

   Run the task's required final verification. Ensure all intended isolated work is committed. The base worktree may have local changes; Git will reject an integration that would overwrite them.

   This step is complete only when the verification outcome is known and the isolated worktree is clean.

2. Preview integration.

   Resolve `<repo-root>` with `git rev-parse --show-toplevel` from the current checkout. Pass the managed branch; its worktree and base come from isolate metadata.

   PowerShell:

   ```text
   <skill-dir>\scripts\integrate.ps1 -RepoRoot <repo-root> -BranchName <branch>
   ```

   Bash:

   ```text
   bash <skill-dir>/scripts/integrate.sh <repo-root> <branch>
   ```

   The preview is complete only when output says `state=preview`, the target and recorded base are correct, every commit to integrate is accounted for, and `confirmedCommand...` contains the preview token. A preview changes nothing.

3. If the preview matches the integration request, run `confirmedCommand...` immediately and exactly. Invoking `integrate` authorizes landing verified work; stop for direction only when the target, base, or commit set is unexpected.

   The apply step is complete only when output says `state=complete` or `state=cleanup-pending`. Treat a stale preview, failed rebase, or Git refusal to overwrite base changes as a hard stop.

4. Finish at the session boundary.

   - For `state=complete`, report that the round trip is closed and continue only from `nextWorkdir`.
   - For `state=cleanup-pending`, report that the round trip remains open. Tell the user to close every session using `targetWorktree`, then run the exact `nextCommand...`; include `fallbackPrompt`.

   `nextCommand...` is always one temporary `.ps1` or `.sh` script invocation. Give the user that invocation alone: the script changes to the recorded base worktree, completes any pending cleanup, and then starts Codex there.

   This session is complete after a pending-cleanup handoff; the lifecycle is complete only when the generated command verifies that both branch and folder are gone.
