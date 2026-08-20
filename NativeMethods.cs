using System.Runtime.InteropServices;

namespace MarkPad;

/// <summary>
/// Interop minimo: barra de titulo escura (DWM), "mostrar no Explorer" e
/// exclusao para a Lixeira.
/// </summary>
internal static class NativeMethods
{
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY = 19;
    private const int DWMWA_CAPTION_COLOR = 35;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHOpenFolderAndSelectItems(
        IntPtr pidlFolder, uint cidl, IntPtr[]? apidl, uint dwFlags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern IntPtr ILCreateFromPathW(string pszPath);

    [DllImport("shell32.dll", ExactSpelling = true)]
    private static extern void ILFree(IntPtr pidl);

    private const uint FO_DELETE = 0x0003;
    private const ushort FOF_SILENT = 0x0004;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOERRORUI = 0x0400;

    /// <summary>
    /// Sem Pack: a receita antiga que circula por ai usa Pack = 1 e derruba o
    /// processo em x64 (violacao de acesso ja na primeira chamada). O
    /// alinhamento natural e o que casa com o struct de verdade.
    /// </summary>
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCTW
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public string? pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string? lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    private static extern int SHFileOperationW(ref SHFILEOPSTRUCTW op);

    public static void ApplyTitleBarTheme(IntPtr hwnd, bool dark)
    {
        if (hwnd == IntPtr.Zero) return;

        int value = dark ? 1 : 0;
        if (DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref value, sizeof(int)) != 0)
        {
            DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_LEGACY, ref value, sizeof(int));
        }

        // COLORREF 0x00BBGGRR. Casa a barra de titulo com o fundo do app.
        int caption = dark ? 0x001E1E1E : 0x00FFFFFF;
        DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref caption, sizeof(int));
    }

    /// <summary>
    /// Manda o arquivo para a Lixeira, nao para o vazio: excluir daqui tem que
    /// ter volta. Retorna false se o shell recusou ou a operacao foi abortada.
    /// </summary>
    public static bool SendToRecycleBin(string path)
    {
        // pFrom e uma lista terminada por dois nulos; o marshal poe um, nos o outro.
        var op = new SHFILEOPSTRUCTW
        {
            wFunc = FO_DELETE,
            pFrom = path + "\0",
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
        };

        return SHFileOperationW(ref op) == 0 && !op.fAnyOperationsAborted;
    }

    public static void RevealInExplorer(string path)
    {
        IntPtr pidl = ILCreateFromPathW(path);
        if (pidl == IntPtr.Zero) return;
        try
        {
            SHOpenFolderAndSelectItems(pidl, 0, null, 0);
        }
        finally
        {
            ILFree(pidl);
        }
    }
}
