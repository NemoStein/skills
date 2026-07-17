param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,

  [string]$BranchName = "",

  [string]$Worktree = "",

  [string]$BaseBranch = "",

  [string]$UserInstruction = "",

  [switch]$ConfirmDiscard,

  [string]$PreviewToken = ""
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\..\worktrees\scripts\worktree.mjs"
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw "Missing worktrees runtime. Install isolate, integrate, discard, and worktrees together from the same skills.sh source."
}
$arguments = @(
  $script,
  "discard",
  "--repo-root", $RepoRoot,
  "--shell", "powershell"
)

if (-not [string]::IsNullOrWhiteSpace($BranchName)) {
  $arguments += @("--branch", $BranchName)
}
if (-not [string]::IsNullOrWhiteSpace($Worktree)) {
  $arguments += @("--worktree", $Worktree)
}
if (-not [string]::IsNullOrWhiteSpace($BaseBranch)) {
  $arguments += @("--base", $BaseBranch)
}
if (-not [string]::IsNullOrWhiteSpace($UserInstruction)) {
  $arguments += @("--intent", $UserInstruction)
}
if ($ConfirmDiscard) {
  $arguments += "--apply"
}
if (-not [string]::IsNullOrWhiteSpace($PreviewToken)) {
  $arguments += @("--preview-token", $PreviewToken)
}

& node @arguments
exit $LASTEXITCODE
