# Script de verificação de produção do OdontoCare.
# Remove locks órfãos do build, encerra processos node de build travados
# (sem tocar nos processos do VS Code) e executa o build de produção.

Write-Host "== Limpando artefatos =="
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

Write-Host "== Encerrando builds travados =="
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like "*next/dist/bin/next build*" } |
  ForEach-Object {
    Write-Host ("  kill PID " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }

Write-Host "== Build de producao =="
node node_modules/next/dist/bin/next build 2>&1 |
  Tee-Object -FilePath build-verify.log |
  Out-Null
Write-Host ("EXITCODE=" + $LASTEXITCODE)
