/**
 * API Models
 *
 * Response models for server API endpoints.
 */

using System.Text.Json.Serialization;

namespace HadleyBricksScanner.Models;

/// <summary>
/// Individual scheduled scan from the schedule API
/// </summary>
public class ScheduledScan
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("scheduledTime")]
    public string ScheduledTime { get; set; } = string.Empty;

    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("setNumber")]
    public string? SetNumber { get; set; }

    [JsonPropertyName("setName")]
    public string? SetName { get; set; }

    // Local state - not from API
    [JsonIgnore]
    public bool Executed { get; set; }
}

/// <summary>
/// Response from GET /automation/schedule
/// </summary>
public class ScheduleResponse
{
    [JsonPropertyName("date")]
    public string Date { get; set; } = string.Empty;

    [JsonPropertyName("generatedAt")]
    public string GeneratedAt { get; set; } = string.Empty;

    [JsonPropertyName("scheduleVersion")]
    public int ScheduleVersion { get; set; }

    [JsonPropertyName("operatingHours")]
    public OperatingHours OperatingHours { get; set; } = new();

    [JsonPropertyName("scans")]
    public List<ScheduledScan> Scans { get; set; } = [];
}

public class OperatingHours
{
    [JsonPropertyName("start")]
    public string Start { get; set; } = "08:00";

    [JsonPropertyName("end")]
    public string End { get; set; } = "22:00";
}

/// <summary>
/// Response from GET /automation/config
/// </summary>
public class ConfigResponse
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    [JsonPropertyName("paused")]
    public bool Paused { get; set; }

    [JsonPropertyName("pauseReason")]
    public string? PauseReason { get; set; }

    [JsonPropertyName("broadSweepCogThreshold")]
    public int BroadSweepCogThreshold { get; set; }

    [JsonPropertyName("watchlistCogThreshold")]
    public int WatchlistCogThreshold { get; set; }

    [JsonPropertyName("nearMissThreshold")]
    public int NearMissThreshold { get; set; }

    [JsonPropertyName("operatingHoursStart")]
    public string OperatingHoursStart { get; set; } = "08:00";

    [JsonPropertyName("operatingHoursEnd")]
    public string OperatingHoursEnd { get; set; } = "22:00";

    [JsonPropertyName("configVersion")]
    public int ConfigVersion { get; set; }

    [JsonPropertyName("scheduleVersion")]
    public int ScheduleVersion { get; set; }

    // Today's counts (for restoring state on restart)
    [JsonPropertyName("scansToday")]
    public int ScansToday { get; set; }

    [JsonPropertyName("opportunitiesToday")]
    public int OpportunitiesToday { get; set; }
}

/// <summary>
/// Request body for POST /automation/heartbeat
/// </summary>
public class HeartbeatRequest
{
    [JsonPropertyName("machineId")]
    public string MachineId { get; set; } = string.Empty;

    [JsonPropertyName("machineName")]
    public string? MachineName { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = "running";

    [JsonPropertyName("lastScanAt")]
    public string? LastScanAt { get; set; }

    [JsonPropertyName("scansToday")]
    public int ScansToday { get; set; }

    [JsonPropertyName("opportunitiesToday")]
    public int OpportunitiesToday { get; set; }

    [JsonPropertyName("errorMessage")]
    public string? ErrorMessage { get; set; }
}

/// <summary>
/// Response from POST /automation/heartbeat
/// </summary>
public class HeartbeatResponse
{
    [JsonPropertyName("configVersion")]
    public int ConfigVersion { get; set; }

    [JsonPropertyName("scheduleVersion")]
    public int ScheduleVersion { get; set; }

    [JsonPropertyName("serverTime")]
    public string ServerTime { get; set; } = string.Empty;
}
