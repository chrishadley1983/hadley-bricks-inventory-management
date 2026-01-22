/**
 * Tray Application Context
 *
 * TRAY2: System tray icon with NotifyIcon
 * TUI1-TUI7: Tray interface with 4 color states, context menu
 */

using Serilog;
using System.Reflection;

namespace HadleyBricksScanner;

/// <summary>
/// Manages the system tray application lifecycle
/// </summary>
public class TrayApplicationContext : ApplicationContext
{
    private readonly NotifyIcon _notifyIcon;
    private readonly SchedulerEngine _scheduler;
    private readonly ConfigManager _configManager;

    private Icon _iconGreen = null!;
    private Icon _iconYellow = null!;
    private Icon _iconRed = null!;
    private Icon _iconGrey = null!;

    public TrayApplicationContext()
    {
        _configManager = new ConfigManager();
        LoadIcons();

        // TUI2: System tray icon with NotifyIcon
        _notifyIcon = new NotifyIcon
        {
            Icon = _iconGrey,
            Visible = true,
            Text = "Hadley Bricks Scanner - Starting..."
        };

        // TUI5: Context menu with all options
        _notifyIcon.ContextMenuStrip = CreateContextMenu();
        _notifyIcon.DoubleClick += OnOpenDashboard;

        // Create and start scheduler
        _scheduler = new SchedulerEngine(_configManager, this);

        // Start the scheduler
        Task.Run(StartSchedulerAsync);
    }

    private async Task StartSchedulerAsync()
    {
        try
        {
            await _scheduler.StartAsync();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to start scheduler");
            SetState(TrayState.Error, ex.Message);
        }
    }

    /// <summary>
    /// Load embedded icon resources
    /// </summary>
    private void LoadIcons()
    {
        var assembly = Assembly.GetExecutingAssembly();

        // Try to load embedded icons, fallback to system icons
        _iconGreen = LoadEmbeddedIcon(assembly, "icon-green.ico") ?? SystemIcons.Application;
        _iconYellow = LoadEmbeddedIcon(assembly, "icon-yellow.ico") ?? SystemIcons.Warning;
        _iconRed = LoadEmbeddedIcon(assembly, "icon-red.ico") ?? SystemIcons.Error;
        _iconGrey = LoadEmbeddedIcon(assembly, "icon-grey.ico") ?? SystemIcons.Shield;
    }

