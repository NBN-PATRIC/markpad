using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Windows;

namespace MarkPad;

public partial class App : Application
{
    private const string MutexName = "MarkPad.SingleInstance.v1";
    private const string PipeName = "MarkPad.OpenFile.v1";

    private Mutex? _mutex;
    private CancellationTokenSource? _pipeCts;

    protected override void OnStartup(StartupEventArgs e)
    {
        // Modo silencioso usado pelo instalador/desinstalador: registra (ou tira)
        // o MarkPad como aplicativo de .md e sai, sem abrir janela nenhuma.
        foreach (var arg in e.Args)
        {
            if (arg.Equals("--register-md", StringComparison.OrdinalIgnoreCase))
            {
                Environment.ExitCode = FileAssociation.Apply(true) ? 0 : 1;
                Shutdown();
                return;
            }
            if (arg.Equals("--unregister-md", StringComparison.OrdinalIgnoreCase))
            {
                Environment.ExitCode = FileAssociation.Apply(false) ? 0 : 1;
                Shutdown();
                return;
            }
            if (arg.Equals("--set-default-md", StringComparison.OrdinalIgnoreCase))
            {
                // Registra e chama a caixa do Windows. Se o MarkPad ja for o
                // padrao, nao incomoda o usuario com um dialogo a toa.
                FileAssociation.Apply(true);
                if (!FileAssociation.IsDefaultHandler()) FileAssociation.PromptSetDefault();
                Environment.ExitCode = FileAssociation.IsDefaultHandler() ? 0 : 2;
                Shutdown();
                return;
            }
        }

        // Atualizacao ja baixada e conferida entra aqui, antes de existir
        // qualquer janela: o instalador precisa sobrescrever o executavel, e
        // este e o unico momento em que nada nosso esta segurando o arquivo.
        // So vale se o MarkPad nao estiver aberto em outro lugar — com duas
        // instancias no ar a troca nao teria como acontecer.
        if (!MutexJaExiste())
        {
            if (Updater.ApplyPendingAtStartup(e.Args))
            {
                Shutdown();
                return;
            }
        }

        // "Nova janela" (menu, aba, Ctrl+Shift+N): outro processo de proposito,
        // como o -multiInst do Notepad++. Nao repassa nada e nao abre o pipe,
        // que continua sendo da janela que chegou primeiro.
        var novaJanela = e.Args.Any(a => a.Equals(ArgNovaJanela, StringComparison.OrdinalIgnoreCase));

        _mutex = new Mutex(true, MutexName, out bool isFirst);

        if (!isFirst && !novaJanela)
        {
            // Ja existe uma janela aberta: manda os arquivos pra ela e sai.
            if (ForwardToRunningInstance(e.Args))
            {
                Shutdown();
                return;
            }

            // Ninguem atendeu o pipe. A janela que tinha a vez fechou e so
            // sobrou janela extra (que nao escuta), ou ela morreu sem soltar o
            // mutex: esta assume. Se nem assim, abre como janela extra; antes o
            // arquivo pedido sumia calado.
            isFirst = TomaAVez();
        }

        base.OnStartup(e);

        var window = new MainWindow(e.Args, janelaExtra: !isFirst);
        MainWindow = window;
        window.Show();

        if (isFirst) StartPipeServer(window);
    }

    public const string ArgNovaJanela = "--nova-janela";

    /// <summary>Tenta ficar com o mutex que outra janela largou (ou deixou abandonado).</summary>
    private bool TomaAVez()
    {
        try { return _mutex!.WaitOne(0); }
        catch (AbandonedMutexException) { return true; }
        catch { return false; }
    }

    /// <summary>Ha outro MarkPad rodando nesta sessao do Windows?</summary>
    private static bool MutexJaExiste()
    {
        try
        {
            if (!Mutex.TryOpenExisting(MutexName, out var outro)) return false;
            outro.Dispose();
            return true;
        }
        catch
        {
            // Na duvida, assume que ha — o pior caso e so adiar a atualizacao.
            return true;
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _pipeCts?.Cancel();
        _mutex?.Dispose();
        base.OnExit(e);
    }

    /// <summary>Manda os argumentos para a janela que escuta o pipe. False se ninguem atendeu.</summary>
    private static bool ForwardToRunningInstance(string[] args)
    {
        if (args.Length == 0)
        {
            // Sem argumentos: so traz a janela existente pra frente.
            args = new[] { "--focus" };
        }

        // Caminho relativo e relativo a pasta DESTA instancia (o terminal de
        // quem chamou). A instancia aberta tem outra pasta atual e resolvia
        // "nota.md" no lugar errado: resolve aqui, antes de mandar.
        args = args.Select(a =>
        {
            if (a.StartsWith('-')) return a;
            try { return System.IO.Path.GetFullPath(a); }
            catch { return a; }
        }).ToArray();

        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(3000);
            var payload = Encoding.UTF8.GetBytes(string.Join("\n", args));
            client.Write(payload, 0, payload.Length);
            client.Flush();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void StartPipeServer(MainWindow window)
    {
        _pipeCts = new CancellationTokenSource();
        var token = _pipeCts.Token;

        _ = Task.Run(async () =>
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(
                        PipeName, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous);

                    await server.WaitForConnectionAsync(token).ConfigureAwait(false);

                    using var reader = new StreamReader(server, Encoding.UTF8);
                    var text = await reader.ReadToEndAsync(token).ConfigureAwait(false);
                    var incoming = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);

                    await Dispatcher.InvokeAsync(() => window.HandleExternalOpen(incoming));
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch
                {
                    await Task.Delay(500, CancellationToken.None).ConfigureAwait(false);
                }
            }
        }, token);
    }
}
