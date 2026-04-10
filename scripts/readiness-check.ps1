param(
  [string]$ServerBaseUrl = "http://localhost:4001",
  [string]$AiBaseUrl = "http://localhost:4000",
  [switch]$SkipClientChecks,
  [switch]$SkipAiCheck,
  [switch]$KeepStartedServer
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ClientDir = Join-Path $RepoRoot "client"
$ServerDir = Join-Path $RepoRoot "server"
$ServerEnvPath = Join-Path $ServerDir ".env"

$script:Failures = New-Object System.Collections.ArrayList
$script:Warnings = New-Object System.Collections.ArrayList
$script:StartedServerProcess = $null
$script:ServerStdOut = $null
$script:ServerStdErr = $null

function Add-Failure {
  param([string]$Name, [string]$Detail)

  [void]$script:Failures.Add("${Name}: ${Detail}")
  Write-Host "[FAIL] $Name" -ForegroundColor Red
  Write-Host "       $Detail" -ForegroundColor DarkRed
}

function Add-Warning {
  param([string]$Name, [string]$Detail)

  [void]$script:Warnings.Add("${Name}: ${Detail}")
  Write-Host "[WARN] $Name" -ForegroundColor Yellow
  Write-Host "       $Detail" -ForegroundColor DarkYellow
}

function Add-Pass {
  param([string]$Name, [string]$Detail)

  Write-Host "[PASS] $Name" -ForegroundColor Green
  Write-Host "       $Detail" -ForegroundColor DarkGreen
}

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Name" -ForegroundColor Cyan

  try {
    & $Script
  } catch {
    Add-Failure $Name $_.Exception.Message
  }
}

function Read-DotEnv {
  param([string]$Path)

  $values = @{}

  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()

    if (-not $trimmed) {
      continue
    }

    if ($trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed -split "=", 2

    if ($parts.Count -ne 2) {
      continue
    }

    $values[$parts[0].Trim()] = $parts[1].Trim()
  }

  return $values
}

function Invoke-WebRequestSafe {
  param(
    [string]$Uri,
    [string]$Method = "GET",
    [string]$Body,
    [string]$ContentType,
    [int]$MaximumRedirection = -1
  )

  $params = @{
    Uri         = $Uri
    Method      = $Method
    TimeoutSec  = 10
    ErrorAction = "Stop"
  }

  if ($PSVersionTable.PSVersion.Major -lt 6) {
    $params.UseBasicParsing = $true
  }

  if ($Body) {
    $params.Body = $Body
  }

  if ($ContentType) {
    $params.ContentType = $ContentType
  }

  if ($MaximumRedirection -ge 0) {
    $params.MaximumRedirection = $MaximumRedirection
  }

  try {
    $response = Invoke-WebRequest @params

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content    = $response.Content
      Headers    = $response.Headers
      Error      = $null
    }
  } catch {
    $statusCode = $null
    $headers = $null
    $content = $null

    if ($_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {
      }

      try {
        $headers = $_.Exception.Response.Headers
      } catch {
      }

      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $content = $reader.ReadToEnd()
        $reader.Dispose()
      } catch {
      }
    }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Content    = $content
      Headers    = $headers
      Error      = $_.Exception.Message
    }
  }
}

function Invoke-NoRedirectGet {
  param([string]$Uri)

  $request = [System.Net.HttpWebRequest]::Create($Uri)
  $request.Method = "GET"
  $request.AllowAutoRedirect = $false
  $response = $null

  try {
    try {
      $response = $request.GetResponse()
    } catch [System.Net.WebException] {
      if (-not $_.Exception.Response) {
        throw
      }

      $response = $_.Exception.Response
    }

    $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
    $content = $reader.ReadToEnd()
    $reader.Dispose()
    $location = $null

    if ($response.Headers["Location"]) {
      $location = $response.Headers["Location"]
    }

    return [pscustomobject]@{
      StatusCode = [int]$response.StatusCode
      Content    = $content
      Location   = $location
    }
  } finally {
    if ($response) {
      $response.Close()
    }
  }
}

function Invoke-NpmScript {
  param(
    [string]$WorkingDirectory,
    [string]$ScriptName
  )

  Push-Location $WorkingDirectory

  try {
    $output = & npm run $ScriptName 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    Pop-Location
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    Output   = ($output -join [Environment]::NewLine)
  }
}

