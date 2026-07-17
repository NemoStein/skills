#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: discard.sh <repo-root> [branch-name] [worktree] [base-branch] [instruction] [--confirm-discard] [preview-token]}"
branch_name="${2:-}"
worktree="${3:-}"
base_branch="${4:-}"
instruction="${5:-}"
confirmation="${6:-}"
preview_token="${7:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
node_script="$script_dir/../../worktree-package/scripts/worktree.mjs"
arguments=(
  "$node_script"
  discard
  --repo-root "$repo_root"
  --shell shell
)

[[ -z "$branch_name" ]] || arguments+=(--branch "$branch_name")
[[ -z "$worktree" ]] || arguments+=(--worktree "$worktree")
[[ -z "$base_branch" ]] || arguments+=(--base "$base_branch")
[[ -z "$instruction" ]] || arguments+=(--intent "$instruction")
[[ "$confirmation" != "--confirm-discard" ]] || arguments+=(--apply)
[[ -z "$preview_token" ]] || arguments+=(--preview-token "$preview_token")

exec node "${arguments[@]}"
