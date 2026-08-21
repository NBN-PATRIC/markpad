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

        _mutex = new Mutex(true, MutexName, out bool isFirst);

        if (!isFirst)
        {
            // Ja existe uma janela aberta: manda os arquivos pra ela e sai.
            ForwardToRunningInstance(e.Args);
            Shutdown();
            return;
        }

        base.OnStartup(e);

        var window = new MainWindow(e.Args);
        MainWindow = window;
        window.Show();

        StartPipeServer(window);
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

    private static void ForwardToRunningInstance(string[] args)
    {
        if (args.Length == 0)
        {
            // Sem argumentos: so traz a janela existente pra frente.
            args = new[] { "--focus" };
        }

        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(3000);
            var payload = Encoding.UTF8.GetBytes(string.Join("\n", args));
            client.Write(payload, 0, payload.Length);
            client.Flush();
        }
        catch
        {
            // Se a instancia anterior morreu sem liberar o mutex, nao ha o que fazer.
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
