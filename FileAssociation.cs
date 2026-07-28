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

    [Flags]
    private enum OpenAsInfoFlags
    {
        AllowRegistration = 0x01,
        RegisterExtension = 0x02,
        Execute = 0x04,
        ForceRegistration = 0x08,
        HideRegistration = 0x20
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct OpenAsInfo
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string FileName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? FileClass;
        [MarshalAs(UnmanagedType.I4)] public OpenAsInfoFlags Flags;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHOpenWithDialog(IntPtr parent, ref OpenAsInfo info);

    /// <summary>
    /// Abre a caixa "Como voce quer abrir arquivos .md?" do proprio Windows.
    ///
    /// Nao da para simplesmente virar o padrao por conta propria: desde o
    /// Windows 10 a escolha real fica em
    /// <c>...\Explorer\FileExts\.md\UserChoice</c>, protegida por um hash que
    /// so o shell sabe calcular. Qualquer instalador que prometa trocar isso
    /// sozinho esta mentindo ou usando truque que quebra na proxima
    /// atualizacao. O caminho honesto e registrar o aplicativo e deixar o
    /// usuario confirmar num clique.
    /// </summary>
    public static bool PromptSetDefault(string extension = ".md")
    {
        var sample = Path.Combine(Path.GetTempPath(), "MarkPad-exemplo" + extension);

        try
        {
            if (!File.Exists(sample))
                File.WriteAllText(sample, "# MarkPad\n\nArquivo de exemplo para a escolha do aplicativo padrao.\n");

            var info = new OpenAsInfo
            {
                FileName = sample,
                FileClass = null,
                // Sem Execute: so queremos definir a associacao, nao abrir nada.
                Flags = OpenAsInfoFlags.AllowRegistration |
                        OpenAsInfoFlags.RegisterExtension |
                        OpenAsInfoFlags.ForceRegistration
            };

            SHOpenWithDialog(IntPtr.Zero, ref info);
            return true;
        }
        catch
        {
            // Usuario cancelou (o shell devolve erro nesse caso) ou o shell recusou.
            return false;
        }
        finally
        {
            try { File.Delete(sample); } catch { /* sem importancia */ }
        }
    }

    /// <summary>Qual ProgId o Windows esta realmente usando para a extensao.</summary>
    public static string? EffectiveHandler(string extension = ".md")
    {
        using var choice = Registry.CurrentUser.OpenSubKey(
            $@"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{extension}\UserChoice");
        if (choice?.GetValue("ProgId") is string progId) return progId;

        using var cls = Registry.ClassesRoot.OpenSubKey(extension);
        return cls?.GetValue(null) as string;
    }

    public static bool IsDefaultHandler(string extension = ".md")
        => string.Equals(EffectiveHandler(extension), ProgId, StringComparison.OrdinalIgnoreCase);

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

        // Registro de "aplicativo" propriamente dito: e o que faz o MarkPad
        // aparecer em Configuracoes > Aplicativos padrao, onde o usuario pode
        // promove-lo a padrao de .md.
        using (var caps = Registry.CurrentUser.CreateSubKey($@"Software\{AppRegistryName}\Capabilities"))
        {
            caps.SetValue("ApplicationName", "MarkPad");
            caps.SetValue("ApplicationDescription",
                "Leitor e editor de Markdown que abre travado, sem risco de alterar o arquivo sem querer.");

            using var assoc = caps.CreateSubKey("FileAssociations");
            foreach (var ext in Extensions) assoc.SetValue(ext, ProgId);
        }

        using (var registered = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications"))
        {
            registered.SetValue("MarkPad", $@"Software\{AppRegistryName}\Capabilities");
        }
    }

    private const string AppRegistryName = "MarkPad";

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

        using (var registered = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", writable: true))
        {
            registered?.DeleteValue("MarkPad", throwOnMissingValue: false);
        }

        Registry.CurrentUser.DeleteSubKeyTree($@"Software\{AppRegistryName}", throwOnMissingSubKey: false);
    }
}
