using System.Diagnostics;

namespace TestWinFormsLaunch;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        // Create a simple form with a button to trigger the test
        var form = new Form
        {
            Text = "Claude CLI Test",
            Width = 600,
            Height = 400
        };

        var logBox = new TextBox
        {
            Multiline = true,
            Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical,
            ReadOnly = true,
            Font = new System.Drawing.Font("Consolas", 9)
        };

        var btnTest = new Button
        {
            Text = "Run Claude Test",
            Dock = DockStyle.Top,
            Height = 40
        };

        void Log(string msg)
        {
            if (logBox.InvokeRequired)
            {
                logBox.Invoke(() => Log(msg));
                return;
            }
            logBox.AppendText($"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
        }

        btnTest.Click += async (s, e) =>
        {
            btnTest.Enabled = false;
            Log("=== Starting Claude CLI Test from WinForms ===");

            var claudePath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "npm", "claude.cmd"
            );

            Log($"Claude path: {claudePath}");

            // Simple test first
            Log("");
            Log("=== Test 1: Simple prompt ===");
            await RunTest(claudePath, "--chrome --print --output-format json", "Say hello", Log, 30);

            // Web navigation test
            Log("");
            Log("=== Test 2: Web navigation (60s timeout) ===");
            var prompt = @"Navigate to https://www.vinted.co.uk/catalog?brand_ids[]=89162&search_text=75192&order=newest_first
Return JSON: {""success"": true, ""count"": <number>}";
            await RunTest(claudePath, "--chrome --print --output-format json --dangerously-skip-permissions", prompt, Log, 60);

            Log("");
            Log("=== Tests Complete ===");
            btnTest.Enabled = true;
        };

        form.Controls.Add(logBox);
        form.Controls.Add(btnTest);

        Application.Run(form);
    }

    static async Task RunTest(string exePath, string args, string prompt, Action<string> log, int timeoutSeconds)
    {
        log($"Running: {exePath} {args}");
        log($"Prompt: {prompt[..Math.Min(60, prompt.Length)]}...");

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

        process.OutputDataReceived += (s, e) =>
        {
            if (e.Data != null)
            {
                stdout.AppendLine(e.Data);
                log($"[stdout] {(e.Data.Length > 80 ? e.Data[..80] + "..." : e.Data)}");
            }
        };

        process.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null)
            {
                stderr.AppendLine(e.Data);
                log($"[stderr] {e.Data}");
            }
        };

        var sw = Stopwatch.StartNew();
        process.Start();
        log($"PID: {process.Id}");

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        await process.StandardInput.WriteLineAsync(prompt);
        process.StandardInput.Close();

        // Wait on background thread to avoid blocking UI
        var waitStart = DateTime.UtcNow;
        while (!process.HasExited)
        {
            // Non-blocking wait using Task.Delay
            await Task.Delay(2000);

            var elapsed = (DateTime.UtcNow - waitStart).TotalSeconds;
            log($"Running... {elapsed:F0}s | stdout: {stdout.Length} | stderr: {stderr.Length}");

            if (elapsed >= timeoutSeconds)
            {
                log($"TIMEOUT after {timeoutSeconds}s");
                try { process.Kill(true); } catch { }
                break;
            }
        }

        sw.Stop();
        log($"Exit: {(process.HasExited ? process.ExitCode.ToString() : "killed")} in {sw.ElapsedMilliseconds}ms");
        log($"stdout: {stdout.Length} chars, stderr: {stderr.Length} chars");
    }
}