function Test-ServerHealth {
  param([string]$BaseUrl)

  $response = Invoke-WebRequestSafe -Uri "$BaseUrl/test"
  return $response.StatusCode -eq 200 -and $response.Content -match "backend is working"
}

function Start-ServerIfNeeded {
  if (Test-ServerHealth -BaseUrl $ServerBaseUrl) {
    Add-Pass "Server availability" "Using already running server at $ServerBaseUrl"
    return
  }

  $nodeCommand = Get-Command node -ErrorAction Stop

  $script:ServerStdOut = Join-Path $env:TEMP "outlook-draft-server.stdout.log"
  $script:ServerStdErr = Join-Path $env:TEMP "outlook-draft-server.stderr.log"

  if (Test-Path $script:ServerStdOut) {
    Remove-Item -Path $script:ServerStdOut -Force
  }

  if (Test-Path $script:ServerStdErr) {
    Remove-Item -Path $script:ServerStdErr -Force
  }

  $script:StartedServerProcess = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList "index.js" `
    -WorkingDirectory $ServerDir `
    -PassThru `
    -RedirectStandardOutput $script:ServerStdOut `
    -RedirectStandardError $script:ServerStdErr

  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500

    if (Test-ServerHealth -BaseUrl $ServerBaseUrl) {
      Add-Pass "Server availability" "Started local server at $ServerBaseUrl"
      return
    }
  }

  $logTail = @()

  if (Test-Path $script:ServerStdErr) {
    $logTail += Get-Content -Path $script:ServerStdErr -Tail 10
  }

  if (-not $logTail -and (Test-Path $script:ServerStdOut)) {
    $logTail += Get-Content -Path $script:ServerStdOut -Tail 10
  }

  $detail = "Server did not become healthy within 10 seconds."

  if ($logTail) {
    $detail = "$detail Latest output: $($logTail -join ' | ')"
  }

  Add-Failure "Server availability" $detail
}

function Stop-StartedServer {
  if (-not $script:StartedServerProcess) {
    return
  }

  if ($KeepStartedServer) {
    Add-Warning "Server shutdown" "Leaving the server running because -KeepStartedServer was provided."
    return
  }

  try {
    if (-not $script:StartedServerProcess.HasExited) {
      Stop-Process -Id $script:StartedServerProcess.Id -Force
    }

    Add-Pass "Server shutdown" "Stopped server process started by this script."
  } catch {
    Add-Warning "Server shutdown" "Could not stop started server process automatically."
  }
}

