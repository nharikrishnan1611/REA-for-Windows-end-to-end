/**
 * Generates an isolated PowerShell script to inspect a target window using
 * Microsoft UI Automation and capture its screenshot via Windows GDI.
 */
export function generateUiAutomationScript(options: {
  readonly pid: number;
  readonly windowId: number;
  readonly maxNodes: number;
  readonly captureScreenshot: boolean;
  readonly captureAccessibility: boolean;
  readonly redactSensitive: boolean;
}): string {
  const {
    pid,
    windowId,
    maxNodes,
    captureScreenshot,
    captureAccessibility,
    redactSensitive,
  } = options;

  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms

$targetPid = ${pid}
$targetHwnd = [IntPtr]${windowId}
$maxNodes = ${maxNodes}
$captureScreenshot = ${captureScreenshot ? "$true" : "$false"}
$captureAccessibility = ${captureAccessibility ? "$true" : "$false"}
$redactSensitive = ${redactSensitive ? "$true" : "$false"}

# 1. Verify window exists and belongs to target PID
$winProc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if ($null -eq $winProc) {
    @{
        ok = $false
        code = 'pid-not-application'
        message = "Process $targetPid is not active or accessible."
    } | ConvertTo-Json -Compress
    exit 0
}

$element = $null
try {
    $element = [System.Windows.Automation.AutomationElement]::FromHandle($targetHwnd)
} catch {
    @{
        ok = $false
        code = 'window-mismatch'
        message = "Could not attach to window handle $targetHwnd : $($_.Exception.Message)"
    } | ConvertTo-Json -Compress
    exit 0
}

if ($null -eq $element) {
    @{
        ok = $false
        code = 'window-mismatch'
        message = "Window handle $targetHwnd does not correspond to an active UI Automation element."
    } | ConvertTo-Json -Compress
    exit 0
}

$actualPid = $element.Current.ProcessId
if ($actualPid -ne $targetPid) {
    @{
        ok = $false
        code = 'target-mismatch'
        message = "Window handle $targetHwnd belongs to PID $actualPid, not expected PID $targetPid."
    } | ConvertTo-Json -Compress
    exit 0
}

$windowTitle = $element.Current.Name
if ([string]::IsNullOrEmpty($windowTitle)) {
    $windowTitle = $winProc.MainWindowTitle
}
if ([string]::IsNullOrEmpty($windowTitle)) {
    $windowTitle = $winProc.ProcessName
}

$executablePath = ""
try {
    $executablePath = $winProc.MainModule.FileName
} catch {
    $executablePath = $winProc.ProcessName + ".exe"
}

$launchTime = 0
try {
    $launchTime = [double]($winProc.StartTime.ToUniversalTime().Subtract([datetime]'1970-01-01')).TotalMilliseconds
} catch {
    $launchTime = [double](Get-Date -UFormat %s) * 1000
}

# 2. Extract Accessible Nodes
$nodes = [System.Collections.Generic.List[PSObject]]::new()
$truncated = $false
$gaps = [System.Collections.Generic.List[string]]::new()

if ($captureAccessibility) {
    $queue = [System.Collections.Generic.Queue[PSObject]]::new()
    $queue.Enqueue(@{ Element = $element; Path = @() })

    while ($queue.Count -gt 0 -and $nodes.Count -lt $maxNodes) {
        $item = $queue.Dequeue()
        $curr = $item.Element
        $path = $item.Path

        $controlType = $curr.Current.ControlType.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant()
        $name = $curr.Current.Name
        if ([string]::IsNullOrWhiteSpace($name)) { $name = $null }

        $val = $null
        $isPassword = $curr.Current.IsPassword
        if ($isPassword -and $redactSensitive) {
            $val = "[REDACTED]"
        } else {
            $valPattern = $null
            if ($curr.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valPattern)) {
                $rawVal = $valPattern.Current.Value
                if ($redactSensitive -and ($name -match 'password|token|secret|pin|credit|auth' -or $isPassword)) {
                    $val = "[REDACTED]"
                } else {
                    $val = $rawVal
                }
            }
        }

        $actions = [System.Collections.Generic.List[string]]::new()
        $patterns = $curr.GetSupportedPatterns()
        foreach ($p in $patterns) {
            $pName = $p.ProgrammaticName.Replace("PatternIdentifiers.Pattern", "").Replace("Pattern", "")
            if ($pName -eq 'Invoke') { $actions.Add('click') }
            elseif ($pName -eq 'Scroll') { $actions.Add('scroll') }
            elseif ($pName -eq 'Value') { $actions.Add('key-entry') }
        }

        $children = @()
        try {
            $children = $curr.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
        } catch {
            $children = @()
        }

        $childCount = if ($null -ne $children) { $children.Count } else { 0 }

        $nodes.Add(@{
            path = $path
            role = $controlType
            title = $name
            value = $val
            actions = @($actions)
            children_count = $childCount
        })

        if ($nodes.Count -ge $maxNodes) {
            $truncated = $true
            break
        }

        if ($null -ne $children) {
            for ($i = 0; $i -lt $children.Count; $i++) {
                if ($nodes.Count + $queue.Count -ge $maxNodes) {
                    $truncated = $true
                    break
                }
                $childElem = $children.Item($i)
                $childPath = @($path) + @($i)
                $queue.Enqueue(@{ Element = $childElem; Path = $childPath })
            }
        }
    }

    if ($nodes.Count -le 1) {
        $gaps.Add("Custom-rendered or protected canvas exposes insufficient accessibility metadata")
    }
}

# 3. Screenshot Capture via GDI
$screenshotObj = $null
if ($captureScreenshot) {
    try {
        $rect = $element.Current.BoundingRectangle
        $width = [int]$rect.Width
        $height = [int]$rect.Height
        if ($width -gt 0 -and $height -gt 0) {
            $bmp = New-Object System.Drawing.Bitmap($width, $height)
            $gfx = [System.Drawing.Graphics]::FromImage($bmp)
            $gfx.CopyFromScreen([int]$rect.X, [int]$rect.Y, 0, 0, (New-Object System.Drawing.Size($width, $height)), [System.Drawing.CopyPixelOperation]::SourceCopy)
            $gfx.Dispose()

            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $bmp.Dispose()

            $bytes = $ms.ToArray()
            $ms.Dispose()

            $base64 = [Convert]::ToBase64String($bytes)
            $hasher = [System.Security.Cryptography.SHA256]::Create()
            $hashBytes = $hasher.ComputeHash($bytes)
            $sha256 = -join ($hashBytes | ForEach-Object { "{0:x2}" -f $_ })

            $screenshotObj = @{
                mime_type = "image/png"
                base64 = $base64
                sha256 = $sha256
                width = $width
                height = $height
            }
        }
    } catch {
        $gaps.Add("Screenshot capture failed: $($_.Exception.Message)")
    }
}

$snapshot = @{
    window = @{
        pid = $targetPid
        window_id = [int]$targetHwnd.ToInt32()
        executable = $executablePath
        launch_time = [double]$launchTime
        title = $windowTitle
    }
    nodes = @($nodes)
    truncated = $truncated
    screenshot = $screenshotObj
    gaps = @($gaps)
}

@{
    ok = $true
    result = $snapshot
} | ConvertTo-Json -Depth 10 -Compress
`;
}
