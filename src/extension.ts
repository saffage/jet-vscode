import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { LanguageClient } from 'vscode-languageclient/node';
import {
	commands,
	workspace,
	window,
	ExtensionContext,
} from 'vscode';

let client: LanguageClient | undefined;

async function createLanguageClient(): Promise<LanguageClient | undefined> {
	const command = await getCommandPath();

	if (!command) {
		return;
	}

	return new LanguageClient(
		'jet-language-server',
		'Jet Language Server',
		() => Promise.resolve(spawn(command, ['lsp'], { stdio: "pipe" })),
		{
			outputChannel: window.createOutputChannel('Jet Language Server', 'jet'),
			documentSelector: [{ scheme: 'file', language: 'jet' }],
			synchronize: {
				fileEvents: workspace.createFileSystemWatcher('**/*.jet'),
			},
		},
	);
}

async function getCommandPath(): Promise<string | undefined> {
	const command = getServerPath();
	const workspaceFolders = workspace.workspaceFolders;

	if (!command || !workspace.workspaceFolders) {
		return command ?? 'jet';
	}

	if (!path.isAbsolute(command)) {
		for (const workspace of workspaceFolders) {
			const commandPath = path.resolve(workspace.uri.fsPath, command);

			if (await fileExists(commandPath)) {
				return commandPath;
			}
		}

		return;
	}

	return command;
}

async function fileExists(path: string): Promise<boolean> {
	return new Promise<boolean>(
		(resolve) => fs.stat(
			path,
			(err, stat) => resolve(err == null && stat.isFile())
		)
	).catch(() => false);
};

function getServerPath(): string | undefined {
	const path = workspace
		.getConfiguration('jet')
		.get("languageServerExecutable");
	return typeof path !== "string" || !path || path.trim().length === 0
		? undefined
		: path;
};

export async function activate(context: ExtensionContext) {
	context.subscriptions.push(
		commands.registerCommand('jet.restartLanguageServer', async () => {
			if (!client) {
				window.showInformationMessage('Language client is not active');
				return;
			}
			try {
				if (!client.isRunning()) {
					await client.start();
				} else {
					await client.restart();
					window.showInformationMessage('Jet language server restarted');
				}
			} catch (err) {
				window.showErrorMessage('Jet language server restart failed');
				client.error('Restart failed', err, 'force')
			}
		}),
	);

	let enabled = workspace
		.getConfiguration('jet')
		.get('enableLanguageServer');

	if (typeof enabled === 'boolean' && enabled) {
		client = await createLanguageClient();
		client?.start();
	}
};

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return;
	}
	return client.stop();
}
