using System.Diagnostics;

namespace TestClaudeLaunch;

/// <summary>
/// Test Claude CLI launch from a background thread (like Windows Forms would)
/// </summary>
public static class WinFormsTest
{
    public static async Task RunAsync()
    {
        Console.WriteLine("=== WinForms-like Test (Background Thread) ===");
        Console.WriteLine($"Thread ID: {Environment.CurrentManagedThreadId}");
        Console.WriteLine();

        var claudePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "npm", "claude.cmd"
        );

        // Simulate how Windows Forms would run this - on a background thread
        await Task.Run(async () =>
        {
            Console.WriteLine($"Background thread ID: {Environment.CurrentManagedThreadId}");
            await RunClaudeTest(claudePath, "--chrome --print --output-format json", "Say hello");
        });

        Console.WriteLine();
        Console.WriteLine("=== WinForms test complete ===");
    }

    private static async Task RunClaudeTest(string exePath, string args, string prompt)
    {
        Console.WriteLine($"Running: {exePath} {args}");

        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        using var process = new Process { StartInfo = startInfo };

        var stdoutBuilder = new System.Text.StringBuilder();
        var stderrBuilder = new System.Text.StringBuilder();

        process.OutputDataReceived += (s, e) =>
        {
            if (e.Data != null)
            {
                stdoutBuilder.AppendLine(e.Data);
                Console.WriteLine($"[stdout] {(e.Data.Length > 80 ? e.Data[..80] + "..." : e.Data)}");
            }
        };

        process.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null)
            {
                stderrBuilder.AppendLine(e.Data);
                Console.WriteLine($"[stderr] {e.Data}");
            }
        };

        var sw = Stopwatch.StartNew();
        process.Start();
        Console.WriteLine($"PID: {process.Id}");

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // Write prompt to stdin
        await process.StandardInput.WriteLineAsync(prompt);
        process.StandardInput.Close();

        // Wait with timeout - using the EXACT same pattern as ClaudeExecutor
        var waitStart = DateTime.UtcNow;
        var timeoutSeconds = 30;

        while (!process.HasExited)
        {
            var completed = process.WaitForExit(5000); // Check every 5s

            if (completed || process.HasExited)
                break;

            var elapsed = (DateTime.UtcNow - waitStart).TotalSeconds;
            Console.WriteLine($"Running... {elapsed:F0}s | stdout: {stdoutBuilder.Length} | stderr: {stderrBuilder.Length}");

            if (elapsed >= timeoutSeconds)
            {
                Console.WriteLine($"TIMEOUT after {timeoutSeconds}s");
                try { process.Kill(true); } catch { }
                return;
            }
        }

        // Final wait for async readers
        process.WaitForExit();
        sw.Stop();

        Console.WriteLine($"Completed in {sw.ElapsedMilliseconds}ms with exit code {process.ExitCode}");
        Console.WriteLine($"Total stdout: {stdoutBuilder.Length} chars");
        Console.WriteLine($"Total stderr: {stderrBuilder.Length} chars");
    }
}
