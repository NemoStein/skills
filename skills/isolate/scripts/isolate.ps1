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
$script = Join-Path $PSScriptRoot "..\..\worktree-package\scripts\worktree.mjs"
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
