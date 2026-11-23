// nx.exe: the command line entry point of Nexa.
//
// Typed in a terminal or in the Explorer address bar, it opens Nexa with a chat in the current
// folder (starting the app if needed). The launcher only forwards the working directory and its
// arguments; Nexa parses them (src/main/launch.ts).
//
// It is a GUI-subsystem program so that Explorer doesn't flash a console window. Output (help,
// errors) goes to the console of the calling shell via AttachConsole.
//
// Internal switches used by the installer and the settings page:
//   --nx-register    add the folder of nx.exe to the user PATH and register the App Path
//   --nx-unregister  undo both
//   --nx-status      exit code 0 when both are registered, 1 otherwise
//
// Built with the C# compiler of the .NET Framework 4 that ships with Windows (scripts/build-launcher.mjs).

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Nexa CLI")]
[assembly: AssemblyProduct("Nexa")]
[assembly: AssemblyCopyright("Copyright © 2026 Connor Breuer")]

static class Program
{
    const string AppExecutable = "Nexa.exe";
    const string ForwardSwitch = "--nx=";
    const string AppPathsKey = @"Software\Microsoft\Windows\CurrentVersion\App Paths\nx.exe";

    static readonly string Help = string.Join("\r\n", new[] {
        "",
        "Nexa – Chat mit Claude Code oder Codex aus der Kommandozeile öffnen",
        "",
        "  nx                    neuer Chat im aktuellen Ordner",
        "  nx <ordner>           neuer Chat in <ordner>",
        "  nx -c                 letzten Chat in diesem Ordner öffnen",
        "  nx --claude           mit Claude Code",
        "  nx --codex            mit Codex",
        "  nx -m \"<prompt>\"      Chat öffnen und den Prompt gleich senden",
        "",
        "Auch in der Explorer-Adressleiste: \"nx\" öffnet einen Chat im angezeigten Ordner.",
        "",
    });

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1)
            {
                switch (args[0])
                {
                    case "-h":
                    case "--help":
                    case "/?":
                        Print(Help);
                        return 0;
                    case "--nx-register":
                        return Register();
                    case "--nx-unregister":
                        return Unregister();
                    case "--nx-status":
                        return IsRegistered() ? 0 : 1;
                }
            }
            return Forward(args);
        }
        catch (Exception error)
        {
            Fail(error.Message);
            return 1;
        }
    }

    static string BinDir
    {
        get { return Path.GetDirectoryName(Path.GetFullPath(Assembly.GetExecutingAssembly().Location)); }
    }

    static string LauncherPath
    {
        get { return Path.Combine(BinDir, "nx.exe"); }
    }

    // ---------------------------------------------------------------------------------------
    // Forwarding
    // ---------------------------------------------------------------------------------------

    static int Forward(string[] args)
    {
        string app = Path.GetFullPath(Path.Combine(BinDir, "..", AppExecutable));
        if (!File.Exists(app))
        {
            Fail("Nexa wurde nicht gefunden: " + app);
            return 1;
        }

        // Working directory and arguments travel as one Base64 switch: Chromium reorders and
        // rewrites command line switches, a single opaque value survives unchanged.
        string cwd = Environment.CurrentDirectory;
        var payload = new StringBuilder(cwd);
        foreach (string arg in args)
        {
            payload.Append('\0').Append(arg);
        }
        string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(payload.ToString()));

        var info = new ProcessStartInfo(app, ForwardSwitch + encoded)
        {
            UseShellExecute = false,
            WorkingDirectory = cwd,
        };
        // Inherited from a process under an Electron app (e.g. Claude Code in VS Code), these would
        // start the app as plain Node.js.
        info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        info.EnvironmentVariables.Remove("ELECTRON_NO_ATTACH_CONSOLE");
        using (Process.Start(info)) { }
        return 0;
    }

    // ---------------------------------------------------------------------------------------
    // Registration (user PATH + App Paths, no admin rights needed)
    // ---------------------------------------------------------------------------------------

    static int Register()
    {
        bool changed = false;
        using (RegistryKey env = Registry.CurrentUser.CreateSubKey("Environment"))
        {
            string current = ReadPath(env);
            List<string> entries = SplitPath(current);
            if (!entries.Exists(IsBinDir))
            {
                AddEntry(entries, BinDir);
                WritePath(env, entries, current);
                changed = true;
            }
        }

        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(AppPathsKey))
        {
            string existing = key.GetValue("") as string;
            // Never take over a "nx" that belongs to another installed program.
            if (existing != null && !SamePath(existing, LauncherPath) && File.Exists(existing))
            {
                Print("Hinweis: \"nx\" ist bereits für " + existing + " registriert, App Path unverändert.");
            }
            else
            {
                key.SetValue("", LauncherPath, RegistryValueKind.String);
            }
        }

        if (changed) BroadcastEnvironmentChange();
        return 0;
    }

    static int Unregister()
    {
        bool changed = false;
        using (RegistryKey env = Registry.CurrentUser.OpenSubKey("Environment", true))
        {
            if (env != null)
            {
                string current = ReadPath(env);
                List<string> entries = SplitPath(current);
                if (entries.RemoveAll(IsBinDir) > 0)
                {
                    WritePath(env, entries, current);
                    changed = true;
                }
            }
        }

        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(AppPathsKey))
        {
            string existing = key == null ? null : key.GetValue("") as string;
            if (key != null && (existing == null || SamePath(existing, LauncherPath)))
            {
                key.Close();
                Registry.CurrentUser.DeleteSubKeyTree(AppPathsKey, false);
            }
        }

        if (changed) BroadcastEnvironmentChange();
        return 0;
    }

    static bool IsRegistered()
    {
        using (RegistryKey env = Registry.CurrentUser.OpenSubKey("Environment"))
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(AppPathsKey))
        {
            bool inPath = env != null && SplitPath(ReadPath(env)).Exists(IsBinDir);
            string appPath = key == null ? null : key.GetValue("") as string;
            return inPath && appPath != null && SamePath(appPath, LauncherPath);
        }
    }

    /** The raw value: %VARIABLES% stay unexpanded so they survive the rewrite. */
    static string ReadPath(RegistryKey env)
    {
        return env.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string ?? "";
    }

    static void WritePath(RegistryKey env, List<string> entries, string previous)
    {
        string value = string.Join(";", entries.ToArray());
        if (value.Length == 0)
        {
            env.DeleteValue("Path", false);
            return;
        }
        // Keep the value type; a missing value becomes REG_EXPAND_SZ like the Windows default.
        RegistryValueKind kind = previous.Length > 0 && HasValue(env, "Path")
            ? env.GetValueKind("Path")
            : RegistryValueKind.ExpandString;
        if (kind != RegistryValueKind.String) kind = RegistryValueKind.ExpandString;
        env.SetValue("Path", value, kind);
    }

    /** Keeps empty entries (";;", a trailing ";") so unregistering restores the exact value. */
    static List<string> SplitPath(string value)
    {
        return value.Length == 0 ? new List<string>() : new List<string>(value.Split(';'));
    }

    /** Adds the entry in front of a trailing ";", which keeps that style of the value. */
    static void AddEntry(List<string> entries, string entry)
    {
        bool trailing = entries.Count > 0 && entries[entries.Count - 1].Length == 0;
        entries.Insert(trailing ? entries.Count - 1 : entries.Count, entry);
    }

    static bool IsBinDir(string entry)
    {
        return SamePath(Environment.ExpandEnvironmentVariables(entry), BinDir);
    }

    static bool SamePath(string a, string b)
    {
        try
        {
            // Registry values are sometimes quoted.
            a = Path.GetFullPath(a.Trim().Trim('"')).TrimEnd('\\');
            b = Path.GetFullPath(b.Trim().Trim('"')).TrimEnd('\\');
        }
        catch (Exception)
        {
            return false;
        }
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    static bool HasValue(RegistryKey key, string name)
    {
        foreach (string existing in key.GetValueNames())
        {
            if (string.Equals(existing, name, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    /** Lets Explorer and newly opened terminals pick up the changed PATH without a new login. */
    static void BroadcastEnvironmentChange()
    {
        UIntPtr result;
        SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, UIntPtr.Zero, "Environment", SMTO_ABORTIFHUNG, 5000, out result);
    }

    // ---------------------------------------------------------------------------------------
    // Output
    // ---------------------------------------------------------------------------------------

    static bool? attached;

    /** Writes to the console of the calling shell; false when there is none (e.g. Explorer). */
    static bool Print(string text)
    {
        if (attached == null) attached = AttachConsole(ATTACH_PARENT_PROCESS);
        if (attached != true) return false;
        IntPtr handle = CreateFile("CONOUT$", GENERIC_READ | GENERIC_WRITE, FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
        if (handle == INVALID_HANDLE_VALUE) return false;
        try
        {
            // The shell has already printed its prompt; start on a fresh line.
            string output = "\r\n" + text.TrimEnd() + "\r\n";
            uint written;
            return WriteConsole(handle, output, (uint)output.Length, out written, IntPtr.Zero);
        }
        finally
        {
            CloseHandle(handle);
        }
    }

    static void Fail(string message)
    {
        if (!Print("nx: " + message))
        {
            MessageBox.Show(message, "Nexa", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    // ---------------------------------------------------------------------------------------
    // Win32
    // ---------------------------------------------------------------------------------------

    const int ATTACH_PARENT_PROCESS = -1;
    const uint GENERIC_READ = 0x80000000;
    const uint GENERIC_WRITE = 0x40000000;
    const uint FILE_SHARE_WRITE = 0x00000002;
    const uint OPEN_EXISTING = 3;
    static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);
    static readonly IntPtr HWND_BROADCAST = new IntPtr(0xffff);
    const uint WM_SETTINGCHANGE = 0x001A;
    const uint SMTO_ABORTIFHUNG = 0x0002;

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(int processId);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool WriteConsole(IntPtr handle, string text, uint length, out uint written, IntPtr reserved);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
