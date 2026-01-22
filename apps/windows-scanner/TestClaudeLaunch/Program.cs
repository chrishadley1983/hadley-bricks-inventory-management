using System.Diagnostics;

Console.WriteLine("=== Claude CLI Launch Test ===");
Console.WriteLine($"Current directory: {Environment.CurrentDirectory}");
Console.WriteLine();

var claudePath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "npm", "claude.cmd"
);

Console.WriteLine($"Claude path: {claudePath}");
Console.WriteLine($"File exists: {File.Exists(claudePath)}");
Console.WriteLine();

// Test 1: Simple echo test without --chrome
Console.WriteLine("=== Test 1: Simple prompt without --chrome ===");
await RunTest(claudePath, "--print --output-format json", "Say hello in one word");

// Test 2: With --chrome
Console.WriteLine();
Console.WriteLine("=== Test 2: With --chrome ===");
await RunTest(claudePath, "--chrome --print --output-format json", "Say hello in one word");

// Test 3: Direct node execution (bypass cmd wrapper)
Console.WriteLine();
Console.WriteLine("=== Test 3: Direct node.exe execution ===");
var cliJsPath = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "npm", "node_modules", "@anthropic-ai", "claude-code", "cli.js"
);
Console.WriteLine($"CLI.js path: {cliJsPath}");
Console.WriteLine($"File exists: {File.Exists(cliJsPath)}");
if (File.Exists(cliJsPath))
{
    await RunTestNode(cliJsPath, "--print --output-format json", "Say hello in one word");
}

// Test 4: Web navigation prompt with longer timeout (like the real scanner)
Console.WriteLine();
Console.WriteLine("=== Test 4: Web navigation with --chrome (REAL TEST - 120s timeout) ===");
var webPrompt = @"Navigate to https://www.vinted.co.uk/catalog?brand_ids[]=89162&search_text=75192&order=newest_first
Wait for the page to load, then return a JSON object with:
{""success"": true, ""listingCount"": <count>}
Output ONLY valid JSON, no explanation.";
await RunTestLong(claudePath, "--chrome --print --output-format json --dangerously-skip-permissions", webPrompt, 120);

Console.WriteLine();
Console.WriteLine("=== Tests complete ===");

async Task RunTest(string exePath, string args, string prompt)
{
    Console.WriteLine($"Running: {exePath} {args}");
    Console.WriteLine($"Prompt: {prompt}");

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

    var stdout = new System.Text.StringBuilder();
    var stderr = new System.Text.StringBuilder();

    process.OutputDataReceived += (s, e) => {
        if (e.Data != null) {
            stdout.AppendLine(e.Data);
            Console.WriteLine($"[stdout] {e.Data}");
        }
    };
    process.ErrorDataReceived += (s, e) => {
        if (e.Data != null) {
            stderr.AppendLine(e.Data);
            Console.WriteLine($"[stderr] {e.Data}");
        }
    };

    var sw = Stopwatch.StartNew();
    process.Start();
    Console.WriteLine($"PID: {process.Id}");

    process.BeginOutputReadLine();
    process.BeginErrorReadLine();

    await process.StandardInput.WriteLineAsync(prompt);
    process.StandardInput.Close();

    // Wait max 30 seconds
    var completed = process.WaitForExit(30000);
    sw.Stop();

    if (!completed)
    {
        Console.WriteLine($"TIMEOUT after 30s - killing process");
        try { process.Kill(true); } catch { }
    }
    else
    {
        Console.WriteLine($"Completed in {sw.ElapsedMilliseconds}ms with exit code {process.ExitCode}");
    }

    Console.WriteLine($"Total stdout: {stdout.Length} chars");
    Console.WriteLine($"Total stderr: {stderr.Length} chars");
}

