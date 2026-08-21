using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MarkPad;

/// <summary>
/// Atualizacao a partir das releases do GitHub.
///
/// A regra que manda em tudo aqui: <b>nada e executado sem conferir o SHA-256</b>
/// publicado no <c>SHA256SUMS.txt</c> da propria release. Um instalador baixado
/// e um executavel com permissao total na maquina do usuario; enquanto os
/// binarios nao forem assinados, essa soma e a unica coisa entre a rede e o
/// disco. Se o arquivo de somas nao existir, ou nao listar o artefato, a
/// atualizacao para — abrir a pagina no navegador e melhor do que instalar as
/// cegas.
///
/// O download vai para <c>&lt;DataRoot&gt;\updates\</c> e so vira "pendente"
/// depois de conferido. Instalacao acontece em dois momentos possiveis, ambos
/// escolhidos pelo usuario: agora (o app fecha, instala e volta) ou na proxima
/// vez que o MarkPad abrir. A versao portatil nunca se instala sozinha — ela
/// pode estar num pendrive, dentro de uma pasta somente leitura ou copiada em
/// tres lugares diferentes; ali a atualizacao so avisa e abre a pagina.
/// </summary>
internal static class Updater
{
    private const string Repo = "NBN-PATRIC/markpad";
    private const string ApiLatest = "https://api.github.com/repos/" + Repo + "/releases/latest";
    private const string PaginaReleases = "https://github.com/" + Repo + "/releases";
    private const string ArquivoDeSomas = "SHA256SUMS.txt";

    /// <summary>Teto do que aceitamos baixar. Um setup do MarkPad tem ~55 MB.</summary>
    private const long TamanhoMaximo = 300L * 1024 * 1024;

    private static readonly HttpClient Http = CriaCliente();

    private static HttpClient CriaCliente()
    {
        var http = new HttpClient(new HttpClientHandler
        {
            AllowAutoRedirect = true,      // o link do asset sempre redireciona
            MaxAutomaticRedirections = 5
        })
        {
            Timeout = TimeSpan.FromMinutes(10)
        };

        // A API do GitHub recusa requisicao sem User-Agent.
        http.DefaultRequestHeaders.UserAgent.ParseAdd("MarkPad/" + VersaoAtual);
        http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return http;
    }

    // ----------------------------------------------------------------- estado

    public static string VersaoAtual =>
        typeof(Updater).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    private static string PastaUpdates
    {
        get
        {
            var p = Path.Combine(MainWindow.DataRoot, "updates");
            Directory.CreateDirectory(p);
            return p;
        }
    }

    private static string ArquivoPendente => Path.Combine(PastaUpdates, "pending.json");

    private sealed class Pendente
    {
        public string version { get; set; } = "";
        public string file { get; set; } = "";
        public string sha256 { get; set; } = "";
    }

    // ------------------------------------------------------------- consultar

    /// <summary>
    /// Pergunta ao GitHub qual e a ultima release. Devolve <c>available:false</c>
    /// quando ja estamos na versao mais nova — quem chama nunca recebe excecao
    /// por falta de rede, so um <c>ok:false</c>: o usuario nao pediu para
    /// verificar, entao um erro de rede nao merece aparecer na tela.
    /// </summary>
    public static async Task<object> CheckAsync()
    {
        try
        {
            using var resp = await Http.GetAsync(ApiLatest).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode)
                return new { ok = false, reason = "http " + (int)resp.StatusCode, current = VersaoAtual };

            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync().ConfigureAwait(false));
            var raiz = doc.RootElement;

            var tag = Texto(raiz, "tag_name");
            var versao = tag.TrimStart('v', 'V');
            if (!MaisNova(versao, VersaoAtual))
                return new { ok = true, available = false, current = VersaoAtual, latest = versao };

            // O que interessa baixar depende de como o MarkPad foi instalado.
            // O portatil nao instala nada, entao nem procura artefato.
            var alvo = MainWindow.IsPortable ? "" : $"MarkPad-{versao}-setup-win-x64.exe";

            string url = "", nome = "", sha = "";
            long tamanho = 0;

