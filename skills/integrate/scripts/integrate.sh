#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: integrate.sh <repo-root> <branch-name> [worktree] [base-branch] [instruction] [--confirm-integrate] [preview-token]}"
branch_name="${2:?usage: integrate.sh <repo-root> <branch-name> [worktree] [base-branch] [instruction] [--confirm-integrate] [preview-token]}"
worktree="${3:-}"
base_branch="${4:-}"
instruction="${5:-}"
confirmation="${6:-}"
preview_token="${7:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
node_script="$script_dir/../../worktrees/scripts/worktree.mjs"
if [[ ! -f "$node_script" ]]; then
  printf '%s\n' 'Missing worktrees runtime. Install isolate, integrate, discard, and worktrees together from the same skills.sh source.' >&2
  exit 1
fi
arguments=(
  "$node_script"
  integrate
  --repo-root "$repo_root"
  --branch "$branch_name"
  --shell shell
)

[[ -z "$worktree" ]] || arguments+=(--worktree "$worktree")
[[ -z "$base_branch" ]] || arguments+=(--base "$base_branch")
[[ -z "$instruction" ]] || arguments+=(--intent "$instruction")
[[ "$confirmation" != "--confirm-integrate" ]] || arguments+=(--apply)
[[ -z "$preview_token" ]] || arguments+=(--preview-token "$preview_token")

exec node "${arguments[@]}"
