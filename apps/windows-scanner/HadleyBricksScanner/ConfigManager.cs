/**
 * Configuration Manager
 *
 * AUTH3: API key stored securely using Windows Data Protection API (DPAPI)
 * TERR4: Cached schedule fallback on API failure
 */

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using HadleyBricksScanner.Models;
using Serilog;

namespace HadleyBricksScanner;

/// <summary>
/// Manages local configuration and secure credential storage
/// </summary>
public class ConfigManager
{
    private readonly string _configDirectory;
    private readonly string _settingsPath;
    private readonly string _scheduleCachePath;
    private readonly string _apiKeyPath;

    public string BaseUrl { get; private set; } = "https://hadley-bricks.vercel.app";
    public string MachineId { get; }
    public string MachineName { get; }

    public ConfigManager()
    {
        _configDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HadleyBricks", "Scanner"
        );

        Directory.CreateDirectory(_configDirectory);

        _settingsPath = Path.Combine(_configDirectory, "settings.json");
        _scheduleCachePath = Path.Combine(_configDirectory, "schedule-cache.json");
        _apiKeyPath = Path.Combine(_configDirectory, "apikey.dat");

        // Generate stable machine ID
        MachineId = GetMachineId();
        MachineName = Environment.MachineName;

        LoadSettings();
    }

    /// <summary>
    /// Load API key from secure storage (AUTH3: DPAPI encrypted)
    /// </summary>
    public string? GetApiKey()
    {
        try
        {
            if (!File.Exists(_apiKeyPath))
            {
                Log.Warning("API key file not found");
                return null;
            }

            // AUTH3: Read DPAPI encrypted data
            var encryptedBytes = File.ReadAllBytes(_apiKeyPath);
            var decryptedBytes = ProtectedData.Unprotect(
                encryptedBytes,
                null,
                DataProtectionScope.CurrentUser
            );

            return Encoding.UTF8.GetString(decryptedBytes);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to load API key");
            return null;
        }
    }

    /// <summary>
    /// Save API key to secure storage (AUTH3: DPAPI encrypted)
    /// </summary>
    public void SetApiKey(string apiKey)
    {
        try
        {
            var plainBytes = Encoding.UTF8.GetBytes(apiKey);

            // AUTH3: Encrypt using DPAPI (ProtectedData)
            var encryptedBytes = ProtectedData.Protect(
                plainBytes,
                null,
                DataProtectionScope.CurrentUser
            );

            File.WriteAllBytes(_apiKeyPath, encryptedBytes);
            Log.Information("API key saved securely");
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save API key");
            throw;
        }
    }

    /// <summary>
    /// Load cached schedule (TERR4: fallback on API failure)
    /// </summary>
    public ScheduleResponse? GetCachedSchedule()
    {
        try
        {
            if (!File.Exists(_scheduleCachePath))
            {
                return null;
            }

            var json = File.ReadAllText(_scheduleCachePath);
            var schedule = JsonSerializer.Deserialize<ScheduleResponse>(json);

            // Only return if it's for today
            if (schedule?.Date == DateTime.Today.ToString("yyyy-MM-dd"))
            {
                Log.Information("Loaded cached schedule for today");
                return schedule;
            }

            Log.Debug("Cached schedule is for a different day, ignoring");
            return null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load cached schedule");
            return null;
        }
    }

    /// <summary>
    /// Save schedule to cache (TERR4: for fallback)
    /// </summary>
    public void CacheSchedule(ScheduleResponse schedule)
    {
        try
        {
            var json = JsonSerializer.Serialize(schedule);
            File.WriteAllText(_scheduleCachePath, json);
            Log.Debug("Schedule cached successfully");
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to cache schedule");
        }
    }

    /// <summary>
    /// Generate a stable machine ID based on hardware
    /// </summary>
    private static string GetMachineId()
    {
        try
        {
            // Use machine name + user as a simple stable ID
            var source = $"{Environment.MachineName}:{Environment.UserName}";
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(source));
            return Convert.ToHexString(hash)[..16].ToLowerInvariant();
        }
        catch
        {
            return Guid.NewGuid().ToString("N")[..16];
        }
    }

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(_settingsPath))
            {
                var json = File.ReadAllText(_settingsPath);
                var settings = JsonSerializer.Deserialize<LocalSettings>(json);

                if (settings != null)
                {
                    BaseUrl = settings.BaseUrl ?? BaseUrl;
                }
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load settings, using defaults");
        }
    }

    public void SaveSettings(string? baseUrl = null)
    {
        try
        {
            if (baseUrl != null) BaseUrl = baseUrl;

            var settings = new LocalSettings
            {
                BaseUrl = BaseUrl
            };

            var json = JsonSerializer.Serialize(settings);
            File.WriteAllText(_settingsPath, json);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save settings");
        }
    }

    private class LocalSettings
    {
        public string? BaseUrl { get; set; }
    }
}
