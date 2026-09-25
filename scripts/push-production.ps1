param(
  [string]$Message = "Update SIMANTAP BMN"
)

$ErrorActionPreference = "Stop"

git add .
$changes = git diff --cached --name-only
if (-not $changes) {
  Write-Host "Tidak ada perubahan untuk dipush." -ForegroundColor Yellow
  exit 0
}

git commit -m $Message
git push origin main
Write-Host "Push selesai. Cloudflare Workers Builds akan deploy otomatis dari branch main." -ForegroundColor Green