            if (alvo.Length > 0 && raiz.TryGetProperty("assets", out var assets)
                && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in assets.EnumerateArray())
                {
                    if (!Texto(a, "name").Equals(alvo, StringComparison.OrdinalIgnoreCase)) continue;
                    nome = Texto(a, "name");
                    url = Texto(a, "browser_download_url");
                    tamanho = a.TryGetProperty("size", out var s) && s.ValueKind == JsonValueKind.Number
                        ? s.GetInt64() : 0;
                    // Desde 2025 a API devolve "digest": "sha256:...". Serve de
                    // rede de seguranca se o SHA256SUMS.txt faltar na release.
                    var digest = Texto(a, "digest");
                    if (digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
                        sha = digest[7..].Trim();
                    break;
                }
            }

            // A soma publicada no arquivo tem precedencia sobre a da API: e ela
            // que o projeto gera, versiona e (quando houver) assina.
            var doArquivo = await SomaPublicadaAsync(raiz, nome).ConfigureAwait(false);
            if (doArquivo.Length > 0) sha = doArquivo;

            var podeInstalar = url.Length > 0 && sha.Length == 64 && !MainWindow.IsPortable;

            return new
            {
                ok = true,
                available = true,
                current = VersaoAtual,
                latest = versao,
                name = Texto(raiz, "name"),
                notes = Resumo(Texto(raiz, "body")),
                page = Texto(raiz, "html_url") is { Length: > 0 } h ? h : PaginaReleases,
                asset = nome,
                url,
                size = tamanho,
                canInstall = podeInstalar,
                portable = MainWindow.IsPortable
            };
        }
        catch (Exception ex)
        {
            return new { ok = false, reason = ex.Message, current = VersaoAtual };
        }
    }

    /// <summary>Le o SHA256SUMS.txt da release e procura a linha do artefato.</summary>
    private static async Task<string> SomaPublicadaAsync(JsonElement release, string artefato)
    {
        if (artefato.Length == 0) return "";
        if (!release.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array)
            return "";

        var url = "";
        foreach (var a in assets.EnumerateArray())
        {
            if (Texto(a, "name").Equals(ArquivoDeSomas, StringComparison.OrdinalIgnoreCase))
            {
                url = Texto(a, "browser_download_url");
                break;
            }
        }
        if (url.Length == 0 || !UrlConfiavel(url)) return "";

        try
        {
            var texto = await Http.GetStringAsync(url).ConfigureAwait(false);
            foreach (var linha in texto.Split('\n'))
            {
                // formato do sha256sum: "<hash>  <nome>"
                var partes = linha.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (partes.Length < 2 || partes[0].Length != 64) continue;
                if (partes[^1].Equals(artefato, StringComparison.OrdinalIgnoreCase))
                    return partes[0].Trim();
            }
        }
        catch
        {
            // Sem o arquivo de somas caimos no digest da API; sem os dois, o
            // canInstall fica falso e o usuario e mandado para a pagina.
        }
        return "";
    }

    // --------------------------------------------------------------- baixar

    /// <summary>
    /// Baixa o instalador e so o marca como pendente depois de conferir a soma.
    /// Um arquivo que nao bate e apagado na hora: guardar um binario que ja
    /// sabemos estar errado nao ajuda ninguem.
    /// </summary>
    public static async Task<object> DownloadAsync(
        string url, string nome, string sha256, string versao,
        Action<long, long>? progresso = null)
    {
        if (MainWindow.IsPortable)
            throw new InvalidOperationException("a versao portatil nao se instala sozinha.");
        if (!UrlConfiavel(url))
            throw new InvalidOperationException("endereco de download fora do GitHub.");
        if (sha256.Length != 64)
            throw new InvalidOperationException("a release nao publicou a soma deste arquivo.");

        nome = Path.GetFileName(nome);
        if (nome.Length == 0 || !nome.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("nome de artefato inesperado.");

        var destino = Path.Combine(PastaUpdates, nome);
        var parcial = destino + ".part";

        using (var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false))
        {
            resp.EnsureSuccessStatusCode();

            var tamanho = resp.Content.Headers.ContentLength ?? 0;
            if (tamanho > TamanhoMaximo)
                throw new InvalidOperationException("o arquivo anunciado e grande demais.");

            using var origem = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false);
            using var saida = new FileStream(parcial, FileMode.Create, FileAccess.Write, FileShare.None);

            var buffer = new byte[81920];
            long total = 0;
            long ultimoAviso = 0;
            int lidos;
            while ((lidos = await origem.ReadAsync(buffer).ConfigureAwait(false)) > 0)
            {
                total += lidos;
                if (total > TamanhoMaximo)
                    throw new InvalidOperationException("o download passou do tamanho aceitavel.");
                await saida.WriteAsync(buffer.AsMemory(0, lidos)).ConfigureAwait(false);

                // Avisa a cada meio mega: uma mensagem por bloco de 80 KB seriam
                // ~700 travessias da ponte para nada.
                if (progresso is not null && total - ultimoAviso >= 512 * 1024)
                {
                    ultimoAviso = total;
                    progresso(total, tamanho);
                }
            }
            progresso?.Invoke(total, tamanho);
        }

        var real = Soma(parcial);
        if (!real.Equals(sha256, StringComparison.OrdinalIgnoreCase))
        {
            TentaApagar(parcial);
            throw new InvalidOperationException("a soma do arquivo baixado nao confere; download descartado.");
        }

        TentaApagar(destino);
        File.Move(parcial, destino);

        LimpaAntigos(nome);

        File.WriteAllText(
            ArquivoPendente,
            JsonSerializer.Serialize(new Pendente { version = versao, file = nome, sha256 = real }),
            new UTF8Encoding(false));

        return new { ok = true, version = versao, file = destino };
    }

    // -------------------------------------------------------------- instalar

    /// <summary>O que esta baixado e conferido, esperando para ser instalado.</summary>
    public static object? Pending()
    {
        var p = LePendente();
        if (p is null) return null;
        return new { version = p.version, file = Path.Combine(PastaUpdates, p.file) };
    }

    /// <summary>Joga fora o download pendente (e o proprio arquivo).</summary>
    public static bool Discard()
    {
        var p = LePendente();
        if (p is not null) TentaApagar(Path.Combine(PastaUpdates, p.file));
        TentaApagar(ArquivoPendente);
        return true;
    }

    /// <summary>
    /// Instala agora. Como o instalador precisa sobrescrever o proprio
    /// executavel que esta rodando, quem espera o fim e uma copia do cmd, nao
    /// nos: disparamos a cadeia "instala e abre de novo" e saimos de cena.
    /// </summary>
    public static bool ApplyNow()
    {
        var p = LePendente();
        if (p is null) return false;

        var setup = Path.Combine(PastaUpdates, p.file);
        if (!Confere(setup, p.sha256)) { Discard(); return false; }

        var exe = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exe)) return false;

        // O "ping" e uma espera de ~2s que funciona sem console — o timeout.exe
        // exige entrada de terminal e falharia aqui. Da tempo de o nosso
        // processo sair antes de o instalador procurar o mutex.
        var linha = $"/c \"ping -n 3 127.0.0.1 >nul & \"{setup}\" {ArgumentosSilenciosos}" +
                    $" & start \"\" \"{exe}\"\"";

        Process.Start(new ProcessStartInfo("cmd.exe", linha)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = PastaUpdates
        });

        TentaApagar(ArquivoPendente);
        return true;
    }

    private const string ArgumentosSilenciosos = "/SILENT /SUPPRESSMSGBOXES /NORESTART";

    /// <summary>
    /// Chamado no comeco do App, antes de qualquer janela. Se existe um
    /// instalador pendente e conferido, ele roda aqui mesmo — esperamos o fim,
    /// abrimos o executavel novo e devolvemos <c>true</c> para o chamador
    /// encerrar este processo. E o unico ponto em que da para instalar sem
    /// piscar a janela do MarkPad na cara do usuario.
    /// </summary>
    public static bool ApplyPendingAtStartup(string[] args)
    {
        try
        {
            var p = LePendente();
            if (p is null) return false;

            var setup = Path.Combine(PastaUpdates, p.file);

            // Ja estamos nesta versao (ou mais nova): o pendente e restinho de
            // uma instalacao que deu certo. Limpar e seguir a vida.
            if (!MaisNova(p.version, VersaoAtual)) { Discard(); return false; }

            if (MainWindow.IsPortable || !Confere(setup, p.sha256)) { Discard(); return false; }

            var proc = Process.Start(new ProcessStartInfo(setup, ArgumentosSilenciosos)
            {
                UseShellExecute = false,
                WorkingDirectory = PastaUpdates
            });
            if (proc is null) return false;

            proc.WaitForExit();
            if (proc.ExitCode != 0) return false;   // deu errado: abre normal, na versao velha

            Discard();

            var exe = Environment.ProcessPath;
            if (string.IsNullOrEmpty(exe)) return false;

            // Quem clicou num .md continua querendo abrir aquele .md: os
            // argumentos da chamada seguem para a instancia nova.
            var volta = new ProcessStartInfo(exe) { UseShellExecute = true };
            foreach (var a in args) volta.ArgumentList.Add(a);
            Process.Start(volta);
            return true;
        }
        catch
        {
            // Atualizacao nunca pode impedir o app de abrir.
            return false;
        }
    }

    // --------------------------------------------------------------- apoio

    private static Pendente? LePendente()
    {
        try
        {
            if (!File.Exists(ArquivoPendente)) return null;
            var p = JsonSerializer.Deserialize<Pendente>(File.ReadAllText(ArquivoPendente));
            if (p is null || p.file.Length == 0 || p.sha256.Length != 64) return null;
            // O nome vem de um arquivo em disco; nao deixar sair da pasta.
            if (!p.file.Equals(Path.GetFileName(p.file), StringComparison.Ordinal)) return null;
            if (!File.Exists(Path.Combine(PastaUpdates, p.file))) return null;
            return p;
        }
        catch { return null; }
    }

    /// <summary>Reconfere a soma antes de executar — o arquivo dormiu em disco.</summary>
    private static bool Confere(string caminho, string sha256)
    {
        try { return Soma(caminho).Equals(sha256, StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static string Soma(string caminho)
    {
        using var fs = File.OpenRead(caminho);
        return Convert.ToHexString(SHA256.HashData(fs));
    }

    private static bool UrlConfiavel(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u)) return false;
        if (u.Scheme != Uri.UriSchemeHttps) return false;
        // O redirecionamento seguinte nao passa por aqui (o HttpClient segue
        // sozinho), mas isso nao afrouxa nada: quem decide se o arquivo vale e
        // a conferencia do SHA-256, nao a origem.
        return u.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
            || u.Host.Equals("api.github.com", StringComparison.OrdinalIgnoreCase)
            || u.Host.EndsWith(".githubusercontent.com", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>1.10.0 e mais nova que 1.9.0 — comparar texto daria o contrario.</summary>
    private static bool MaisNova(string candidata, string atual)
        => Version.TryParse(Normaliza(candidata), out var a)
        && Version.TryParse(Normaliza(atual), out var b)
        && a > b;

    private static string Normaliza(string v)
    {
        var limpa = new string(v.TakeWhile(c => char.IsDigit(c) || c == '.').ToArray());
        return limpa.Length == 0 ? "0.0.0" : limpa.Trim('.');
    }

    private static string Texto(JsonElement e, string nome)
        => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(nome, out var v)
           && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    /// <summary>As notas da release inteiras nao cabem num aviso discreto.</summary>
    private static string Resumo(string corpo)
    {
        if (corpo.Length == 0) return "";
        var texto = corpo.Replace("\r", "").Trim();
        return texto.Length <= 1200 ? texto : texto[..1200] + "\n...";
    }

    /// <summary>Um download por vez: o anterior so ocupa disco.</summary>
    private static void LimpaAntigos(string manter)
    {
        try
        {
            foreach (var f in Directory.GetFiles(PastaUpdates))
            {
                var n = Path.GetFileName(f);
                if (n.Equals(manter, StringComparison.OrdinalIgnoreCase)) continue;
                if (n.Equals("pending.json", StringComparison.OrdinalIgnoreCase)) continue;
                TentaApagar(f);
            }
        }
        catch { }
    }

    private static void TentaApagar(string caminho)
    {
        try { if (File.Exists(caminho)) File.Delete(caminho); } catch { }
    }
}
