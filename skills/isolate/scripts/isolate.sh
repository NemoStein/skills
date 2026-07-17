#!/usr/bin/env bash
set -euo pipefail

repo_root="${1:?usage: isolate.sh <repo-root> <branch-name> [base-branch] [handoff-prompt]}"
branch_name="${2:?usage: isolate.sh <repo-root> <branch-name> [base-branch] [handoff-prompt]}"
base_branch="${3:-}"
handoff_prompt="${4:-}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
node_script="$script_dir/worktree.mjs"
if [[ ! -f "$node_script" ]]; then
  printf '%s\n' 'Missing isolate lifecycle runtime. Reinstall the isolate skill from the same skills.sh source.' >&2
  exit 1
fi
arguments=(
  "$node_script"
  isolate
  --repo-root "$repo_root"
  --branch "$branch_name"
  --shell shell
)

[[ -z "$base_branch" ]] || arguments+=(--base "$base_branch")
[[ -z "$handoff_prompt" ]] || arguments+=(--prompt "$handoff_prompt")

exec node "${arguments[@]}"
