/**
 * Seller Messaging Models
 *
 * Models for the Vinted seller messaging automation.
 * Messages are queued by the email-purchases cron and processed by the scanner.
 */

using System.Text.Json.Serialization;

namespace HadleyBricksScanner.Models;

/// <summary>
/// A pending seller message from GET /automation/messages/pending
/// </summary>
public class PendingMessage
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("seller_username")]
    public string SellerUsername { get; set; } = string.Empty;

    [JsonPropertyName("message_text")]
    public string MessageText { get; set; } = string.Empty;

    [JsonPropertyName("order_reference")]
    public string OrderReference { get; set; } = string.Empty;

    [JsonPropertyName("attempts")]
    public int Attempts { get; set; }
}

/// <summary>
/// Response from GET /automation/messages/pending
/// </summary>
public class PendingMessagesResponse
{
    [JsonPropertyName("messages")]
    public List<PendingMessage> Messages { get; set; } = [];
}

/// <summary>
/// Request body for POST /automation/messages/result
/// </summary>
public class MessageResultRequest
{
    [JsonPropertyName("message_id")]
    public string MessageId { get; set; } = string.Empty;

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("captcha_detected")]
    public bool CaptchaDetected { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>
/// Result of a Claude CLI message send execution
/// </summary>
public class MessageSendResult
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("captchaDetected")]
    public bool CaptchaDetected { get; set; }

    [JsonPropertyName("messageSent")]
    public bool MessageSent { get; set; }

    [JsonPropertyName("sellerUsername")]
    public string? SellerUsername { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}
