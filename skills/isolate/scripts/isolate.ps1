param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,

  [Parameter(Mandatory = $true)]
  [string]$BranchName,

  [string]$BaseBranch = "",

  [string]$HandoffPrompt = "",

  [string]$UserPrompt = ""
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\..\worktrees\scripts\worktree.mjs"
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw "Missing worktrees runtime. Install isolate, integrate, discard, and worktrees together from the same skills.sh source."
}
$prompt = if ([string]::IsNullOrWhiteSpace($HandoffPrompt)) { $UserPrompt } else { $HandoffPrompt }
$arguments = @(
  $script,
  "isolate",
  "--repo-root", $RepoRoot,
  "--branch", $BranchName,
  "--shell", "powershell"
)

if (-not [string]::IsNullOrWhiteSpace($BaseBranch)) {
  $arguments += @("--base", $BaseBranch)
}
if (-not [string]::IsNullOrWhiteSpace($prompt)) {
  $arguments += @("--prompt", $prompt)
}

& node @arguments
exit $LASTEXITCODE
