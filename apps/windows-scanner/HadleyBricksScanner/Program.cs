/**
 * Hadley Bricks Scanner - Entry Point
 *
 * TRAY1: .NET 8 WinForms project
 * Windows tray application for automated Vinted LEGO arbitrage scanning.
 */

using Serilog;

namespace HadleyBricksScanner;

internal static class Program
{
    /// <summary>
    /// The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        // Single instance check - prevent multiple copies running
        using var mutex = new Mutex(true, "HadleyBricksScannerMutex", out bool isNewInstance);

        if (!isNewInstance)
        {
            MessageBox.Show(
                "Hadley Bricks Scanner is already running.\n\nCheck the system tray for the icon.",
                "Already Running",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
            return;
        }

        // Initialize logging
        var logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "HadleyBricks", "Scanner", "logs", "scanner-.log"
        );

        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Debug()
            .WriteTo.File(
                logPath,
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}"
            )
            .CreateLogger();

        Log.Information("=== Hadley Bricks Scanner Starting ===");

        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new TrayApplicationContext());
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Application terminated unexpectedly");
            MessageBox.Show(
                $"Fatal error: {ex.Message}\n\nCheck logs for details.",
                "Error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
        finally
        {
            Log.Information("=== Hadley Bricks Scanner Stopping ===");
            Log.CloseAndFlush();
        }
    }
}
