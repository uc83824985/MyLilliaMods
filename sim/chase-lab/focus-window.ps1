param([Parameter(Mandatory = $true)][int]$BrowserProcessId)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LabWindow {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$script:LabHandle = [IntPtr]::Zero
$callback = [LabWindow+EnumProc] {
    param([IntPtr]$handle, [IntPtr]$unused)
    [uint32]$owner = 0
    [void][LabWindow]::GetWindowThreadProcessId($handle, [ref]$owner)
    if ($owner -eq $BrowserProcessId -and [LabWindow]::IsWindowVisible($handle)) {
        $script:LabHandle = $handle
        return $false
    }
    return $true
}
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    [void][LabWindow]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:LabHandle -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 100
}
if ($script:LabHandle -eq [IntPtr]::Zero) { throw 'No visible Chase Lab window was found.' }
if ([LabWindow]::IsIconic($script:LabHandle)) {
    [void][LabWindow]::ShowWindowAsync($script:LabHandle, 9)
}
$shell = New-Object -ComObject WScript.Shell
[void]$shell.AppActivate($BrowserProcessId)
[void][LabWindow]::SetForegroundWindow($script:LabHandle)
Start-Sleep -Milliseconds 150
if ([LabWindow]::GetForegroundWindow() -ne $script:LabHandle) {
    throw 'Windows blocked foreground activation. Select the Chase Lab window on the taskbar.'
}
Write-Output 'Chase Lab window is in the foreground.'
