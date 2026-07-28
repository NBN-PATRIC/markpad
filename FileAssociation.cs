using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace MarkPad;

/// <summary>
/// Registro do MarkPad como aplicativo para arquivos Markdown.
///
/// Escreve so em HKCU (usuario atual): nao precisa de administrador, nao afeta
/// outras contas e e reversivel. Usado em tres lugares: o menu dentro do app,
/// o instalador (<c>--register-md</c>) e o desinstalador (<c>--unregister-md</c>).
/// </summary>
internal static class FileAssociation
{
    public const string ProgId = "MarkPad.Document.1";

    public static readonly string[] Extensions = { ".md", ".markdown", ".mdown", ".mkd", ".mdx" };

    private const int SHCNE_ASSOCCHANGED = 0x08000000;
    private const int SHCNF_IDLIST = 0x0000;

    [DllImport("shell32.dll", SetLastError = true)]
    private static extern void SHChangeNotify(int eventId, int flags, IntPtr item1, IntPtr item2);

    public static bool IsRegistered()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey($@"Software\Classes\{ProgId}\shell\open\command");
            var command = key?.GetValue(null) as string;
            var exe = Environment.ProcessPath;
            return command is not null && exe is not null &&
                   command.Contains(exe, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    public static bool Apply(bool register)
    {
        try
        {
            if (register) Register();
            else Unregister();

            // Faz o Explorer reler as associacoes sem precisar de logoff.
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void Register()
    {
        var exe = Environment.ProcessPath
                  ?? throw new InvalidOperationException("caminho do executavel indisponivel.");

        using (var prog = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ProgId}"))
        {
            prog.SetValue("", "Documento Markdown");
            prog.SetValue("FriendlyTypeName", "Documento Markdown");

            using (var icon = prog.CreateSubKey("DefaultIcon"))
                icon.SetValue("", $"\"{exe}\",0");

            using (var command = prog.CreateSubKey(@"shell\open\command"))
                command.SetValue("", $"\"{exe}\" \"%1\"");

            using (var open = prog.CreateSubKey("shell\\open"))
                open.SetValue("", "Abrir no MarkPad");
        }

        // Entrada em "Abrir com" mesmo quando o usuario escolhe outro padrao.
        using (var apps = Registry.CurrentUser.CreateSubKey(
            $@"Software\Classes\Applications\{Path.GetFileName(exe)}\shell\open\command"))
        {
            apps.SetValue("", $"\"{exe}\" \"%1\"");
        }

        foreach (var ext in Extensions)
        {
            using var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ext}");
            key.SetValue("", ProgId);
            key.SetValue("PerceivedType", "text");

            using var progids = key.CreateSubKey("OpenWithProgids");
            progids.SetValue(ProgId, Array.Empty<byte>(), RegistryValueKind.None);
        }
    }

    private static void Unregister()
    {
        foreach (var ext in Extensions)
        {
            using (var key = Registry.CurrentUser.OpenSubKey($@"Software\Classes\{ext}", writable: true))
            {
                if (key?.GetValue(null) as string == ProgId)
                    key.DeleteValue("", throwOnMissingValue: false);
            }

            using var progids = Registry.CurrentUser.OpenSubKey(
                $@"Software\Classes\{ext}\OpenWithProgids", writable: true);
            progids?.DeleteValue(ProgId, throwOnMissingValue: false);
        }

        Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\{ProgId}", throwOnMissingSubKey: false);

        var exeName = Path.GetFileName(Environment.ProcessPath ?? "MarkPad.exe");
        Registry.CurrentUser.DeleteSubKeyTree(
            $@"Software\Classes\Applications\{exeName}", throwOnMissingSubKey: false);
    }
}
