$ErrorActionPreference = "Stop"
Write-Host "1. Cek Node/NPM" -ForegroundColor Cyan
node --version
npm --version
Write-Host "2. Cek Wrangler" -ForegroundColor Cyan
npx wrangler --version
Write-Host "3. Cek clasp" -ForegroundColor Cyan
npx clasp --version
Write-Host "Toolchain siap." -ForegroundColor Green
