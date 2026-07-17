param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,

  [Parameter(Mandatory = $true)]
  [string]$BranchName,

  [string]$Worktree = "",

  [string]$BaseBranch = "",

  [string]$UserInstruction = "",

  [switch]$ConfirmIntegrate,

  [string]$PreviewToken = ""
)

$ErrorActionPreference = "Stop"
$script = Join-Path $PSScriptRoot "..\..\isolate\scripts\worktree.mjs"
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) {
  throw "Missing isolate lifecycle runtime. Install isolate and integrate together from the same skills.sh source."
}
$arguments = @(
  $script,
  "integrate",
  "--repo-root", $RepoRoot,
  "--branch", $BranchName,
  "--shell", "powershell"
)

if (-not [string]::IsNullOrWhiteSpace($Worktree)) {
  $arguments += @("--worktree", $Worktree)
}
if (-not [string]::IsNullOrWhiteSpace($BaseBranch)) {
  $arguments += @("--base", $BaseBranch)
}
if (-not [string]::IsNullOrWhiteSpace($UserInstruction)) {
  $arguments += @("--intent", $UserInstruction)
}
if ($ConfirmIntegrate) {
  $arguments += "--apply"
}
if (-not [string]::IsNullOrWhiteSpace($PreviewToken)) {
  $arguments += @("--preview-token", $PreviewToken)
}

& node @arguments
exit $LASTEXITCODE
