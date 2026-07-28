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
