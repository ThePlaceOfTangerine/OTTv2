# Run on each Windows grader machine (WSL2 enabled; no Docker needed).
# Imports the grader rootfs as its own WSL distro, stores the grader key inside it and checks the bwrap sandbox.
param(
  [Parameter(Mandatory = $true)][string]$Rootfs,
  [Parameter(Mandatory = $true)][string]$CoordinatorUrl,
  [Parameter(Mandatory = $true)][string]$GraderId,
  [Parameter(Mandatory = $true)][string]$GraderSecret,
  [int]$Slots = 1,
  [string]$Name = 'ott-grader',
  [string]$InstallDir = ''
)
$ErrorActionPreference = 'Stop'
# Default: next to the project on the same drive (e.g. E:\OTTv2-local\wsl\ott-grader), not on C:.
# Computed here because $PSScriptRoot is empty inside param defaults on Windows PowerShell 5.1.
if (-not $InstallDir) { $InstallDir = Join-Path (Split-Path (Resolve-Path "$PSScriptRoot\..\..").Path -Parent) "OTTv2-local\wsl\$Name" }
$existing = (wsl --list --quiet) -replace "`0", '' | Where-Object { $_.Trim() -eq $Name }
if ($existing) { throw "Distro $Name đã tồn tại. Gỡ bằng: wsl --unregister $Name (xóa toàn bộ dữ liệu trong distro) rồi chạy lại." }
New-Item -ItemType Directory -Force $InstallDir | Out-Null
wsl --import $Name $InstallDir $Rootfs --version 2
if ($LASTEXITCODE -ne 0) { throw 'wsl --import thất bại.' }
wsl -d $Name -u root -- /opt/ott/scripts/wsl/configure.sh $CoordinatorUrl $GraderId $GraderSecret $Slots
if ($LASTEXITCODE -ne 0) { throw 'Không lưu được cấu hình máy chấm.' }
wsl -d $Name -- sh -c 'cd /opt/ott && SANDBOX_BACKEND=bwrap node scripts/sandbox.js check'
if ($LASTEXITCODE -ne 0) { throw 'Sandbox bwrap chưa hoạt động trong WSL2; xem docs/GRADERS.md.' }
"Xong. Chạy máy chấm: wsl -d $Name -- /opt/ott/scripts/wsl/run-grader.sh"