try {
  Invoke-Check "Repository structure" {
    if (-not (Test-Path $ClientDir)) {
      throw "Missing client directory."
    }

    if (-not (Test-Path $ServerDir)) {
      throw "Missing server directory."
    }

    Add-Pass "Repository structure" "Found client and server directories."
  }

  Invoke-Check "Server env file" {
    if (-not (Test-Path $ServerEnvPath)) {
      throw "Missing server/.env file."
    }

    $envValues = Read-DotEnv -Path $ServerEnvPath
    $requiredKeys = @(
      "PORT",
      "CLIENT_URL",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
      "MICROSOFT_REDIRECT_URI",
      "MICROSOFT_AUTHORITY",
      "SESSION_SECRET"
    )

    $missingKeys = @(
      foreach ($key in $requiredKeys) {
        if (-not $envValues.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envValues[$key])) {
          $key
        }
      }
    )

    if ($missingKeys.Count -gt 0) {
      throw "Missing required env keys: $($missingKeys -join ', ')"
    }

    Add-Pass "Server env file" "All required env keys are present."
  }

  Invoke-Check "Installed dependencies" {
    $missing = @()

    if (-not (Test-Path (Join-Path $ClientDir "node_modules"))) {
      $missing += "client/node_modules"
    }

    if (-not (Test-Path (Join-Path $ServerDir "node_modules"))) {
      $missing += "server/node_modules"
    }

    if ($missing.Count -gt 0) {
      throw "Missing dependency folders: $($missing -join ', ')"
    }

    Add-Pass "Installed dependencies" "client and server dependencies are present."
  }

  if (-not $SkipClientChecks) {
    Invoke-Check "Client lint" {
      $result = Invoke-NpmScript -WorkingDirectory $ClientDir -ScriptName "lint"

      if ($result.ExitCode -ne 0) {
        throw $result.Output
      }

      Add-Pass "Client lint" "npm run lint passed."
    }

    Invoke-Check "Client build" {
      $result = Invoke-NpmScript -WorkingDirectory $ClientDir -ScriptName "build"

      if ($result.ExitCode -ne 0) {
        throw $result.Output
      }

      Add-Pass "Client build" "npm run build passed."
    }
  } else {
    Add-Warning "Client checks" "Skipped lint and build because -SkipClientChecks was provided."
  }

  Invoke-Check "Server availability" {
    Start-ServerIfNeeded
  }

  Invoke-Check "Backend health endpoint" {
    $response = Invoke-WebRequestSafe -Uri "$ServerBaseUrl/test"

    if ($response.StatusCode -ne 200 -or $response.Content -notmatch "backend is working") {
      throw "Expected 200 with 'backend is working', got status $($response.StatusCode)."
    }

    Add-Pass "Backend health endpoint" "GET /test returned the expected response."
  }

  Invoke-Check "Auth status endpoint" {
    $response = Invoke-WebRequestSafe -Uri "$ServerBaseUrl/auth/microsoft/status"

    if ($response.StatusCode -ne 200) {
      throw "Expected 200, got $($response.StatusCode)."
    }

    $payload = $response.Content | ConvertFrom-Json

    if (-not ($payload.PSObject.Properties.Name -contains "authenticated")) {
      throw "Response JSON is missing 'authenticated'."
    }

    Add-Pass "Auth status endpoint" "GET /auth/microsoft/status returned a valid auth payload."
  }

  Invoke-Check "Protected profile route" {
    $response = Invoke-WebRequestSafe -Uri "$ServerBaseUrl/me"

    if ($response.StatusCode -ne 401) {
      throw "Expected 401 before login, got $($response.StatusCode)."
    }

    Add-Pass "Protected profile route" "GET /me is protected before login."
  }

  Invoke-Check "Protected messages route" {
    $response = Invoke-WebRequestSafe -Uri "$ServerBaseUrl/outlook/messages"

    if ($response.StatusCode -ne 401) {
      throw "Expected 401 before login, got $($response.StatusCode)."
    }

    Add-Pass "Protected messages route" "GET /outlook/messages is protected before login."
  }

  Invoke-Check "Microsoft auth redirect" {
    $response = Invoke-NoRedirectGet -Uri "$ServerBaseUrl/auth/microsoft/start"
    $location = $response.Location

    if ($response.StatusCode -notin @(301, 302) -or -not $location) {
      throw "Expected redirect to Microsoft login, got status $($response.StatusCode)."
    }

    if ($location -notmatch "^https://login\.microsoftonline\.com/") {
      throw "Redirect target does not look like Microsoft login."
    }

    Add-Pass "Microsoft auth redirect" "OAuth start route redirects to Microsoft."
  }

  if (-not $SkipAiCheck) {
    Invoke-Check "AI service reachability" {
      $body = @{
        agentSlug = "email_classifier"
        message   = "ping"
      } | ConvertTo-Json

      $response = Invoke-WebRequestSafe `
        -Uri "$AiBaseUrl/chat" `
        -Method "POST" `
        -Body $body `
        -ContentType "application/json"

      if ($response.StatusCode -ne 200) {
        throw "Expected 200 from AI service, got $($response.StatusCode)."
      }

      Add-Pass "AI service reachability" "POST /chat responded successfully."
    }
  } else {
    Add-Warning "AI service reachability" "Skipped AI service check because -SkipAiCheck was provided."
  }
} finally {
  Stop-StartedServer
}

Write-Host ""
Write-Host "==> Summary" -ForegroundColor Cyan
Write-Host "Passed checks completed. Failures: $($script:Failures.Count). Warnings: $($script:Warnings.Count)." -ForegroundColor White

if ($script:Failures.Count -gt 0) {
  Write-Host ""
  Write-Host "Failures" -ForegroundColor Red

  foreach ($failure in $script:Failures) {
    Write-Host "- $failure" -ForegroundColor Red
  }

  exit 1
}

if ($script:Warnings.Count -gt 0) {
  Write-Host ""
  Write-Host "Warnings" -ForegroundColor Yellow

  foreach ($warning in $script:Warnings) {
    Write-Host "- $warning" -ForegroundColor Yellow
  }
}

exit 0
