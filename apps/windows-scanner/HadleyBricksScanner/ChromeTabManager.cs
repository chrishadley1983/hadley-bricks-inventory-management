/**
 * Chrome Tab Manager
 *
 * Manages Chrome tabs to prevent accumulation during scanning.
 * Closes stale Vinted tabs after scan completion.
 */

using System.Diagnostics;
using System.Runtime.InteropServices;
using Serilog;

namespace HadleyBricksScanner;

/// <summary>
/// Manages Chrome browser tabs to prevent memory bloat from accumulated tabs
/// </summary>
public static class ChromeTabManager
{
    // Windows API for finding windows
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private const uint WM_CLOSE = 0x0010;

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    /// <summary>
    /// Close all Chrome/Chromium windows with Vinted in the title
    /// This helps prevent tab accumulation from Claude CLI scans
    /// Handles both Google Chrome and Playwright MCP browser windows
    /// </summary>
    public static int CloseVintedTabs()
    {
        var closedCount = 0;
        var vintedWindows = new List<IntPtr>();

        EnumWindows((hWnd, lParam) =>
        {
            var length = GetWindowTextLength(hWnd);
            if (length > 0)
            {
                var sb = new System.Text.StringBuilder(length + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                var title = sb.ToString();

                // Look for Vinted pages OR Claude MCP browser windows
                // Claude MCP tabs show as "Claude (MCP)" when browsing Vinted
                bool isVintedPage = title.Contains("vinted", StringComparison.OrdinalIgnoreCase);
                bool isClaudeMcpWindow = title.Contains("Claude (MCP)", StringComparison.OrdinalIgnoreCase);

                if (isVintedPage || isClaudeMcpWindow)
                {
                    // Match Chrome, Chromium, or any window with these titles
                    // Claude MCP windows may not have "Chrome" in title
                    if (title.Contains("Google Chrome", StringComparison.OrdinalIgnoreCase) ||
                        title.Contains("Chromium", StringComparison.OrdinalIgnoreCase) ||
                        title.EndsWith(" - Vinted", StringComparison.OrdinalIgnoreCase) ||
                        title.StartsWith("Vinted", StringComparison.OrdinalIgnoreCase) ||
                        isClaudeMcpWindow)
                    {
                        vintedWindows.Add(hWnd);
                    }
                }
            }
            return true; // Continue enumeration
        }, IntPtr.Zero);

        // Close found windows
        foreach (var hWnd in vintedWindows)
        {
            try
            {
                // Send close message - this closes the tab/window gracefully
                PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                closedCount++;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to close Vinted tab");
            }
        }

        if (closedCount > 0)
        {
            Log.Information("Closed {Count} Vinted tab(s)", closedCount);
        }

        return closedCount;
    }

    /// <summary>
    /// Close all Playwright MCP browser windows (any page)
    /// Use this as a more aggressive cleanup when Vinted tabs aren't being detected
    /// </summary>
    public static int ClosePlaywrightBrowsers()
    {
        var closedCount = 0;

        // Playwright uses its own Chromium instance - look for specific process names
        // The Playwright MCP typically launches chromium or chrome with specific flags
        var processNames = new[] { "chromium", "chrome", "msedge" };

        foreach (var processName in processNames)
        {
            var processes = Process.GetProcessesByName(processName);
            foreach (var process in processes)
            {
                try
                {
                    // Check if this is a Playwright-managed browser by looking at command line
                    // Playwright browsers typically have --remote-debugging-port or --playwright flags
                    var commandLine = GetProcessCommandLine(process.Id);
                    if (commandLine != null &&
                        (commandLine.Contains("--remote-debugging", StringComparison.OrdinalIgnoreCase) ||
                         commandLine.Contains("playwright", StringComparison.OrdinalIgnoreCase) ||
                         commandLine.Contains("puppeteer", StringComparison.OrdinalIgnoreCase)))
                    {
                        process.Kill();
                        closedCount++;
                        Log.Debug("Killed Playwright browser process {Pid}", process.Id);
                    }
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Failed to kill browser process {Pid}", process.Id);
                }
            }
        }

        if (closedCount > 0)
        {
            Log.Information("Killed {Count} Playwright browser process(es)", closedCount);
        }

        return closedCount;
    }

    /// <summary>
    /// Get the command line of a process by ID
    /// </summary>
    private static string? GetProcessCommandLine(int processId)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                $"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {processId}");
            foreach (var obj in searcher.Get())
            {
                return obj["CommandLine"]?.ToString();
            }
        }
        catch
        {
            // WMI query failed - process might have exited
        }
        return null;
    }

    /// <summary>
    /// Get count of open Chrome processes
    /// </summary>
    public static int GetChromeProcessCount()
    {
        return Process.GetProcessesByName("chrome").Length;
    }

    /// <summary>
    /// Kill all Chrome processes (nuclear option - use sparingly)
    /// </summary>
    public static void KillAllChrome()
    {
        var processes = Process.GetProcessesByName("chrome");
        foreach (var process in processes)
        {
            try
            {
                process.Kill();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to kill Chrome process {Pid}", process.Id);
            }
        }
        Log.Information("Killed {Count} Chrome process(es)", processes.Length);
    }
}
