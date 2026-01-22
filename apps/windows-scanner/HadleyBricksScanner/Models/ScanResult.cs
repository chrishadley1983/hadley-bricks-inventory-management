/**
 * Scan Result Models
 *
 * CLI5: ScanResult schema with success, captchaDetected, listings[], pagesScanned, error, timingDelayMs
 * CLI6: Listing includes title, price, currency, url, vintedListingId, listedAt
 */

using System.Text.Json.Serialization;

namespace HadleyBricksScanner.Models;

/// <summary>
/// Individual listing found during a scan (CLI6)
/// </summary>
public class Listing
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("price")]
    public decimal Price { get; set; }

    [JsonPropertyName("currency")]
    public string Currency { get; set; } = "GBP";

    [JsonPropertyName("url")]
    public string Url { get; set; } = string.Empty;

    [JsonPropertyName("vintedListingId")]
    public string VintedListingId { get; set; } = string.Empty;

    [JsonPropertyName("listedAt")]
    public string? ListedAt { get; set; }
}

/// <summary>
/// Result of a Claude CLI scan execution (CLI5)
/// </summary>
public class ScanResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("captchaDetected")]
    public bool CaptchaDetected { get; set; }

    [JsonPropertyName("listings")]
    public List<Listing> Listings { get; set; } = [];

    [JsonPropertyName("pagesScanned")]
    public int PagesScanned { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("timingDelayMs")]
    public int? TimingDelayMs { get; set; }
}

/// <summary>
/// Request body for POST /automation/process (PROC1-PROC4)
/// </summary>
public class ProcessRequest
{
    [JsonPropertyName("scanId")]
    public string ScanId { get; set; } = string.Empty;

    [JsonPropertyName("scanType")]
    public string ScanType { get; set; } = string.Empty;

    [JsonPropertyName("setNumber")]
    public string? SetNumber { get; set; }

    [JsonPropertyName("result")]
    public ScanResult Result { get; set; } = new();
}
