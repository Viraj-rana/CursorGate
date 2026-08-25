import * as vscode from 'vscode';
import { dbExists, watchGlobalDb } from './dbHandler';
import { getOctokit, tryGetSession } from './githubAuth';
import { shareChat } from './shareEngine';
import { hasPendingImport, syncNow } from './syncEngine';
import { SidebarProvider } from './sidebarProvider';

let watcher: ReturnType<typeof watchGlobalDb> | undefined;

async function refreshStatus(
  context: vscode.ExtensionContext,
  sidebar: SidebarProvider
): Promise<void> {
  try {
    const session = await tryGetSession();
    const lastSyncedAt = context.globalState.get<string>('cursorGate.lastSyncedAt');
    const lastError = context.globalState.get<string>('cursorGate.lastError');
    const exists = await dbExists(context);
    sidebar.setStatus({
      connected: !!session,
      login: session?.login,
      lastSyncedAt,
      lastError,
      pendingImport: hasPendingImport(context),
      dbExists: exists,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sidebar.setStatus({
      lastError: msg,
      pendingImport: hasPendingImport(context),
    });
  }
}

function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: false,
    },
    async () => task()
  );
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  const sidebar = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('cursorGate.sidebar', sidebar)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorGate.connect', async () => {
      try {
        const { login } = await getOctokit(true);
        await context.globalState.update('cursorGate.lastError', undefined);
        await vscode.window.showInformationMessage(`CursorGate connected as ${login}`);
        await refreshStatus(context, sidebar);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await context.globalState.update('cursorGate.lastError', msg);
        await vscode.window.showErrorMessage(`CursorGate: ${msg}`);
        await refreshStatus(context, sidebar);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorGate.syncNow', async () => {
      try {
        const result = await withProgress('CursorGate: Syncing…', () => syncNow(context));
        await context.globalState.update('cursorGate.lastError', undefined);
        await vscode.window.showInformationMessage(`CursorGate: ${result}`);
        await refreshStatus(context, sidebar);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await context.globalState.update('cursorGate.lastError', msg);
        await vscode.window.showErrorMessage(`CursorGate sync failed: ${msg}`);
        await refreshStatus(context, sidebar);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorGate.shareChat', async () => {
      try {
        const result = await withProgress('CursorGate: Sharing chat…', () =>
          shareChat(context)
        );
        await context.globalState.update('cursorGate.lastError', undefined);
        if (result && !result.startsWith('Share cancelled')) {
          // shareEngine already shows a message with Open link
        } else if (result) {
          await vscode.window.showInformationMessage(`CursorGate: ${result}`);
        }
        await refreshStatus(context, sidebar);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await context.globalState.update('cursorGate.lastError', msg);
        await vscode.window.showErrorMessage(`CursorGate share failed: ${msg}`);
        await refreshStatus(context, sidebar);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cursorGate.refresh', async () => {
      await refreshStatus(context, sidebar);
    })
  );

  watcher = watchGlobalDb(() => {
    // Status-only: do not auto-push in MVP
    void refreshStatus(context, sidebar);
  });
  if (watcher) {
    context.subscriptions.push({
      dispose: () => watcher?.close(),
    });
  }

  await refreshStatus(context, sidebar);
}

export function deactivate(): void {
  watcher?.close();
  watcher = undefined;
}
