using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace MarkPad;

public partial class MainWindow : Window
{
    private const string VirtualHost = "markpad.local";
    private const long MaxTextFileBytes = 32L * 1024 * 1024;
    private const long MaxAssetBytes = 16L * 1024 * 1024;

    /// <summary>Extensoes tratadas como markdown de verdade.</summary>
    private static readonly HashSet<string> MarkdownExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".md", ".markdown", ".mdown", ".mkd", ".mdx"
    };

    /// <summary>
    /// Onde a gravacao e recusada por principio. Abrir qualquer arquivo e
    /// legitimo — gravar por cima de um executavel nao e, e o erro seria caro
    /// demais para deixar acontecer por descuido.
    /// </summary>
    private static readonly HashSet<string> UnwritableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".exe", ".dll", ".sys", ".msi", ".com", ".scr", ".cpl", ".ocx", ".drv",
        ".pdb", ".lib", ".obj", ".bin", ".dat", ".db", ".sqlite", ".zip", ".7z",
        ".rar", ".gz", ".tar", ".pdf", ".docx", ".xlsx", ".pptx", ".pfx", ".p12"
    };

    /// <summary>Extensoes de texto reconhecidas, usadas na busca em pasta.</summary>
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".md", ".markdown", ".mdown", ".mkd", ".mdx", ".txt", ".text", ".log",
        ".csv", ".json", ".yml", ".yaml", ".ini", ".cfg", ".conf", ".toml", ".env"
    };

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif", ".ico"
    };

    private static readonly HashSet<string> SkipDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        "node_modules", ".git", ".svn", ".hg", "bin", "obj", "__pycache__",
        ".venv", "venv", "dist", "build", ".next", ".cache"
    };

    /// <summary>
    /// Defesa em profundidade: so gravamos em caminhos que o usuario abriu
    /// nesta sessao (ou que vieram de um dialogo "salvar como").
    /// </summary>
    private readonly HashSet<string> _writablePaths = new(StringComparer.OrdinalIgnoreCase);

    private readonly Dictionary<string, FileSystemWatcher> _watchers = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _watchedFiles = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, DateTime> _lastChangeNotice = new(StringComparer.OrdinalIgnoreCase);

    private readonly string[] _startupArgs;
    private readonly List<string> _pendingOpen = new();
    private readonly string _settingsPath;

    private CoreWebView2Environment? _environment;

    private static string? _dataRoot;

    /// <summary>
    /// Onde ficam configuracoes e cache. Em modo portatil, tudo mora ao lado do
    /// executavel e nada e escrito no perfil do usuario: basta existir um
    /// arquivo <c>MarkPad.portable</c> na mesma pasta (ou uma pasta <c>data</c>).
    /// </summary>
    public static string DataRoot
    {
        get
        {
            if (_dataRoot is not null) return _dataRoot;

            var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;
            var marker = Path.Combine(exeDir, "MarkPad.portable");
            var portableData = Path.Combine(exeDir, "data");

            if (File.Exists(marker) || Directory.Exists(portableData))
            {
                try
                {
                    Directory.CreateDirectory(portableData);
                    // So vale como portatil se der mesmo para gravar aqui.
                    var probe = Path.Combine(portableData, ".write-test");
                    File.WriteAllText(probe, "");
                    File.Delete(probe);
                    return _dataRoot = portableData;
                }
                catch
                {
                    // Pasta somente leitura (ex.: pendrive travado): cai no perfil.
                }
            }

            _dataRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MarkPad");
            Directory.CreateDirectory(_dataRoot);
            return _dataRoot;
        }
    }

    /// <summary>Verdadeiro quando os dados ficam ao lado do executavel.</summary>
    public static bool IsPortable
    {
        get
        {
            var exeDir = Path.GetDirectoryName(Environment.ProcessPath);
            return exeDir is not null &&
                   DataRoot.StartsWith(exeDir, StringComparison.OrdinalIgnoreCase);
        }
    }

    private bool _rendererReady;
    private bool _allowClose;
    private bool _darkTitleBar = true;

    public MainWindow(string[] args)
    {
        InitializeComponent();

        _startupArgs = args;
        _settingsPath = Path.Combine(DataRoot, "settings.json");

        Loaded += OnLoaded;
        Closing += OnClosing;
        Drop += OnDrop;
        DragOver += OnDragOver;

        _ = InitializeWebViewAsync();
    }

    // ---------------------------------------------------------------- startup

    private void OnLoaded(object? sender, RoutedEventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        NativeMethods.ApplyTitleBarTheme(hwnd, _darkTitleBar);
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            var userData = IsPortable
                ? Path.Combine(DataRoot, "WebView2")
                : Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "MarkPad", "WebView2");
            Directory.CreateDirectory(userData);

            var options = new CoreWebView2EnvironmentOptions
            {
                // Sem telemetria, sem servicos de fundo do Edge.
                AdditionalBrowserArguments = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
            };

            var env = await CoreWebView2Environment.CreateAsync(null, userData, options);
            await Web.EnsureCoreWebView2Async(env);

            var core = Web.CoreWebView2;

            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;
            core.Settings.IsSwipeNavigationEnabled = false;
            core.Settings.AreDevToolsEnabled = true;

            Web.AllowExternalDrop = false; // deixa o WPF tratar o arrastar-e-soltar

            _environment = env;

            var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
            if (Directory.Exists(webRoot))
            {
                // Build de desenvolvimento: serve os arquivos do disco.
                core.SetVirtualHostNameToFolderMapping(
                    VirtualHost, webRoot, CoreWebView2HostResourceAccessKind.Allow);
            }
            else
            {
                // Executavel publicado: a interface vem de dentro do assembly.
                core.AddWebResourceRequestedFilter($"https://{VirtualHost}/*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;
            }

            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationStarting += OnNavigationStarting;
            core.NewWindowRequested += OnNewWindowRequested;
            core.ProcessFailed += (_, _) => SplashText.Text = "o processo de renderizacao falhou. reabra o MarkPad.";

            core.Navigate($"https://{VirtualHost}/index.html");
        }
        catch (Exception ex)
        {
            Splash.Visibility = Visibility.Visible;
            SplashText.Text =
                "Nao foi possivel iniciar o WebView2.\n\n" + ex.Message +
                "\n\nInstale o 'Microsoft Edge WebView2 Runtime' e abra de novo.";
        }
    }

    private void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith($"https://{VirtualHost}/", StringComparison.OrdinalIgnoreCase)) return;

        // Nada sai da app: links externos vao pro navegador padrao.
        e.Cancel = true;
        OpenExternal(e.Uri);
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        OpenExternal(e.Uri);
    }

    /// <summary>
    /// Serve a interface a partir dos recursos embutidos no assembly.
    /// So entra em acao no executavel publicado (sem a pasta web/ ao lado).
    /// </summary>
    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        if (_environment is null) return;

        var uri = new Uri(e.Request.Uri);
        var relative = uri.AbsolutePath.TrimStart('/');
        if (string.IsNullOrEmpty(relative)) relative = "index.html";

        // Nada de subir de diretorio: o caminho vira um nome de recurso plano.
        if (relative.Contains("..", StringComparison.Ordinal))
        {
            e.Response = _environment.CreateWebResourceResponse(null, 403, "Forbidden", "");
            return;
        }

        var resourceName = "MarkPad.web." + relative.Replace('/', '.');
        var assembly = typeof(MainWindow).Assembly;
        var stream = assembly.GetManifestResourceStream(resourceName);

        if (stream is null)
        {
            e.Response = _environment.CreateWebResourceResponse(null, 404, "Not Found", "");
            return;
        }

        var contentType = Path.GetExtension(relative).ToLowerInvariant() switch
        {
            ".html" => "text/html; charset=utf-8",
            ".css" => "text/css; charset=utf-8",
            ".js" => "text/javascript; charset=utf-8",
            ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml",
            ".woff2" => "font/woff2",
            ".png" => "image/png",
            _ => "application/octet-stream"
        };

        e.Response = _environment.CreateWebResourceResponse(
            stream, 200, "OK",
            $"Content-Type: {contentType}\r\nCache-Control: no-cache");
    }

    // ------------------------------------------------------------ arrastar

    private void OnDragOver(object sender, System.Windows.DragEventArgs e)
    {
        e.Effects = e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop)
            ? System.Windows.DragDropEffects.Copy
            : System.Windows.DragDropEffects.None;
        e.Handled = true;
    }

    private void OnDrop(object sender, System.Windows.DragEventArgs e)
    {
        if (!e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop)) return;
        if (e.Data.GetData(System.Windows.DataFormats.FileDrop) is not string[] paths) return;
        HandleExternalOpen(paths);
        e.Handled = true;
    }

    /// <summary>Chamado pelo pipe (segunda instancia), pelo drop e pelos argumentos de linha de comando.</summary>
    public void HandleExternalOpen(IEnumerable<string> paths)
    {
        var list = paths
            .Where(p => !string.IsNullOrWhiteSpace(p) && !p.StartsWith("--", StringComparison.Ordinal))
            .Select(p => p.Trim().Trim('"'))
            .Where(p => File.Exists(p) || Directory.Exists(p))
            .ToList();

        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();

        if (list.Count == 0) return;

        foreach (var p in list) _writablePaths.Add(Path.GetFullPath(p));

        if (_rendererReady) PostEvent("openPaths", list);
        else _pendingOpen.AddRange(list);
    }

    // ------------------------------------------------------------- fechar

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (_allowClose || !_rendererReady) return;

        // O renderer decide: se houver alteracao nao salva, ele pergunta.
        e.Cancel = true;
        PostEvent("requestClose", null);
    }

    // ---------------------------------------------------------- mensageria

    private void PostEvent(string name, object? data)
    {
        if (Web.CoreWebView2 is null) return;
        var payload = JsonSerializer.Serialize(new { evt = name, data });
        Web.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void Reply(int id, object? result, string? error = null)
    {
        if (Web.CoreWebView2 is null) return;
        var payload = JsonSerializer.Serialize(new { id, ok = error is null, result, error });
        Web.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private async void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.TryGetProperty("id", out var idEl) ? idEl.GetInt32() : 0;
            var op = root.GetProperty("op").GetString() ?? "";
            var args = root.TryGetProperty("args", out var a) ? a : default;

            var result = await DispatchAsync(op, args);
            Reply(id, result);
        }
        catch (Exception ex)
        {
            Reply(id, null, ex.Message);
        }
    }

    private static string Str(JsonElement args, string name, string fallback = "")
        => args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? fallback
            : fallback;

    private static bool Bool(JsonElement args, string name, bool fallback = false)
        => args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v)
            && (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)
            ? v.GetBoolean()
            : fallback;

    private static int Int(JsonElement args, string name, int fallback = 0)
        => args.ValueKind == JsonValueKind.Object && args.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetInt32()
            : fallback;

    private async Task<object?> DispatchAsync(string op, JsonElement args)
    {
        switch (op)
        {
            case "ready":
                return OnRendererReady();

            case "openFileDialog":
                return OpenFileDialog(Bool(args, "multi", true));

            case "openFolderDialog":
                return OpenFolderDialog();

            case "saveAsDialog":
                return SaveAsDialog(Str(args, "suggestedName", "sem-titulo.md"), Str(args, "initialDir"));

            case "exportDialog":
                return ExportDialog(Str(args, "suggestedName", "documento.html"), Str(args, "initialDir"));

            case "readFile":
                return ReadTextFile(Str(args, "path"));

            case "writeFile":
                return WriteTextFile(
                    Str(args, "path"), Str(args, "content"),
                    Str(args, "encoding", "utf-8"), Str(args, "eol", "\n"));

            case "writeBytes":
                return WriteRawFile(Str(args, "path"), Str(args, "content"));

            case "listDir":
                return ListDirectory(Str(args, "path"));

            case "pathInfo":
                return PathInfo(Str(args, "path"));

            case "resolveAsset":
                return ResolveAsset(Str(args, "basePath"), Str(args, "src"));

            case "grepFolder":
                return await Task.Run(() => GrepFolder(
                    Str(args, "root"), Str(args, "query"),
                    Bool(args, "caseSensitive"), Bool(args, "regex"),
                    Int(args, "maxResults", 500)));

            case "watchFile":
                WatchFile(Str(args, "path"));
                return true;

            case "unwatchFile":
                _watchedFiles.Remove(Path.GetFullPath(Str(args, "path")));
                return true;

            case "revealInExplorer":
                {
                    var p = Str(args, "path");
                    if (File.Exists(p) || Directory.Exists(p)) NativeMethods.RevealInExplorer(Path.GetFullPath(p));
                    return true;
                }

            case "openExternal":
                OpenExternal(Str(args, "url"));
                return true;

            case "setTitle":
                Title = Str(args, "title", "MarkPad");
                return true;

            case "setTitleBarTheme":
                _darkTitleBar = Bool(args, "dark", true);
                NativeMethods.ApplyTitleBarTheme(new WindowInteropHelper(this).Handle, _darkTitleBar);
                Background = new System.Windows.Media.SolidColorBrush(
                    _darkTitleBar
                        ? System.Windows.Media.Color.FromRgb(0x1e, 0x1e, 0x1e)
                        : System.Windows.Media.Color.FromRgb(0xff, 0xff, 0xff));
                return true;

            case "loadSettings":
                return File.Exists(_settingsPath) ? File.ReadAllText(_settingsPath, Encoding.UTF8) : null;

            case "saveSettings":
                Directory.CreateDirectory(Path.GetDirectoryName(_settingsPath)!);
                File.WriteAllText(_settingsPath, Str(args, "json", "{}"), new UTF8Encoding(false));
                return true;

            case "print":
                Web.CoreWebView2?.ShowPrintUI(CoreWebView2PrintDialogKind.Browser);
                return true;

            case "devTools":
                Web.CoreWebView2?.OpenDevToolsWindow();
                return true;

            case "fileAssociation":
                {
                    var enable = Bool(args, "enable", true);
                    if (!FileAssociation.Apply(enable))
                        throw new InvalidOperationException("nao foi possivel alterar o registro.");
                    return new
                    {
                        associated = enable,
                        isDefault = FileAssociation.IsDefaultHandler(),
                        handler = FileAssociation.EffectiveHandler()
                    };
                }

            case "setDefaultAssociation":
                {
                    if (!FileAssociation.Apply(true))
                        throw new InvalidOperationException("nao foi possivel alterar o registro.");
                    if (!FileAssociation.IsDefaultHandler()) FileAssociation.PromptSetDefault();
                    return new
                    {
                        associated = true,
                        isDefault = FileAssociation.IsDefaultHandler(),
                        handler = FileAssociation.EffectiveHandler()
                    };
                }

            case "confirmClose":
                _allowClose = true;
                Close();
                return true;

            case "minimize":
                WindowState = WindowState.Minimized;
                return true;

            default:
                throw new InvalidOperationException($"operacao desconhecida: {op}");
        }
    }

    private object OnRendererReady()
    {
        _rendererReady = true;
        Splash.Visibility = Visibility.Collapsed;

        var initial = new List<string>();
        foreach (var a in _startupArgs)
        {
            var p = a.Trim().Trim('"');
            if (p.StartsWith("--", StringComparison.Ordinal)) continue;
            if (File.Exists(p) || Directory.Exists(p))
            {
                var full = Path.GetFullPath(p);
                _writablePaths.Add(full);
                initial.Add(full);
            }
        }
        initial.AddRange(_pendingOpen);
        _pendingOpen.Clear();

        return new
        {
            version = typeof(MainWindow).Assembly.GetName().Version?.ToString(3) ?? "1.0.0",
            openPaths = initial,
            documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            associated = FileAssociation.IsRegistered(),
            isDefault = FileAssociation.IsDefaultHandler(),
            handler = FileAssociation.EffectiveHandler(),
            exePath = Environment.ProcessPath ?? "",
            portable = IsPortable,
            dataRoot = DataRoot
        };
    }

    // ------------------------------------------------------------- dialogos

    private object? OpenFileDialog(bool multi)
    {
        var dlg = new OpenFileDialog
        {
            Title = "Abrir",
            Multiselect = multi,
            Filter =
                "Markdown (*.md;*.markdown;*.mdx)|*.md;*.markdown;*.mdown;*.mkd;*.mdx|" +
                "Texto (*.txt;*.log;*.csv)|*.txt;*.text;*.log;*.csv|" +
                "Dados (*.json;*.yml;*.yaml;*.toml;*.ini)|*.json;*.yml;*.yaml;*.toml;*.ini;*.cfg;*.conf|" +
                "Todos os arquivos (*.*)|*.*"
        };

        if (dlg.ShowDialog(this) != true) return Array.Empty<string>();

        foreach (var p in dlg.FileNames) _writablePaths.Add(Path.GetFullPath(p));
        return dlg.FileNames;
    }

    private object? OpenFolderDialog()
    {
        var dlg = new OpenFolderDialog { Title = "Abrir pasta", Multiselect = false };
        if (dlg.ShowDialog(this) != true) return null;
        return dlg.FolderName;
    }

    private object? SaveAsDialog(string suggestedName, string initialDir)
    {
        var dlg = new SaveFileDialog
        {
            Title = "Salvar como",
            FileName = suggestedName,
            DefaultExt = ".md",
            AddExtension = true,
            Filter =
                "Markdown (*.md)|*.md|" +
                "Texto (*.txt)|*.txt|" +
                "Todos os arquivos (*.*)|*.*"
        };
        if (Directory.Exists(initialDir)) dlg.InitialDirectory = initialDir;

        if (dlg.ShowDialog(this) != true) return null;

        var full = Path.GetFullPath(dlg.FileName);
        _writablePaths.Add(full);
        return full;
    }

    private object? ExportDialog(string suggestedName, string initialDir)
    {
        var dlg = new SaveFileDialog
        {
            Title = "Exportar",
            FileName = suggestedName,
            DefaultExt = ".html",
            AddExtension = true,
            Filter = "Pagina HTML (*.html)|*.html|Todos os arquivos (*.*)|*.*"
        };
        if (Directory.Exists(initialDir)) dlg.InitialDirectory = initialDir;

        if (dlg.ShowDialog(this) != true) return null;

        var full = Path.GetFullPath(dlg.FileName);
        _writablePaths.Add(full);
        return full;
    }

    // --------------------------------------------------------------- arquivos

    private object ReadTextFile(string path)
    {
        var full = Path.GetFullPath(path);
        var info = new FileInfo(full);

        if (!info.Exists) throw new FileNotFoundException("arquivo nao encontrado: " + full);
        if (info.Length > MaxTextFileBytes)
            throw new InvalidOperationException($"arquivo grande demais ({info.Length / 1024 / 1024} MB). limite: 32 MB.");

        var bytes = File.ReadAllBytes(full);

        // A extensao nao decide nada: o que importa e o conteudo. Um .md pode
        // estar corrompido e um arquivo sem extensao pode ser texto perfeito.
        if (LooksBinary(bytes))
            throw new InvalidOperationException(
                "este arquivo parece binario, nao texto. Abrir viria como lixo na tela.");

        var (text, encoding) = DecodeText(bytes);
        var eol = DetectEol(text);
        var ext = info.Extension;

        _writablePaths.Add(full);

        return new
        {
            path = full,
            name = info.Name,
            dir = info.DirectoryName ?? "",
            content = text.Replace("\r\n", "\n").Replace('\r', '\n'),
            encoding,
            eol,
            size = info.Length,
            mtime = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds(),
            readOnlyOnDisk = info.IsReadOnly,
            isMarkdown = MarkdownExtensions.Contains(ext),
            writable = !UnwritableExtensions.Contains(ext)
        };
    }

    /// <summary>
    /// Heuristica do proprio git: um byte NUL nos primeiros 8000 e sinal de
    /// binario. Texto de verdade nao tem NUL — exceto UTF-16, que tem BOM e
    /// por isso e verificado antes.
    /// </summary>
    private static bool LooksBinary(byte[] bytes)
    {
        if (bytes.Length >= 2)
        {
            var bom16 = (bytes[0] == 0xFF && bytes[1] == 0xFE) || (bytes[0] == 0xFE && bytes[1] == 0xFF);
            if (bom16) return false;
        }

        var limite = Math.Min(bytes.Length, 8000);
        for (int i = 0; i < limite; i++)
            if (bytes[i] == 0) return true;

        return false;
    }

    private object WriteTextFile(string path, string content, string encodingName, string eol)
    {
        var full = Path.GetFullPath(path);

        if (!_writablePaths.Contains(full))
            throw new UnauthorizedAccessException(
                "gravacao bloqueada: este caminho nao foi aberto por voce nesta sessao.");

        var ext = Path.GetExtension(full);
        if (UnwritableExtensions.Contains(ext))
            throw new UnauthorizedAccessException(
                $"gravacao bloqueada para a extensao '{ext}': nao e um formato de texto.");

        var normalized = eol == "\r\n" ? content.Replace("\n", "\r\n") : content;
        var encoding = EncodingFromName(encodingName);

        // Grava em arquivo temporario no mesmo diretorio e troca: nunca deixa
        // o arquivo original truncado se faltar energia/disco no meio.
        var dir = Path.GetDirectoryName(full)!;
        Directory.CreateDirectory(dir);
        var temp = Path.Combine(dir, "." + Path.GetFileName(full) + ".markpad-tmp");

        File.WriteAllText(temp, normalized, encoding);

        if (File.Exists(full))
        {
            var attributes = File.GetAttributes(full);
            if (attributes.HasFlag(FileAttributes.ReadOnly))
                throw new UnauthorizedAccessException("o arquivo esta marcado como somente leitura no disco.");
            File.Replace(temp, full, null, true);
        }
        else
        {
            File.Move(temp, full);
        }

        var info = new FileInfo(full);
        return new
        {
            path = full,
            size = info.Length,
            mtime = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeMilliseconds()
        };
    }

    private object WriteRawFile(string path, string content)
    {
        var full = Path.GetFullPath(path);
        if (!_writablePaths.Contains(full))
            throw new UnauthorizedAccessException("gravacao bloqueada: caminho nao autorizado.");

        var ext = Path.GetExtension(full);
        if (!ext.Equals(".html", StringComparison.OrdinalIgnoreCase) &&
            !ext.Equals(".htm", StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("exportacao permitida apenas para .html.");

        File.WriteAllText(full, content, new UTF8Encoding(false));
        return new { path = full };
    }

    private object ListDirectory(string path)
    {
        var full = Path.GetFullPath(path);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException("pasta nao encontrada: " + full);

        var dirs = new List<object>();
        var files = new List<object>();

        foreach (var entry in new DirectoryInfo(full).EnumerateFileSystemInfos())
        {
            var hidden = entry.Attributes.HasFlag(FileAttributes.Hidden)
                      || entry.Attributes.HasFlag(FileAttributes.System);

            if (entry is DirectoryInfo d)
            {
                if (hidden || SkipDirectories.Contains(d.Name)) continue;
                dirs.Add(new { name = d.Name, path = d.FullName, dir = true });
            }
            else if (entry is FileInfo f)
            {
                if (hidden) continue;

                // Lista tudo: quem filtra e a interface, para o usuario poder
                // alternar entre "so markdown" e "todos" sem reler a pasta.
                files.Add(new
                {
                    name = f.Name,
                    path = f.FullName,
                    dir = false,
                    size = f.Length,
                    mtime = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds(),
                    markdown = MarkdownExtensions.Contains(f.Extension),
                    text = TextExtensions.Contains(f.Extension)
                });
            }
        }

        return new { path = full, name = new DirectoryInfo(full).Name, entries = dirs.Concat(files).ToList() };
    }

    private static object PathInfo(string path)
    {
        var full = Path.GetFullPath(path);
        if (Directory.Exists(full)) return new { path = full, kind = "dir", exists = true };
        if (File.Exists(full))
        {
            var f = new FileInfo(full);
            return new
            {
                path = full,
                kind = "file",
                exists = true,
                size = f.Length,
                mtime = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds()
            };
        }
        return new { path = full, kind = "none", exists = false };
    }

    /// <summary>Resolve uma imagem citada no markdown e devolve como data URL.</summary>
    private static object? ResolveAsset(string basePath, string src)
    {
        if (string.IsNullOrWhiteSpace(src)) return null;

        string full;
        try
        {
            full = Path.IsPathRooted(src)
                ? Path.GetFullPath(src)
                : Path.GetFullPath(Path.Combine(basePath, src));
        }
        catch { return null; }

        var ext = Path.GetExtension(full);
        if (!ImageExtensions.Contains(ext)) return null;
        if (!File.Exists(full)) return null;

        var info = new FileInfo(full);
        if (info.Length > MaxAssetBytes) return null;

        var mime = ext.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".webp" => "image/webp",
            ".bmp" => "image/bmp",
            ".svg" => "image/svg+xml",
            ".avif" => "image/avif",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream"
        };

        var b64 = Convert.ToBase64String(File.ReadAllBytes(full));
        return new { url = $"data:{mime};base64,{b64}", path = full };
    }

    private object GrepFolder(string root, string query, bool caseSensitive, bool useRegex, int maxResults)
    {
        var full = Path.GetFullPath(root);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException(full);
        if (string.IsNullOrEmpty(query)) return new { results = Array.Empty<object>(), truncated = false };

        var comparison = caseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        System.Text.RegularExpressions.Regex? rx = null;
        if (useRegex)
        {
            var opts = System.Text.RegularExpressions.RegexOptions.Compiled;
            if (!caseSensitive) opts |= System.Text.RegularExpressions.RegexOptions.IgnoreCase;
            rx = new System.Text.RegularExpressions.Regex(query, opts);
        }

        var results = new List<object>();
        var truncated = false;

        foreach (var file in EnumerateTextFiles(full))
        {
            if (results.Count >= maxResults) { truncated = true; break; }

            string[] lines;
            try
            {
                if (new FileInfo(file).Length > 4 * 1024 * 1024) continue;
                var (text, _) = DecodeText(File.ReadAllBytes(file));
                lines = text.Replace("\r\n", "\n").Split('\n');
            }
            catch { continue; }

            var hits = new List<object>();
            for (int i = 0; i < lines.Length; i++)
            {
                bool hit = rx is not null ? rx.IsMatch(lines[i]) : lines[i].Contains(query, comparison);
                if (!hit) continue;

                var text = lines[i].Length > 400 ? lines[i][..400] + "..." : lines[i];
                hits.Add(new { line = i + 1, text });
                if (hits.Count >= 40) break;
            }

            if (hits.Count == 0) continue;

            results.Add(new
            {
                path = file,
                name = Path.GetFileName(file),
                relative = Path.GetRelativePath(full, file),
                hits
            });
        }

        return new { results, truncated };
    }

    private static IEnumerable<string> EnumerateTextFiles(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            var dir = stack.Pop();

            string[] subdirs;
            try { subdirs = Directory.GetDirectories(dir); }
            catch { continue; }

            foreach (var sub in subdirs)
            {
                var name = Path.GetFileName(sub);
                if (SkipDirectories.Contains(name)) continue;
                if (name.StartsWith('.') && !name.Equals(".claude", StringComparison.OrdinalIgnoreCase)) continue;
                stack.Push(sub);
            }

            string[] files;
            try { files = Directory.GetFiles(dir); }
            catch { continue; }

            foreach (var f in files)
                if (TextExtensions.Contains(Path.GetExtension(f)))
                    yield return f;
        }
    }

    // -------------------------------------------------------- codificacao

    private static (string text, string name) DecodeText(byte[] bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF)
            return (new UTF8Encoding(false).GetString(bytes, 3, bytes.Length - 3), "utf-8-bom");

        if (bytes.Length >= 4 && bytes[0] == 0xFF && bytes[1] == 0xFE && bytes[2] == 0x00 && bytes[3] == 0x00)
            return (new UTF32Encoding(false, false).GetString(bytes, 4, bytes.Length - 4), "utf-32le");

        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
            return (Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2), "utf-16le");

        if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF)
            return (Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2), "utf-16be");

        try
        {
            var strict = new UTF8Encoding(false, throwOnInvalidBytes: true);
            return (strict.GetString(bytes), "utf-8");
        }
        catch (DecoderFallbackException)
        {
            // Arquivo antigo em ANSI: Latin-1 preserva os bytes 1:1 na ida e na volta.
            return (Encoding.Latin1.GetString(bytes), "latin1");
        }
    }

    private static Encoding EncodingFromName(string name) => name switch
    {
        "utf-8-bom" => new UTF8Encoding(true),
        "utf-16le" => new UnicodeEncoding(false, true),
        "utf-16be" => new UnicodeEncoding(true, true),
        "utf-32le" => new UTF32Encoding(false, true),
        "latin1" => Encoding.Latin1,
        _ => new UTF8Encoding(false)
    };

    private static string DetectEol(string text)
    {
        int crlf = 0, lf = 0;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] != '\n') continue;
            if (i > 0 && text[i - 1] == '\r') crlf++;
            else lf++;
        }
        if (crlf == 0 && lf == 0) return Environment.NewLine;
        return crlf >= lf ? "\r\n" : "\n";
    }

    // ------------------------------------------------------ monitoramento

    private void WatchFile(string path)
    {
        var full = Path.GetFullPath(path);
        var dir = Path.GetDirectoryName(full);
        if (dir is null || !Directory.Exists(dir)) return;

        _watchedFiles.Add(full);
        if (_watchers.ContainsKey(dir)) return;

        var watcher = new FileSystemWatcher(dir)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
            IncludeSubdirectories = false,
            EnableRaisingEvents = true
        };

        watcher.Changed += OnFileSystemEvent;
        watcher.Created += OnFileSystemEvent;
        watcher.Deleted += OnFileSystemEvent;
        watcher.Renamed += OnFileSystemEvent;

        _watchers[dir] = watcher;
    }

    private void OnFileSystemEvent(object sender, FileSystemEventArgs e)
    {
        var full = Path.GetFullPath(e.FullPath);
        if (!_watchedFiles.Contains(full)) return;

        // O Windows dispara varios eventos por gravacao; agrupa numa janela curta.
        lock (_lastChangeNotice)
        {
            if (_lastChangeNotice.TryGetValue(full, out var last) &&
                (DateTime.UtcNow - last).TotalMilliseconds < 400) return;
            _lastChangeNotice[full] = DateTime.UtcNow;
        }

        var kind = e.ChangeType == WatcherChangeTypes.Deleted ? "deleted" : "changed";
        Dispatcher.InvokeAsync(() => PostEvent("fileChanged", new { path = full, kind }));
    }

    // -------------------------------------------------------------- shell

    private static void OpenExternal(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;

        // So protocolos inofensivos: nada de file:, ms-*, javascript:, etc.
        if (uri.Scheme is not ("http" or "https" or "mailto")) return;

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch { /* navegador ausente: ignora em silencio */ }
    }

}
