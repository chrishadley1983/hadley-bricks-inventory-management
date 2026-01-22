/**
 * Scheduler Engine
 *
 * LOOP1-LOOP9: Main loop with 30-second polling, scan execution
 * POLL1-POLL4: Config polling every 5 minutes
 * THB1-THB3: Heartbeat every 5 minutes
 * TERR1-TERR4: Error handling, retry logic, cached schedule fallback
 * MISS1-MISS3: Missed scans - skip policy, no catch-up
 */

using HadleyBricksScanner.Models;
using Serilog;

namespace HadleyBricksScanner;

/// <summary>
/// Core scheduling engine - manages scan execution and server communication
/// </summary>
public class SchedulerEngine : IDisposable
{
    private readonly ConfigManager _configManager;
    private readonly TrayApplicationContext _trayContext;
    private readonly ClaudeExecutor _claudeExecutor;

    private ApiClient? _apiClient;
    private ConfigResponse? _config;
    private ScheduleResponse? _schedule;

    private CancellationTokenSource? _cts;
    private bool _isPaused;
    private int _consecutiveFailures;
    private DateTime? _lastScanAt;
    private int _scansToday;
    private int _opportunitiesToday;
    private int _currentConfigVersion;
    private int _currentScheduleVersion;

    // Timing constants
    private const int MainLoopIntervalMs = 30_000;      // LOOP1: 30 seconds
    private const int ConfigPollIntervalMs = 300_000;   // POLL1: 5 minutes
    private const int HeartbeatIntervalMs = 300_000;    // THB1: 5 minutes
    private const int MaxConsecutiveFailures = 3;       // TERR2: 3 failures before alert

    public SchedulerEngine(ConfigManager configManager, TrayApplicationContext trayContext)
    {
        _configManager = configManager;
        _trayContext = trayContext;
        _claudeExecutor = new ClaudeExecutor();
    }

    /// <summary>
    /// Start the scheduler
    /// </summary>
    public async Task StartAsync()
    {
        _cts = new CancellationTokenSource();

        // Load API key
        var apiKey = _configManager.GetApiKey();
        if (string.IsNullOrEmpty(apiKey))
        {
            _trayContext.SetState(TrayState.Error, "No API key configured");
            _trayContext.ShowBalloon("Configuration Required",
                "Please set your API key in Settings.", ToolTipIcon.Warning);
            return;
        }

        _apiClient = new ApiClient(_configManager.BaseUrl, apiKey);

        // Initial load (restore counts from server on startup)
        await LoadConfigAsync(restoreCounts: true);
        await LoadScheduleAsync();

        if (_config == null || _schedule == null)
        {
            // TERR4: Try cached schedule fallback
            _schedule = _configManager.GetCachedSchedule();

            if (_schedule == null)
            {
                _trayContext.SetState(TrayState.Error, "Failed to load schedule");
                return;
            }

            _trayContext.ShowBalloon("Using Cached Schedule",
                "API unreachable. Using cached schedule.", ToolTipIcon.Warning);
        }

        // Start background workers
        _ = Task.Run(() => MainLoopAsync(_cts.Token), _cts.Token);
        _ = Task.Run(() => ConfigPollLoopAsync(_cts.Token), _cts.Token);
        _ = Task.Run(() => HeartbeatLoopAsync(_cts.Token), _cts.Token);

        Log.Information("Scheduler started successfully");
    }

    /// <summary>
    /// Main scan execution loop (LOOP1-LOOP9)
    /// </summary>
    private async Task MainLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // LOOP2: 30 second interval
                await Task.Delay(MainLoopIntervalMs, ct);

                // Check operating hours
                if (!IsWithinOperatingHours())
                {
                    _trayContext.SetState(TrayState.OutsideHours);
                    continue;
                }

                // Check if paused
                if (_isPaused || (_config?.Paused ?? false))
                {
                    _trayContext.SetState(TrayState.Paused, _config?.PauseReason);
                    continue;
                }

                // Check if enabled
                if (!(_config?.Enabled ?? false))
                {
                    _trayContext.SetState(TrayState.Paused, "Scanner disabled");
                    continue;
                }

                _trayContext.SetState(TrayState.Running);

