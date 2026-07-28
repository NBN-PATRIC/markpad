using System.Runtime.InteropServices;

namespace MarkPad;

/// <summary>
/// Interop minimo: barra de titulo escura (DWM) e "mostrar no Explorer".
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