    private static Icon? LoadEmbeddedIcon(Assembly assembly, string iconName)
    {
        try
        {
            var resourceName = $"HadleyBricksScanner.Resources.{iconName}";
            using var stream = assembly.GetManifestResourceStream(resourceName);
            return stream != null ? new Icon(stream) : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Create context menu (TUI5)
    /// </summary>
    private ContextMenuStrip CreateContextMenu()
    {
        var menu = new ContextMenuStrip();

        // Status item (non-clickable)
        var statusItem = new ToolStripMenuItem("Status: Starting...")
        {
            Enabled = false,
            Name = "status"
        };
        menu.Items.Add(statusItem);

        menu.Items.Add(new ToolStripSeparator());

        // Resume/Pause toggle
        var pauseItem = new ToolStripMenuItem("Pause Scanner", null, OnTogglePause)
        {
            Name = "pause"
        };
        menu.Items.Add(pauseItem);

        // Refresh schedule
        menu.Items.Add(new ToolStripMenuItem("Refresh Schedule", null, OnRefreshSchedule));

        // Close browser tabs
        menu.Items.Add(new ToolStripMenuItem("Close Browser Tabs", null, OnCloseBrowserTabs));

        menu.Items.Add(new ToolStripSeparator());

        // Open dashboard
        menu.Items.Add(new ToolStripMenuItem("Open Dashboard", null, OnOpenDashboard));

        // View logs
        menu.Items.Add(new ToolStripMenuItem("View Logs", null, OnViewLogs));

        // Settings
        menu.Items.Add(new ToolStripMenuItem("Settings...", null, OnOpenSettings));

        menu.Items.Add(new ToolStripSeparator());

        // Exit
        menu.Items.Add(new ToolStripMenuItem("Exit", null, OnExit));

        return menu;
    }

    /// <summary>
    /// Update tray icon state (TUI1-TUI4)
    /// </summary>
    public void SetState(TrayState state, string? message = null)
    {
        if (_notifyIcon == null) return;

        // TUI1-TUI4: Four color states
        (_notifyIcon.Icon, var statusText) = state switch
        {
            TrayState.Running => (_iconGreen, "Running"),
            TrayState.Paused => (_iconYellow, "Paused"),
            TrayState.Error => (_iconRed, "Error"),
            TrayState.OutsideHours => (_iconGrey, "Outside Hours"),
            _ => (_iconGrey, "Unknown")
        };

        // TUI6: Tooltip shows status
        var tooltip = $"Hadley Bricks Scanner - {statusText}";
        if (!string.IsNullOrEmpty(message))
        {
            tooltip += $"\n{message}";
        }
        _notifyIcon.Text = tooltip.Length > 63 ? tooltip[..63] : tooltip;

        // Update context menu status
        var statusItem = _notifyIcon.ContextMenuStrip?.Items["status"] as ToolStripMenuItem;
        if (statusItem != null)
        {
            statusItem.Text = $"Status: {statusText}";
        }

        // Update pause/resume button
        var pauseItem = _notifyIcon.ContextMenuStrip?.Items["pause"] as ToolStripMenuItem;
        if (pauseItem != null)
        {
            pauseItem.Text = state == TrayState.Paused ? "Resume Scanner" : "Pause Scanner";
        }
    }

    /// <summary>
    /// Show balloon notification (TUI7)
    /// </summary>
    public void ShowBalloon(string title, string message, ToolTipIcon icon = ToolTipIcon.Info)
    {
        _notifyIcon.ShowBalloonTip(5000, title, message, icon);
    }

    private void OnTogglePause(object? sender, EventArgs e)
    {
        _ = _scheduler.TogglePauseAsync();
    }

    private void OnRefreshSchedule(object? sender, EventArgs e)
    {
        _ = _scheduler.RefreshScheduleAsync();
    }

    private void OnCloseBrowserTabs(object? sender, EventArgs e)
    {
        var closedByTitle = ChromeTabManager.CloseVintedTabs();
        var closedByProcess = ChromeTabManager.ClosePlaywrightBrowsers();
        var total = closedByTitle + closedByProcess;

        if (total > 0)
        {
            ShowBalloon("Browser Cleanup", $"Closed {total} browser tab(s)/process(es).");
        }
        else
        {
            ShowBalloon("Browser Cleanup", "No browser tabs found to close.");
        }
    }

    private void OnOpenDashboard(object? sender, EventArgs e)
    {
        var url = $"{_configManager.BaseUrl}/arbitrage/vinted/automation";
        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to open dashboard");
        }
    }

    private void OnViewLogs(object? sender, EventArgs e)
    {
        var logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HadleyBricks", "Scanner", "logs"
        );

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = logPath,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to open logs folder");
        }
    }

    private void OnOpenSettings(object? sender, EventArgs e)
    {
        // Simple settings dialog
        var apiKey = _configManager.GetApiKey() ?? "";
        var input = Microsoft.VisualBasic.Interaction.InputBox(
            "Enter API Key:",
            "Settings",
            apiKey
        );

        if (!string.IsNullOrWhiteSpace(input) && input != apiKey)
        {
            _configManager.SetApiKey(input);
            ShowBalloon("Settings Saved", "API key updated. Restarting scheduler...");
            _ = _scheduler.RestartAsync();
        }
    }

    private void OnExit(object? sender, EventArgs e)
    {
        _scheduler.Stop();
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
        Application.Exit();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _scheduler.Dispose();
            _notifyIcon.Dispose();
            _iconGreen?.Dispose();
            _iconYellow?.Dispose();
            _iconRed?.Dispose();
            _iconGrey?.Dispose();
        }
        base.Dispose(disposing);
    }
}

/// <summary>
/// Tray icon states (TUI1-TUI4)
/// </summary>
public enum TrayState
{
    Running,     // Green - actively scanning
    Paused,      // Yellow - paused by user or CAPTCHA
    Error,       // Red - error condition
    OutsideHours // Grey - outside operating hours
}
