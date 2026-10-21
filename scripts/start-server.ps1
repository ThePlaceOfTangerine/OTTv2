# Starts OTTv2 with Cloudflare Pages and Google Sheets configured from a private secrets folder (no secret is stored in this file).
#   powershell -ExecutionPolicy Bypass -File scripts\start-server.ps1 [-Secrets E:\OTTv2-local\secrets] [-SheetId <id>] [-Project ott-ket-qua] [-AutoDeploy]
# Secrets folder (outside the repository): cloudflare-token.txt, cloudflare-account.txt, google-sa.json, optional google-sheet-id.txt.
param(
  [string]$Secrets = 'E:\OTTv2-local\secrets',
  [string]$SheetId = '',
  [string]$Project = 'ott-ket-qua',
  [switch]$AutoDeploy
)
$ErrorActionPreference = 'Stop'
function Read-Secret($name) { $file = Join-Path $Secrets $name; if (Test-Path $file) { (Get-Content -Raw $file).Trim() } else { '' } }

$token = Read-Secret 'cloudflare-token.txt'; $account = Read-Secret 'cloudflare-account.txt'
if ($token -and $account) {
  $env:CLOUDFLARE_API_TOKEN = $token; $env:CLOUDFLARE_ACCOUNT_ID = $account
  $env:CLOUDFLARE_PAGES_PROJECT = $Project; $env:PUBLIC_SITE_URL = "https://$Project.pages.dev"
  if ($AutoDeploy) { $env:SITE_AUTO_DEPLOY = '1' }
  Write-Host "Cloudflare Pages: $env:PUBLIC_SITE_URL$(if ($AutoDeploy) { ' (tự đẩy sau mỗi lần công bố)' })"
} else { Write-Host 'Cloudflare Pages: chưa cấu hình (thiếu cloudflare-token.txt / cloudflare-account.txt).' }

if (-not $SheetId) { $SheetId = Read-Secret 'google-sheet-id.txt' }
$googleKey = Join-Path $Secrets 'google-sa.json'
if ((Test-Path $googleKey) -and $SheetId) {
  $env:GOOGLE_SERVICE_ACCOUNT_FILE = $googleKey; $env:GOOGLE_SHEET_ID = $SheetId
  Write-Host "Google Sheets: https://docs.google.com/spreadsheets/d/$SheetId"
} else { Write-Host 'Google Sheets: chưa cấu hình (thiếu google-sa.json hoặc ID bảng tính).' }

$appId = Read-Secret 'github-app-id.txt'; $appKey = Join-Path $Secrets 'github-app.pem'
if ($appId -and (Test-Path $appKey)) {
  $env:GITHUB_APP_ID = $appId; $env:GITHUB_APP_PRIVATE_KEY_PATH = $appKey; $env:GITHUB_APP_SLUG = Read-Secret 'github-app-slug.txt'
  $hook = Read-Secret 'github-webhook-secret.txt'; if ($hook) { $env:GITHUB_WEBHOOK_SECRET = $hook }
  Write-Host "GitHub App: https://github.com/apps/$env:GITHUB_APP_SLUG"
} else { Write-Host 'GitHub App: chưa cấu hình (đội nộp bằng file).' }

Set-Location (Join-Path $PSScriptRoot '..')
npm start
