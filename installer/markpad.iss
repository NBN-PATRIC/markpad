; Instalador do MarkPad (Inno Setup 6).
;
; Compilar:  tools\build-installer.ps1
; Direto:    ISCC.exe /DAppVersion=1.0.0 /DExeSource=..\publish\installed\MarkPad.exe installer\markpad.iss
;
; Instala por usuario, em %LOCALAPPDATA%\Programs\MarkPad: nao pede
; administrador e nao mexe em nada de outras contas.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#ifndef ExeSource
  #define ExeSource "..\publish\installed\MarkPad.exe"
#endif

#define AppName      "MarkPad"
#define AppPublisher "NBN Telecom"
#define AppUrl       "https://github.com/NBN-PATRIC/markpad"
#define AppExeName   "MarkPad.exe"

[Setup]
AppId={{29A0284C-F3EC-4C8F-9271-D56D908C19AB}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}

; Instalacao por usuario: sem UAC, sem tocar em HKLM.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes

OutputDir=..\dist
OutputBaseFilename={#AppName}-{#AppVersion}-setup-win-x64
SetupIconFile=..\Assets\app.ico
LicenseFile=..\LICENSE
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName} {#AppVersion}

Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Se o MarkPad estiver aberto, oferece fechar em vez de falhar na hora de copiar.
CloseApplications=yes
CloseApplicationsFilter=*.exe
RestartApplications=no
AppMutex=MarkPad.SingleInstance.v1

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
; Marcada por padrao: e o motivo de existir o instalador.
Name: "assocmd"; \
  Description: "Abrir arquivos .md, .markdown e .mdx com o {#AppName}"; \
  GroupDescription: "Integração com o Windows:"

; Desde o Windows 10 a escolha real do aplicativo padrao vive em
; ...\Explorer\FileExts\.md\UserChoice, protegida por hash. Nenhum instalador
; consegue troca-la sozinho. O que da para fazer e registrar o aplicativo e
; pedir ao proprio Windows que mostre a caixa de confirmacao, que e um clique.
Name: "setdefault"; \
  Description: "Confirmar o {#AppName} como padrão ao final (o Windows pedirá um clique)"; \
  GroupDescription: "Integração com o Windows:"

Name: "desktopicon"; \
  Description: "Criar um atalho na área de trabalho"; \
  GroupDescription: "Atalhos:"; \
  Flags: unchecked

[Files]
Source: "{#ExeSource}";     DestDir: "{app}"; Flags: ignoreversion
Source: "..\README.md";     DestDir: "{app}"; Flags: ignoreversion
Source: "..\CHANGELOG.md";  DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE";       DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}";                 Filename: "{app}\{#AppExeName}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";           Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
; A associacao roda pelo proprio executavel, para o instalador e o menu do app
; usarem exatamente o mesmo codigo.
Filename: "{app}\{#AppExeName}"; Parameters: "--register-md"; \
  Tasks: assocmd; Flags: runhidden waituntilterminated; \
  StatusMsg: "Registrando os arquivos .md..."

; Sem runhidden: esta etapa precisa mostrar a caixa do Windows.
; skipifsilent porque numa instalacao silenciosa nao ha quem clique.
Filename: "{app}\{#AppExeName}"; Parameters: "--set-default-md"; \
  Tasks: setdefault; Flags: waituntilterminated skipifsilent; \
  StatusMsg: "Confirmando o aplicativo padrão para .md..."

Filename: "{app}\{#AppExeName}"; \
  Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#AppExeName}"; Parameters: "--unregister-md"; \
  RunOnceId: "DesassociarMd"; Flags: runhidden waituntilterminated

[UninstallDelete]
; Cache do WebView2 e regeneravel; as configuracoes do usuario ficam.
Type: filesandordirs; Name: "{localappdata}\{#AppName}\WebView2"

[Messages]
brazilianportuguese.WelcomeLabel2=Isto instalará o [name/ver] no seu computador.%n%nLeitor e editor de Markdown: todo arquivo abre travado, sem risco de alterar nada sem querer.%n%nA instalação é só para o seu usuário e não pede senha de administrador.
