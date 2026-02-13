/**
 * Claude CLI Executor
 *
 * CLI7: Invokes Claude with --chrome --print --output-format json
 * CLI8: Passes prompt via stdin or --prompt-file
 * CLI9: Selects prompt by scan type
 * CLI10: Injects SetNumber into watchlist prompt
 * CLI11: Captures stdout as JSON
 * CLI12: Handles parse errors
 * CLI13: Enforces 90-second timeout
 * CLI14: Detects CAPTCHA in result
 */

using System.Diagnostics;
using System.Text.Json;
using HadleyBricksScanner.Models;
using Serilog;

namespace HadleyBricksScanner;

/// <summary>
/// Executes Claude CLI for Vinted scans
/// </summary>
public class ClaudeExecutor
{
    private readonly string _promptsDirectory;
    private readonly string _claudePath;
    private const int TimeoutSeconds = 300; // CLI13: 300 second timeout (5 mins for broad sweep extraction)

    public ClaudeExecutor()
    {
        // CLI1: Prompt files located in Windows app prompts directory
        _promptsDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "prompts");

        // Find Claude CLI - check common locations
        _claudePath = FindClaudeCli();
        Log.Information("Using Claude CLI at: {ClaudePath}", _claudePath);
    }

    /// <summary>
    /// Find the Claude CLI executable
    /// </summary>
    private static string FindClaudeCli()
    {
        // Check common locations for Claude CLI
        var possiblePaths = new[]
        {
            // npm global on Windows (typical location)
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "claude.cmd"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm", "claude"),
            // Local user npm
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "npm", "claude.cmd"),
            // Just try 'claude' and hope it's in PATH
            "claude"
        };

        foreach (var path in possiblePaths)
        {
            if (path == "claude")
            {
                // For bare 'claude', check if it exists in PATH
                var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
                var pathDirs = pathEnv.Split(Path.PathSeparator);
                foreach (var dir in pathDirs)
                {
                    var fullPath = Path.Combine(dir, "claude.cmd");
                    if (File.Exists(fullPath)) return fullPath;
                    fullPath = Path.Combine(dir, "claude.exe");
                    if (File.Exists(fullPath)) return fullPath;
                    fullPath = Path.Combine(dir, "claude");
                    if (File.Exists(fullPath)) return fullPath;
                }
            }
            else if (File.Exists(path))
            {
                return path;
            }
        }

        // Default to 'claude' and let it fail with a clear error if not found
        return "claude";
    }

    /// <summary>
    /// Execute a scan using Claude CLI
    /// </summary>
    public async Task<ScanResult> ExecuteScanAsync(ScheduledScan scan, CancellationToken cancellationToken)
    {
        var startTime = DateTime.UtcNow;
        Log.Information("Starting {ScanType} scan: {ScanId}", scan.Type, scan.Id);

        try
        {
            // CLI9: Select prompt by scan type
            var promptContent = await LoadPromptAsync(scan);

            // CLI7: Invoke Claude with correct flags (--chrome --print --output-format json)
            var result = await InvokeClaudeAsync(promptContent, cancellationToken);

            var elapsed = (int)(DateTime.UtcNow - startTime).TotalMilliseconds;
            result.TimingDelayMs = elapsed;

            // CLI14: Detect CAPTCHA in result
            if (result.CaptchaDetected)
            {
                Log.Warning("CAPTCHA detected during scan {ScanId}", scan.Id);
            }

            Log.Information(
                "Scan {ScanId} completed: {ListingCount} listings, CAPTCHA: {CaptchaDetected}",
                scan.Id, result.Listings.Count, result.CaptchaDetected
            );

            return result;
        }
        catch (TimeoutException)
        {
            Log.Error("Scan {ScanId} timed out after {Timeout}s", scan.Id, TimeoutSeconds);
            return new ScanResult
            {
                Success = false,
                Error = $"Scan timed out after {TimeoutSeconds} seconds",
                TimingDelayMs = TimeoutSeconds * 1000
            };
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Scan {ScanId} failed", scan.Id);
            return new ScanResult
            {
                Success = false,
                Error = ex.Message,
                TimingDelayMs = (int)(DateTime.UtcNow - startTime).TotalMilliseconds
            };
        }
    }

    /// <summary>
    /// Load and prepare the prompt for a scan (CLI9, CLI10)
    /// </summary>
    private async Task<string> LoadPromptAsync(ScheduledScan scan)
    {
        // CLI9: Select prompt by scan type
        var promptFileName = scan.Type == "broad_sweep"
            ? "broad-sweep.md"
            : "watchlist.md";

        var promptPath = Path.Combine(_promptsDirectory, promptFileName);

        if (!File.Exists(promptPath))
        {
            throw new FileNotFoundException($"Prompt file not found: {promptPath}");
        }

        var promptContent = await File.ReadAllTextAsync(promptPath);

        // CLI10: Inject SetNumber into watchlist prompt
        if (scan.Type == "watchlist" && !string.IsNullOrEmpty(scan.SetNumber))
        {
            promptContent = promptContent.Replace("{SET_NUMBER}", scan.SetNumber);
        }

        return promptContent;
    }

    /// <summary>
    /// Invoke Claude CLI and capture output (CLI7, CLI8, CLI11, CLI13)
    /// </summary>
    private async Task<ScanResult> InvokeClaudeAsync(string promptContent, CancellationToken cancellationToken)
    {
        var invokeStart = DateTime.UtcNow;
        Log.Debug("Starting Claude CLI invocation");

        // CLI7: Claude invoked with --chrome --print --output-format json
        // Using stdin for prompt (matches working test app pattern)
        var startInfo = new ProcessStartInfo
        {
            FileName = _claudePath,
            Arguments = "--chrome --print --output-format json --dangerously-skip-permissions",
            UseShellExecute = false,
            RedirectStandardInput = true,  // Use stdin for prompt
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = startInfo };

        // Collect output in real-time
        var stdoutBuilder = new System.Text.StringBuilder();
        var stderrBuilder = new System.Text.StringBuilder();
        var lastStdoutLength = 0;
        var lastStderrLength = 0;

        // Set up async output handlers
        process.OutputDataReceived += (sender, e) =>
        {
            if (e.Data != null)
            {
                stdoutBuilder.AppendLine(e.Data);
                Log.Debug("[stdout] {Line}", e.Data.Length > 100 ? e.Data[..100] + "..." : e.Data);
            }
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data != null)
            {
                stderrBuilder.AppendLine(e.Data);
                Log.Debug("[stderr] {Line}", e.Data.Length > 100 ? e.Data[..100] + "..." : e.Data);
            }
        };

        try
        {
            Log.Debug("Starting process: {FileName} {Args}", startInfo.FileName, startInfo.Arguments);
            process.Start();
            var processStarted = DateTime.UtcNow;
            Log.Information("Claude process started (PID: {Pid}) after {Ms}ms",
                process.Id, (processStarted - invokeStart).TotalMilliseconds);

            // Begin async reading
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            // Write prompt via stdin (matches working test app pattern)
            Log.Debug("Writing prompt to stdin ({Length} chars)", promptContent.Length);
            await process.StandardInput.WriteLineAsync(promptContent);
            process.StandardInput.Close();
            Log.Debug("Stdin written and closed");

            // CLI13: Enforce timeout with NON-BLOCKING waits
            // CRITICAL: Using Task.Delay instead of WaitForExit() because blocking waits
            // prevent the OutputDataReceived/ErrorDataReceived events from firing in WinForms
            var waitStart = DateTime.UtcNow;

            while (!process.HasExited)
            {
                // Non-blocking wait - allows async output handlers to fire
                await Task.Delay(2000, cancellationToken);

                if (process.HasExited)
                    break;

                var elapsed = (DateTime.UtcNow - waitStart).TotalSeconds;

                // Log progress with current output lengths
                var currentStdoutLen = stdoutBuilder.Length;
                var currentStderrLen = stderrBuilder.Length;
                var stdoutDelta = currentStdoutLen - lastStdoutLength;
                var stderrDelta = currentStderrLen - lastStderrLength;

                // Only log every 10 seconds to reduce noise
                if ((int)elapsed % 10 < 2)
                {
                    Log.Information("Claude running... {Elapsed:F0}s | stdout: {StdoutLen} (+{StdoutDelta}) | stderr: {StderrLen} (+{StderrDelta})",
                        elapsed, currentStdoutLen, stdoutDelta, currentStderrLen, stderrDelta);
                }

                lastStdoutLength = currentStdoutLen;
                lastStderrLength = currentStderrLen;

                if (elapsed >= TimeoutSeconds)
                {
                    Log.Warning("Timeout reached after {Elapsed:F0}s, killing process", elapsed);
                    Log.Warning("Final stdout ({Len} chars): {Content}",
                        stdoutBuilder.Length,
                        stdoutBuilder.Length > 500 ? stdoutBuilder.ToString()[..500] + "..." : stdoutBuilder.ToString());
                    Log.Warning("Final stderr ({Len} chars): {Content}",
                        stderrBuilder.Length,
                        stderrBuilder.Length > 500 ? stderrBuilder.ToString()[..500] + "..." : stderrBuilder.ToString());

                    try { process.Kill(entireProcessTree: true); } catch { }
                    throw new TimeoutException($"Claude process did not complete within {TimeoutSeconds} seconds");
                }
            }

            // Final wait to ensure async readers complete
            await Task.Delay(500, CancellationToken.None);

            var processExited = DateTime.UtcNow;
            Log.Information("Claude process exited with code {ExitCode} after {Ms}ms total",
                process.ExitCode, (processExited - invokeStart).TotalMilliseconds);

            var stdout = stdoutBuilder.ToString();
            var stderr = stderrBuilder.ToString();

            Log.Debug("Final stdout length: {StdoutLen}, stderr length: {StderrLen}",
                stdout.Length, stderr.Length);

            if (!string.IsNullOrEmpty(stderr))
            {
                Log.Information("Claude stderr: {StdErr}", stderr.Length > 1000 ? stderr[..1000] + "..." : stderr);
            }

            if (!string.IsNullOrEmpty(stdout))
            {
                Log.Debug("Claude stdout: {StdOut}", stdout.Length > 500 ? stdout[..500] + "..." : stdout);
            }

            // CLI11: Deserialize stdout as ScanResult JSON
            return ParseOutput(stdout);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            Log.Warning("Claude invocation cancelled by user");
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }

    /// <summary>
    /// Parse Claude output as ScanResult JSON (CLI11, CLI12)
    /// Claude CLI returns JSON with --output-format json: {"type":"result","result":"..."}
    /// We need to extract the "result" field and parse it as ScanResult JSON
    /// </summary>
    private ScanResult ParseOutput(string output)
    {
        if (string.IsNullOrWhiteSpace(output))
        {
            Log.Warning("Claude output was empty");
            return new ScanResult
            {
                Success = false,
                Error = "Claude output was empty"
            };
        }

        Log.Information("Parsing Claude output ({Length} chars)", output.Length);

        try
        {
            // Claude CLI wraps output in: {"type":"result","result":"<claude's response>"}
            using var doc = JsonDocument.Parse(output);
            var root = doc.RootElement;

            // Check if this is a Claude CLI wrapper
            if (root.TryGetProperty("type", out var typeElement) && typeElement.GetString() == "result")
            {
                Log.Debug("Detected Claude CLI wrapper format");

                // Check for errors
                if (root.TryGetProperty("is_error", out var isError) && isError.GetBoolean())
                {
                    var errorMsg = root.TryGetProperty("result", out var errResult)
                        ? errResult.GetString() ?? "Unknown error"
                        : "Unknown error";
                    Log.Warning("Claude returned error: {Error}", errorMsg);
                    return new ScanResult
                    {
                        Success = false,
                        Error = errorMsg
                    };
                }

                // Extract the result field
                if (root.TryGetProperty("result", out var resultElement))
                {
                    var resultText = resultElement.GetString();
                    Log.Information("Claude result text ({Length} chars): {Preview}",
                        resultText?.Length ?? 0,
                        resultText?.Length > 500 ? resultText[..500] + "..." : resultText ?? "(null)");

                    if (!string.IsNullOrEmpty(resultText))
                    {
                        // Try to find JSON in the result text
                        var scanResult = ExtractScanResultFromText(resultText);
                        if (scanResult != null)
                        {
                            return scanResult;
                        }

                        // If no JSON found, Claude returned text instead of structured data
                        Log.Warning("Could not extract JSON from Claude's response");
                        return new ScanResult
                        {
                            Success = false,
                            Error = "Claude returned text instead of JSON format"
                        };
                    }
                }
            }

            // Try direct deserialization as ScanResult (fallback)
            Log.Debug("Attempting direct ScanResult deserialization");
            var result = JsonSerializer.Deserialize<ScanResult>(output);
            if (result != null)
            {
                Log.Information("Direct deserialization succeeded: success={Success}, listings={Count}",
                    result.Success, result.Listings.Count);
            }
            return result ?? new ScanResult { Success = false, Error = "Failed to deserialize" };
        }
        catch (JsonException ex)
        {
            // CLI12: Handle parse errors - log and mark scan as failed
            Log.Error(ex, "Failed to parse Claude output as JSON: {Output}", output[..Math.Min(500, output.Length)]);
            return new ScanResult
            {
                Success = false,
                Error = $"Invalid JSON output: {ex.Message}"
            };
        }
    }

    /// <summary>
    /// Try to extract ScanResult JSON from Claude's text response
    /// Claude sometimes wraps JSON in markdown code blocks or includes text before/after
    /// </summary>
    private ScanResult? ExtractScanResultFromText(string text)
    {
        Log.Debug("Attempting to extract JSON from text ({Length} chars)", text.Length);

        // Strategy 1: Look for JSON in markdown code blocks
        var codeBlockPatterns = new[]
        {
            @"```json\s*([\s\S]*?)\s*```",
            @"```\s*([\s\S]*?)\s*```"
        };

        foreach (var pattern in codeBlockPatterns)
        {
            var match = System.Text.RegularExpressions.Regex.Match(text, pattern);
            if (match.Success)
            {
                var jsonCandidate = match.Groups[1].Value.Trim();
                Log.Debug("Found code block, attempting parse ({Length} chars)", jsonCandidate.Length);
                var result = TryParseAsResult(jsonCandidate);
                if (result != null) return result;
            }
        }

        // Strategy 2: Find the first { that could start a JSON object with "success"
        var startIndex = text.IndexOf('{');
        while (startIndex >= 0)
        {
            // Try to find matching closing brace by counting braces
            var braceCount = 0;
            var endIndex = -1;

            for (var i = startIndex; i < text.Length; i++)
            {
                if (text[i] == '{') braceCount++;
                else if (text[i] == '}')
                {
                    braceCount--;
                    if (braceCount == 0)
                    {
                        endIndex = i;
                        break;
                    }
                }
            }

            if (endIndex > startIndex)
            {
                var jsonCandidate = text.Substring(startIndex, endIndex - startIndex + 1);
                if (jsonCandidate.Contains("\"success\""))
                {
                    Log.Debug("Found potential JSON object with 'success' ({Length} chars)", jsonCandidate.Length);
                    var result = TryParseAsResult(jsonCandidate);
                    if (result != null) return result;
                }
            }

            // Look for next potential JSON start
            startIndex = text.IndexOf('{', startIndex + 1);
        }

        Log.Warning("Could not extract ScanResult JSON from text");
        return null;
    }

    /// <summary>
    /// Try to parse a string as ScanResult JSON
    /// </summary>
    private ScanResult? TryParseAsResult(string json)
    {
        try
        {
            var result = JsonSerializer.Deserialize<ScanResult>(json);
            if (result != null)
            {
                Log.Information("Successfully parsed ScanResult: success={Success}, listings={Count}",
                    result.Success, result.Listings.Count);
                return result;
            }
        }
        catch (JsonException ex)
        {
            Log.Debug("JSON parse failed: {Error}", ex.Message);
        }
        return null;
    }

    /// <summary>
    /// Execute a seller message send using Claude CLI
    /// </summary>
    public async Task<MessageSendResult> SendSellerMessageAsync(PendingMessage message, CancellationToken cancellationToken)
    {
        var startTime = DateTime.UtcNow;
        Log.Information("Sending message to seller: {Seller} (order: {Order})",
            message.SellerUsername, message.OrderReference);

        try
        {
            // Load and prepare prompt
            var promptPath = Path.Combine(_promptsDirectory, "send-seller-message.md");
            if (!File.Exists(promptPath))
            {
                throw new FileNotFoundException($"Prompt file not found: {promptPath}");
            }

            var promptContent = await File.ReadAllTextAsync(promptPath);
            promptContent = promptContent
                .Replace("{SELLER_USERNAME}", message.SellerUsername)
                .Replace("{MESSAGE_TEXT}", message.MessageText);

            // Invoke Claude CLI and parse as MessageSendResult
            var result = await InvokeClaudeForMessageAsync(promptContent, cancellationToken);

            Log.Information("Message send result for {Seller}: success={Success}, sent={Sent}",
                message.SellerUsername, result.Success, result.MessageSent);

            return result;
        }
        catch (TimeoutException)
        {
            Log.Error("Message send to {Seller} timed out", message.SellerUsername);
            return new MessageSendResult
            {
                Success = false,
                CaptchaDetected = false,
                MessageSent = false,
                SellerUsername = message.SellerUsername,
                Error = $"Timed out after {TimeoutSeconds} seconds"
            };
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Message send to {Seller} failed", message.SellerUsername);
            return new MessageSendResult
            {
                Success = false,
                CaptchaDetected = false,
                MessageSent = false,
                SellerUsername = message.SellerUsername,
                Error = ex.Message
            };
        }
    }

    /// <summary>
    /// Invoke Claude CLI and parse output as MessageSendResult
    /// </summary>
    private async Task<MessageSendResult> InvokeClaudeForMessageAsync(string promptContent, CancellationToken cancellationToken)
    {
        var invokeStart = DateTime.UtcNow;

        var startInfo = new ProcessStartInfo
        {
            FileName = _claudePath,
            Arguments = "--chrome --print --output-format json --dangerously-skip-permissions",
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = startInfo };

        var stdoutBuilder = new System.Text.StringBuilder();
        var stderrBuilder = new System.Text.StringBuilder();

        process.OutputDataReceived += (sender, e) =>
        {
            if (e.Data != null) stdoutBuilder.AppendLine(e.Data);
        };

        process.ErrorDataReceived += (sender, e) =>
        {
            if (e.Data != null) stderrBuilder.AppendLine(e.Data);
        };

        try
        {
            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            await process.StandardInput.WriteLineAsync(promptContent);
            process.StandardInput.Close();

            var waitStart = DateTime.UtcNow;
            while (!process.HasExited)
            {
                await Task.Delay(2000, cancellationToken);
                if (process.HasExited) break;

                var elapsed = (DateTime.UtcNow - waitStart).TotalSeconds;
                if (elapsed >= TimeoutSeconds)
                {
                    try { process.Kill(entireProcessTree: true); } catch { }
                    throw new TimeoutException();
                }
            }

            await Task.Delay(500, CancellationToken.None);

            var stdout = stdoutBuilder.ToString();
            return ParseMessageOutput(stdout);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }

    /// <summary>
    /// Parse Claude output as MessageSendResult JSON
    /// </summary>
    private MessageSendResult ParseMessageOutput(string output)
    {
        if (string.IsNullOrWhiteSpace(output))
        {
            return new MessageSendResult { Success = false, Error = "Claude output was empty" };
        }

        try
        {
            using var doc = JsonDocument.Parse(output);
            var root = doc.RootElement;

            // Check for Claude CLI wrapper format
            if (root.TryGetProperty("type", out var typeElement) && typeElement.GetString() == "result")
            {
                if (root.TryGetProperty("is_error", out var isError) && isError.GetBoolean())
                {
                    var errorMsg = root.TryGetProperty("result", out var errResult)
                        ? errResult.GetString() ?? "Unknown error" : "Unknown error";
                    return new MessageSendResult { Success = false, Error = errorMsg };
                }

                if (root.TryGetProperty("result", out var resultElement))
                {
                    var resultText = resultElement.GetString();
                    if (!string.IsNullOrEmpty(resultText))
                    {
                        return ExtractMessageResultFromText(resultText);
                    }
                }
            }

            // Try direct deserialization
            var result = JsonSerializer.Deserialize<MessageSendResult>(output);
            return result ?? new MessageSendResult { Success = false, Error = "Failed to deserialize" };
        }
        catch (JsonException ex)
        {
            Log.Error(ex, "Failed to parse message output");
            return new MessageSendResult { Success = false, Error = $"Invalid JSON: {ex.Message}" };
        }
    }

    /// <summary>
    /// Extract MessageSendResult from Claude's text response
    /// </summary>
    private MessageSendResult ExtractMessageResultFromText(string text)
    {
        // Strategy 1: JSON in code blocks
        var codeBlockPatterns = new[]
        {
            @"```json\s*([\s\S]*?)\s*```",
            @"```\s*([\s\S]*?)\s*```"
        };

        foreach (var pattern in codeBlockPatterns)
        {
            var match = System.Text.RegularExpressions.Regex.Match(text, pattern);
            if (match.Success)
            {
                var json = match.Groups[1].Value.Trim();
                var result = TryParseAsMessageResult(json);
                if (result != null) return result;
            }
        }

        // Strategy 2: Find JSON object with "messageSent" or "success"
        var startIndex = text.IndexOf('{');
        while (startIndex >= 0)
        {
            var braceCount = 0;
            var endIndex = -1;

            for (var i = startIndex; i < text.Length; i++)
            {
                if (text[i] == '{') braceCount++;
                else if (text[i] == '}')
                {
                    braceCount--;
                    if (braceCount == 0) { endIndex = i; break; }
                }
            }

            if (endIndex > startIndex)
            {
                var json = text.Substring(startIndex, endIndex - startIndex + 1);
                if (json.Contains("\"messageSent\"") || json.Contains("\"success\""))
                {
                    var result = TryParseAsMessageResult(json);
                    if (result != null) return result;
                }
            }

            startIndex = text.IndexOf('{', startIndex + 1);
        }

        return new MessageSendResult { Success = false, Error = "Could not extract result from Claude response" };
    }

    private MessageSendResult? TryParseAsMessageResult(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<MessageSendResult>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Wait for process exit with cancellation support
    /// </summary>
    private static async Task<bool> WaitForExitAsync(Process process, CancellationToken cancellationToken)
    {
        try
        {
            await process.WaitForExitAsync(cancellationToken);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }
}
