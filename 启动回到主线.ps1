$ErrorActionPreference = "Stop"

$nodePath = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$serverPath = Join-Path $PSScriptRoot "jros-mainline-server.mjs"
$url = "http://127.0.0.1:17861/"
$healthUrl = "${url}api/health"

function Test-JrosServer {
  try {
    $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    return $response.ok -eq $true -and $response.app -eq "jros-mainline"
  } catch {
    return $false
  }
}

if (-not (Test-Path -LiteralPath $nodePath)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Node.js runtime was not found:`n$nodePath",
    "JROS Mainline",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

if (-not (Test-JrosServer)) {
  $arguments = "`"$serverPath`""
  Start-Process `
    -FilePath $nodePath `
    -ArgumentList $arguments `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden

  $ready = $false
  for ($attempt = 0; $attempt -lt 25; $attempt += 1) {
    Start-Sleep -Milliseconds 200
    if (Test-JrosServer) {
      $ready = $true
      break
    }
  }

  if (-not $ready) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "The local save service failed to start.",
      "JROS Mainline",
      "OK",
      "Error"
    ) | Out-Null
    exit 1
  }
}

if ($env:JROS_NO_BROWSER -ne "1") {
  Start-Process $url
}