                // Find next due scan (LOOP3)
                var dueScan = GetNextDueScan();
                if (dueScan != null)
                {
                    await ExecuteScanAsync(dueScan, ct);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Error in main loop");
                _consecutiveFailures++;

                // TERR2: Alert after 3 consecutive failures
                if (_consecutiveFailures >= MaxConsecutiveFailures)
                {
                    _trayContext.SetState(TrayState.Error, "Multiple scan failures");
                    _trayContext.ShowBalloon("Scanner Error",
                        $"Scanner has failed {_consecutiveFailures} times.", ToolTipIcon.Error);
                }
            }
        }
    }

    /// <summary>
    /// Config polling loop (POLL1-POLL4)
    /// </summary>
    private async Task ConfigPollLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(ConfigPollIntervalMs, ct);
                await LoadConfigAsync();

                // POLL2: Compare versions
                if (_config != null)
                {
                    // POLL3: Refresh if config version changed
                    if (_config.ConfigVersion != _currentConfigVersion)
                    {
                        Log.Information("Config version changed: {Old} -> {New}",
                            _currentConfigVersion, _config.ConfigVersion);
                        _currentConfigVersion = _config.ConfigVersion;
                    }

                    // POLL3: Refresh schedule if version changed
                    if (_config.ScheduleVersion != _currentScheduleVersion)
                    {
                        Log.Information("Schedule version changed: {Old} -> {New}",
                            _currentScheduleVersion, _config.ScheduleVersion);
                        await LoadScheduleAsync();
                    }
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Error in config poll loop");
            }
        }
    }

    /// <summary>
    /// Heartbeat loop (THB1-THB3)
    /// </summary>
    private async Task HeartbeatLoopAsync(CancellationToken ct)
    {
        // Send initial heartbeat immediately on startup
        try
        {
            await SendHeartbeatAsync();
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Error sending initial heartbeat");
        }

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(HeartbeatIntervalMs, ct);
                await SendHeartbeatAsync();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Error in heartbeat loop");
            }
        }
    }

    /// <summary>
    /// Execute a single scan (LOOP4-LOOP7)
    /// </summary>
    private async Task ExecuteScanAsync(ScheduledScan scan, CancellationToken ct)
    {
        Log.Information("Executing scan: {ScanId} ({ScanType})", scan.Id, scan.Type);

        try
        {
            // LOOP5: Execute Claude CLI
            var result = await _claudeExecutor.ExecuteScanAsync(scan, ct);

            // CLI14: Handle CAPTCHA detection
            if (result.CaptchaDetected)
            {
                _isPaused = true;
                _trayContext.SetState(TrayState.Paused, "CAPTCHA detected");
                _trayContext.ShowBalloon("CAPTCHA Detected",
                    "Scanner paused. Please resolve CAPTCHA.", ToolTipIcon.Warning);
            }

            // LOOP6: Post result to server
            if (_apiClient != null)
            {
                var processRequest = new ProcessRequest
                {
                    ScanId = scan.Id,
                    ScanType = scan.Type,
                    SetNumber = scan.SetNumber,
                    Result = result
                };

                var success = await _apiClient.ProcessScanResultAsync(processRequest);

                if (success && result.Success)
                {
                    _consecutiveFailures = 0;
                    _scansToday++;

                    // Count opportunities (rough estimate - server has actual count)
                    var viableCount = result.Listings.Count(l => l.Price > 0);
                    _opportunitiesToday += viableCount;
                }
            }

            // LOOP7: Mark scan as executed
            scan.Executed = true;
            _lastScanAt = DateTime.UtcNow;

            // Clean up accumulated browser tabs after scan
            try
            {
                await Task.Delay(2000); // Wait for Claude to finish with browser

                // First try to close Vinted tabs by window title (graceful)
                var closedByTitle = ChromeTabManager.CloseVintedTabs();

                // If no tabs were closed by title, try to close Playwright browser processes
                // This catches MCP browser instances that might not have recognizable titles
                if (closedByTitle == 0)
                {
                    ChromeTabManager.ClosePlaywrightBrowsers();
                }
            }
            catch (Exception cleanupEx)
            {
                Log.Warning(cleanupEx, "Failed to clean up browser tabs");
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to execute scan {ScanId}", scan.Id);
            _consecutiveFailures++;
        }
    }

    /// <summary>
    /// Get next due scan (MISS1-MISS3: skip missed scans)
    /// </summary>
    private ScheduledScan? GetNextDueScan()
    {
        if (_schedule?.Scans == null) return null;

        var now = DateTime.Now;
        var currentTime = now.TimeOfDay;

        foreach (var scan in _schedule.Scans)
        {
            if (scan.Executed) continue;

            // Parse scheduled time
            if (!TimeSpan.TryParse(scan.ScheduledTime, out var scheduledTime))
                continue;

            // MISS1: Skip policy - only execute if within 5 minutes of scheduled time
            var difference = currentTime - scheduledTime;

            if (difference.TotalMinutes >= 0 && difference.TotalMinutes < 5)
            {
                // Within execution window
                return scan;
            }
            else if (difference.TotalMinutes >= 5)
            {
                // MISS2: Skip missed scans entirely
                Log.Warning("Skipping missed scan: {ScanId} (scheduled {Time})",
                    scan.Id, scan.ScheduledTime);
                scan.Executed = true; // Mark as executed (skipped)
            }
        }

        return null;
    }

    /// <summary>
    /// Check if current time is within operating hours
    /// </summary>
    private bool IsWithinOperatingHours()
    {
        if (_config == null) return false;

        var now = DateTime.Now.TimeOfDay;

        if (!TimeSpan.TryParse(_config.OperatingHoursStart, out var start) ||
            !TimeSpan.TryParse(_config.OperatingHoursEnd, out var end))
        {
            return true; // Default to running if can't parse
        }

        return now >= start && now <= end;
    }

    /// <summary>
    /// Load configuration from server
    /// </summary>
    /// <param name="restoreCounts">Whether to restore scan counts from server (on initial load)</param>
    private async Task LoadConfigAsync(bool restoreCounts = false)
    {
        if (_apiClient == null) return;

        var config = await _apiClient.GetConfigAsync();
        if (config != null)
        {
            _config = config;
            _currentConfigVersion = config.ConfigVersion;

            // Restore today's counts from server on startup
            if (restoreCounts)
            {
                _scansToday = config.ScansToday;
                _opportunitiesToday = config.OpportunitiesToday;
                Log.Information("Restored counts from server: {Scans} scans, {Opportunities} opportunities",
                    _scansToday, _opportunitiesToday);
            }
        }
    }

    /// <summary>
    /// Load schedule from server
    /// </summary>
    private async Task LoadScheduleAsync()
    {
        if (_apiClient == null) return;

        var schedule = await _apiClient.GetScheduleAsync();
        if (schedule != null)
        {
            _schedule = schedule;
            _currentScheduleVersion = schedule.ScheduleVersion;
            _configManager.CacheSchedule(schedule);
            Log.Information("Loaded schedule with {Count} scans", schedule.Scans.Count);
        }
    }

    /// <summary>
    /// Send heartbeat to server (THB2-THB3)
    /// </summary>
    private async Task SendHeartbeatAsync()
    {
        if (_apiClient == null)
        {
            Log.Warning("Cannot send heartbeat: API client is null");
            return;
        }

        var status = _isPaused ? "paused"
            : !IsWithinOperatingHours() ? "outside_hours"
            : _consecutiveFailures >= MaxConsecutiveFailures ? "error"
            : "running";

        var request = new HeartbeatRequest
        {
            MachineId = _configManager.MachineId,
            MachineName = _configManager.MachineName,
            Status = status,
            LastScanAt = _lastScanAt?.ToString("O"),
            ScansToday = _scansToday,
            OpportunitiesToday = _opportunitiesToday
        };

        Log.Debug("Sending heartbeat: status={Status}, scans={Scans}", status, _scansToday);
        var response = await _apiClient.SendHeartbeatAsync(request);

        // THB3: Check for version changes
        if (response != null)
        {
            Log.Debug("Heartbeat sent successfully");
            if (response.ConfigVersion != _currentConfigVersion)
            {
                await LoadConfigAsync();
            }
            if (response.ScheduleVersion != _currentScheduleVersion)
            {
                await LoadScheduleAsync();
            }
        }
        else
        {
            Log.Warning("Heartbeat failed: no response from server");
        }
    }

    /// <summary>
    /// Toggle pause state
    /// </summary>
    public async Task TogglePauseAsync()
    {
        _isPaused = !_isPaused;

        if (_isPaused)
        {
            _trayContext.SetState(TrayState.Paused, "Paused by user");
            Log.Information("Scanner paused by user");
        }
        else
        {
            _trayContext.SetState(TrayState.Running);
            Log.Information("Scanner resumed by user");
        }

        await SendHeartbeatAsync();
    }

    /// <summary>
    /// Refresh schedule from server
    /// </summary>
    public async Task RefreshScheduleAsync()
    {
        await LoadScheduleAsync();
        _trayContext.ShowBalloon("Schedule Refreshed",
            $"Loaded {_schedule?.Scans.Count ?? 0} scans for today.", ToolTipIcon.Info);
    }

    /// <summary>
    /// Restart the scheduler (after config change)
    /// </summary>
    public async Task RestartAsync()
    {
        Stop();
        await Task.Delay(1000);
        await StartAsync();
    }

    /// <summary>
    /// Stop the scheduler
    /// </summary>
    public void Stop()
    {
        _cts?.Cancel();
        Log.Information("Scheduler stopped");
    }

    public void Dispose()
    {
        _cts?.Cancel();
        _cts?.Dispose();
        _apiClient?.Dispose();
    }
}
