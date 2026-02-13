/**
 * API Client
 *
 * AUTH2: Windows app sends API key in X-Api-Key header
 * AUTH3: API key stored securely (via ConfigManager with DPAPI)
 */

using System.Net.Http.Json;
using System.Text.Json;
using HadleyBricksScanner.Models;
using Serilog;

namespace HadleyBricksScanner;

/// <summary>
/// HTTP client for server API communication
/// </summary>
public class ApiClient : IDisposable
{
    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;
    private bool _disposed;

    public ApiClient(string baseUrl, string apiKey)
    {
        _baseUrl = baseUrl.TrimEnd('/');

        _httpClient = new HttpClient();

        // AUTH2: Include X-Api-Key header in all requests
        _httpClient.DefaultRequestHeaders.Add("X-Api-Key", apiKey);
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "HadleyBricksScanner/1.0");
    }

    /// <summary>
    /// Fetch today's schedule from the server
    /// </summary>
    public async Task<ScheduleResponse?> GetScheduleAsync(bool remainingOnly = false)
    {
        try
        {
            var url = $"{_baseUrl}/api/arbitrage/vinted/automation/schedule";
            if (remainingOnly)
            {
                url += "?remaining=true";
            }

            var response = await _httpClient.GetAsync(url);

            if (!response.IsSuccessStatusCode)
            {
                Log.Error("Failed to fetch schedule: {StatusCode}", response.StatusCode);
                return null;
            }

            return await response.Content.ReadFromJsonAsync<ScheduleResponse>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching schedule");
            return null;
        }
    }

    /// <summary>
    /// Fetch current configuration from the server
    /// </summary>
    public async Task<ConfigResponse?> GetConfigAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_baseUrl}/api/arbitrage/vinted/automation/config");

            if (!response.IsSuccessStatusCode)
            {
                // AUTH4: Invalid API key returns 401
                if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    Log.Error("API key is invalid or expired (401 Unauthorized)");
                }
                else
                {
                    Log.Error("Failed to fetch config: {StatusCode}", response.StatusCode);
                }
                return null;
            }

            return await response.Content.ReadFromJsonAsync<ConfigResponse>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching config");
            return null;
        }
    }

    /// <summary>
    /// Send heartbeat to the server
    /// </summary>
    public async Task<HeartbeatResponse?> SendHeartbeatAsync(HeartbeatRequest request)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync(
                $"{_baseUrl}/api/arbitrage/vinted/automation/heartbeat",
                request
            );

            if (!response.IsSuccessStatusCode)
            {
                Log.Error("Failed to send heartbeat: {StatusCode}", response.StatusCode);
                return null;
            }

            return await response.Content.ReadFromJsonAsync<HeartbeatResponse>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error sending heartbeat");
            return null;
        }
    }

    /// <summary>
    /// Submit scan results to the server for processing
    /// </summary>
    public async Task<bool> ProcessScanResultAsync(ProcessRequest request)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync(
                $"{_baseUrl}/api/arbitrage/vinted/automation/process",
                request
            );

            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync();
                Log.Error("Failed to process scan result: {StatusCode} - {Error}",
                    response.StatusCode, error);
                return false;
            }

            Log.Debug("Scan result processed successfully");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error processing scan result");
            return false;
        }
    }

    /// <summary>
    /// Fetch pending seller messages from the server
    /// </summary>
    public async Task<PendingMessagesResponse?> GetPendingMessagesAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync(
                $"{_baseUrl}/api/arbitrage/vinted/automation/messages/pending"
            );

            if (!response.IsSuccessStatusCode)
            {
                Log.Error("Failed to fetch pending messages: {StatusCode}", response.StatusCode);
                return null;
            }

            return await response.Content.ReadFromJsonAsync<PendingMessagesResponse>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error fetching pending messages");
            return null;
        }
    }

    /// <summary>
    /// Report the result of a seller message send attempt
    /// </summary>
    public async Task<bool> ReportMessageResultAsync(MessageResultRequest request)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync(
                $"{_baseUrl}/api/arbitrage/vinted/automation/messages/result",
                request
            );

            if (!response.IsSuccessStatusCode)
            {
                var error = await response.Content.ReadAsStringAsync();
                Log.Error("Failed to report message result: {StatusCode} - {Error}",
                    response.StatusCode, error);
                return false;
            }

            Log.Debug("Message result reported successfully");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Error reporting message result");
            return false;
        }
    }

    public void Dispose()
    {
        if (!_disposed)
        {
            _httpClient.Dispose();
            _disposed = true;
        }
    }
}