async Task RunTestLong(string exePath, string args, string prompt, int timeoutSeconds)
{
    Console.WriteLine($"Running: {exePath} {args}");
    Console.WriteLine($"Prompt: {prompt[..Math.Min(100, prompt.Length)]}...");
    Console.WriteLine($"Timeout: {timeoutSeconds}s");

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

    var stdout = new System.Text.StringBuilder();
    var stderr = new System.Text.StringBuilder();

    process.OutputDataReceived += (s, e) => {
        if (e.Data != null) {
            stdout.AppendLine(e.Data);
            Console.WriteLine($"[stdout] {(e.Data.Length > 100 ? e.Data[..100] + "..." : e.Data)}");
        }
    };
    process.ErrorDataReceived += (s, e) => {
        if (e.Data != null) {
            stderr.AppendLine(e.Data);
            Console.WriteLine($"[stderr] {e.Data}");
        }
    };

    var sw = Stopwatch.StartNew();
    process.Start();
    Console.WriteLine($"PID: {process.Id}");

    process.BeginOutputReadLine();
    process.BeginErrorReadLine();

    await process.StandardInput.WriteLineAsync(prompt);
    process.StandardInput.Close();

    // Wait with progress logging
    var waitStart = DateTime.UtcNow;
    while (!process.HasExited)
    {
        var completed = process.WaitForExit(10000); // 10s intervals
        if (completed || process.HasExited) break;

        var elapsed = (DateTime.UtcNow - waitStart).TotalSeconds;
        Console.WriteLine($"Still running... {elapsed:F0}s | stdout: {stdout.Length} | stderr: {stderr.Length}");

        if (elapsed >= timeoutSeconds)
        {
            Console.WriteLine($"TIMEOUT after {timeoutSeconds}s - killing process");
            try { process.Kill(true); } catch { }
            break;
        }
    }

    if (process.HasExited)
    {
        process.WaitForExit(); // Final wait for async readers
    }
    sw.Stop();

    Console.WriteLine($"Exit code: {(process.HasExited ? process.ExitCode.ToString() : "N/A")}");
    Console.WriteLine($"Total time: {sw.ElapsedMilliseconds}ms");
    Console.WriteLine($"Total stdout: {stdout.Length} chars");
    Console.WriteLine($"Total stderr: {stderr.Length} chars");
}

async Task RunTestNode(string cliJsPath, string args, string prompt)
{
    Console.WriteLine($"Running: node {cliJsPath} {args}");
    Console.WriteLine($"Prompt: {prompt}");

    var startInfo = new ProcessStartInfo
    {
        FileName = "node",
        Arguments = $"\"{cliJsPath}\" {args}",
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
    };

    using var process = new Process { StartInfo = startInfo };

    var stdout = new System.Text.StringBuilder();
    var stderr = new System.Text.StringBuilder();

    process.OutputDataReceived += (s, e) => {
        if (e.Data != null) {
            stdout.AppendLine(e.Data);
            Console.WriteLine($"[stdout] {e.Data}");
        }
    };
    process.ErrorDataReceived += (s, e) => {
        if (e.Data != null) {
            stderr.AppendLine(e.Data);
            Console.WriteLine($"[stderr] {e.Data}");
        }
    };

    var sw = Stopwatch.StartNew();
    process.Start();
    Console.WriteLine($"PID: {process.Id}");

    process.BeginOutputReadLine();
    process.BeginErrorReadLine();

    await process.StandardInput.WriteLineAsync(prompt);
    process.StandardInput.Close();

    // Wait max 30 seconds
    var completed = process.WaitForExit(30000);
    sw.Stop();

    if (!completed)
    {
        Console.WriteLine($"TIMEOUT after 30s - killing process");
        try { process.Kill(true); } catch { }
    }
    else
    {
        Console.WriteLine($"Completed in {sw.ElapsedMilliseconds}ms with exit code {process.ExitCode}");
    }

    Console.WriteLine($"Total stdout: {stdout.Length} chars");
    Console.WriteLine($"Total stderr: {stderr.Length} chars");
}
