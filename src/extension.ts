import * as fs from "fs";
import * as path from "path";
import { CloseAction, ErrorAction, LanguageClient, State, } from "vscode-languageclient/node";
import { commands, workspace, window, ExtensionContext, ConfigurationChangeEvent, } from "vscode";

const CFG = "jet";

const enum Commands {
	RestartLanguageServer = `${CFG}.restartLanguageServer`,
	EnableLanguageServerLocally = `${CFG}.enableLanguageServerLocally`,
	DisableLanguageServerLocally = `${CFG}.disableLanguageServerLocally`,
}

const enum ConfigurationOptions {
	Path = "path",
	EnableLanguageServer = "enableLanguageServer",
	LanguageServerArgs = "languageServerArgs",
}

// type WorkspaceConfig = {
// 	path: string,
// 	languageServerEnabled: boolean,
// }

let client: LanguageClient | undefined;
// let config: WorkspaceConfig | undefined;

export async function activate(context: ExtensionContext) {
	context.subscriptions.push(
		commands.registerCommand(Commands.RestartLanguageServer, restartLanguageServer),
		commands.registerCommand(Commands.EnableLanguageServerLocally, async () => await toggleLanguageServer(true)),
		commands.registerCommand(Commands.DisableLanguageServerLocally, async () => await toggleLanguageServer(false)),
	);

	let enabled = workspace
		.getConfiguration(CFG)
		.get(ConfigurationOptions.EnableLanguageServer);

	workspace.onDidChangeConfiguration(onDidChangeConfig)

	if (typeof enabled === "boolean" && enabled) {
		await toggleLanguageServer(enabled);
	}
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}

function onDidChangeConfig(event: ConfigurationChangeEvent): any {
	// Currently, any configuration requires restart.
	if (event.affectsConfiguration(CFG)) {
		window.showWarningMessage(
			`Server configuration has changed, to make the changes take ` +
			`effect it is necessary to restart the language server`,
		);
	};
}

async function createLanguageClient(): Promise<LanguageClient | undefined> {
	const command = await getLanguageServerCommand();

	if (!command) {
		window.showInformationMessage(
			`Could not resolve path to Jet executable. Please ensure it is` +
			`available on the PATH used by VS Code or set an explicit ` +
			`"jet.path" setting to a valid Jet executable.`);
		return;
	}

	const args = workspace
		.getConfiguration(CFG)
		.get(ConfigurationOptions.LanguageServerArgs, ["language-server"]);

	return new LanguageClient(
		"jet_language_server",
		"Jet Language Server",
		{
			command,
			args,
		},
		{
			documentSelector: [
				{
					scheme: "file",
					language: "jet"
				}
			],
			synchronize: {
				fileEvents: workspace.createFileSystemWatcher("**/*.jet"),
			},
			progressOnInitialization: true,
			initializationFailedHandler: (error: Error | any) => {
				window.showErrorMessage(
					error instanceof Error
						? `Jet language server initialization failed\n${error.name}\n${error.message}`
						: `Jet language server initialization failed\n${error}`)
				return false;
			},
			errorHandler: {
				error(error, message, _) {
					window.showErrorMessage(
						message
							? `Jet language server got an error\n${error.name}: ${error.message}\n${message.jsonrpc}`
							: `Jet language server got an error\n${error.name}: ${error.message}`)
					return { action: ErrorAction.Shutdown };
				},
				closed() {
					window.showInformationMessage(`Jet language server was closed`)
					return { action: CloseAction.DoNotRestart };
				},
			}
		},
		true,
	);
}

async function getLanguageServerCommand(): Promise<string | undefined> {
	const command = getWorkspaceLanguageServerExePath();
	const workspaceFolders = workspace.workspaceFolders;

	if (!command || !workspaceFolders) {
		return command ?? "jet";
	}

	if (path.isAbsolute(command)) {
		return command;
	}

	for (const workspace of workspaceFolders) {
		const commandPath = path.resolve(workspace.uri.fsPath, command);

		if (await fileExists(commandPath)) {
			return commandPath;
		}
	}

	return undefined;
}

function getWorkspaceLanguageServerExePath(): string | undefined {
	const path = workspace
		.getConfiguration(CFG)
		.get<string>(ConfigurationOptions.Path);

	if (path.trim().length === 0) {
		return;
	}

	return path;
}

async function fileExists(path: string): Promise<boolean> {
	return new Promise<boolean>(
		(resolve) => fs.stat(
			path,
			(err, stat) => resolve(err == null && stat.isFile())
		)
	).catch(() => false);
}

async function restartLanguageServer(): Promise<void> {
	if (!client) {
		window.showInformationMessage("Jet language server are disabled, nothing no restart");
		return;
	}
	try {
		if (client.isRunning()) {
			await client.restart();
			window.showInformationMessage("Jet language server restarted");
		} else {
			await client.start();
		}
	} catch (err) {
		// window.showErrorMessage("Jet language server restart failed");
		client.error("Restart failed", err, "force")
	}
}

async function toggleLanguageServer(enabled: boolean): Promise<void> {
	workspace
		.getConfiguration(CFG)
		.update(ConfigurationOptions.EnableLanguageServer, enabled);

	if (enabled) {
		if (!client) {
			client = await createLanguageClient();
		}
		await client.start();
	} else if (client && client.state === State.Running) {
		await client.stop();
	}
}
