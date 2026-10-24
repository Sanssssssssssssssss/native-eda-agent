param([int]$VivadoProcessId, [switch]$Inspect)
$ErrorActionPreference = 'Stop'
# PrintWindow captures only Vivado even while other user applications are in front.
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class VivadoCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd,IntPtr hdc,uint flags);
}
'@
[VivadoCapture]::SetProcessDPIAware() | Out-Null
$vivadoProcess = Get-Process -Id $VivadoProcessId -ErrorAction Stop
if ($vivadoProcess.ProcessName -ne 'vivado' -or !$vivadoProcess.MainWindowHandle) { throw 'Expected an open Vivado GUI process' }
$rect = New-Object VivadoCapture+Rect
[VivadoCapture]::GetWindowRect($vivadoProcess.MainWindowHandle,[ref]$rect) | Out-Null
if (($rect.R-$rect.L) -lt 100 -or ($rect.B-$rect.T) -lt 100) { throw 'Restore the Vivado window before capturing; it appears minimized' }
$bitmap = New-Object System.Drawing.Bitmap(($rect.R-$rect.L),($rect.B-$rect.T))
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
try {
    if (![VivadoCapture]::PrintWindow($vivadoProcess.MainWindowHandle,$dc,2)) { throw 'PrintWindow failed' }
} finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
if ($Inspect) { $captureDir = [System.IO.Path]::GetTempPath() }
else {
    $captureDir = [Environment]::GetFolderPath('MyPictures')
    if (Test-Path (Join-Path $captureDir 'Screenshots')) { $captureDir = Join-Path $captureDir 'Screenshots' }
}
if (!$captureDir) { throw 'Windows did not return a Pictures directory' }
[System.IO.Directory]::CreateDirectory($captureDir) | Out-Null
$capturePath = Join-Path $captureDir ('vivado-' + (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss') + '.png')
try { $bitmap.Save($capturePath,[System.Drawing.Imaging.ImageFormat]::Png) }
finally { $bitmap.Dispose() }
$capturePath
