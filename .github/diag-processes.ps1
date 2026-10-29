# Lists the processes that started since $env:SINCE with their parents and command lines,
# the warnings and errors of the event logs since then, and stops those processes.
$since = [DateTime]::Parse($env:SINCE).ToUniversalTime()
$started = Get-CimInstance Win32_Process |
  Where-Object { $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $since -and $_.ProcessId -ne $PID } |
  Sort-Object CreationDate
"== Processes started since $since (pid, parent, start, name, command line)"
foreach ($p in $started) {
  '{0,6} {1,6} {2:HH:mm:ss} {3} {4}' -f $p.ProcessId, $p.ParentProcessId, $p.CreationDate, $p.Name, $p.CommandLine
}
"== Events since $since"
Get-WinEvent -FilterHashtable @{ LogName = 'Application', 'System'; StartTime = $since.ToLocalTime() } -ErrorAction SilentlyContinue |
  Where-Object { $_.Level -le 3 -or $_.ProviderName -match 'MsiInstaller|Error Reporting|Hang' } |
  Sort-Object TimeCreated |
  ForEach-Object {
    $text = ($_.Message -replace '\s+', ' ')
    if ($text.Length -gt 500) { $text = $text.Substring(0, 500) }
    '{0:HH:mm:ss} {1} {2} {3}' -f $_.TimeCreated, $_.ProviderName, $_.Id, $text
  }
$keep = 'svchost.exe', 'WmiPrvSE.exe', 'conhost.exe', 'pwsh.exe', 'timeout.exe', 'bash.exe', 'sh.exe'
$stop = @($started | Where-Object { $_.Name -notin $keep })
if ($env:STOP -ne '1') { '== Listed only'; return }
'== Stopping: ' + (($stop | ForEach-Object { '{0}/{1}' -f $_.Name, $_.ProcessId }) -join ' ')
foreach ($p in $stop) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
