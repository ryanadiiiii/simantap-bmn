param(
  [string]$DeploymentId = $env:GAS_DEPLOYMENT_ID,
  [string]$Description = "SIMANTAP BMN backend update"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".clasp.json")) {
  throw "File .clasp.json belum ada. Copy .clasp.json.example menjadi .clasp.json lalu isi Script ID."
}

if (-not $DeploymentId) {
  $DeploymentId = Read-Host "Masukkan Apps Script Deployment ID yang sudah dipakai Worker"
}
if (-not $DeploymentId) { throw "Deployment ID wajib diisi." }

Write-Host "Push source Apps Script..." -ForegroundColor Cyan
npx clasp push
if ($LASTEXITCODE -ne 0) { throw "clasp push gagal." }

Write-Host "Redeploy Web App pada deployment ID yang sama..." -ForegroundColor Cyan
npx clasp create-deployment --deploymentId $DeploymentId --description $Description
if ($LASTEXITCODE -ne 0) { throw "Redeploy Apps Script gagal." }

Write-Host "Backend berhasil diperbarui. URL /exec tetap sama sehingga Worker tidak perlu diubah." -ForegroundColor Green
