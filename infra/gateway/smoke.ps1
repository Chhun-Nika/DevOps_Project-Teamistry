$ErrorActionPreference = 'Stop'

function Assert-Status([string] $uri, [int] $expected) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -Method Get
    if ([int]$response.StatusCode -ne $expected) { throw "Expected $expected from $uri but received $($response.StatusCode)." }
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq $expected) { return }
    throw
  }
}

Assert-Status 'http://localhost:8080/api/user-team/health' 200
Assert-Status 'http://localhost:8080/api/task/health' 200
Assert-Status 'http://localhost:8080/api/notification/health' 200
Assert-Status 'http://localhost:8080/internal/teams/example' 404
Assert-Status 'http://localhost:8080/api/internal/teams/example' 404

Write-Output 'Gateway smoke checks passed.'
