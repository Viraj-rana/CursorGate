import * as vscode from 'vscode';
import { GateStatus } from './types';

type GateAction = 'connect' | 'sync' | 'share' | 'refresh' | 'status';

export class SidebarProvider implements vscode.TreeDataProvider<GateItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<GateItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private status: GateStatus = {
    connected: false,
    pendingImport: false,
  };

  constructor(private readonly context: vscode.ExtensionContext) {}

  setStatus(partial: Partial<GateStatus>): void {
    this.status = { ...this.status, ...partial };
    this.refresh();
  }

  getStatus(): GateStatus {
    return this.status;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GateItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<GateItem[]> {
    const items: GateItem[] = [];

    if (this.status.connected) {
      items.push(
        new GateItem(
          `Connected as ${this.status.login || 'GitHub'}`,
          'status',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'account'
        )
      );
    } else {
      items.push(
        new GateItem(
          'Connect GitHub Account',
          'connect',
          vscode.TreeItemCollapsibleState.None,
          {
            command: 'cursorGate.connect',
            title: 'Connect GitHub',
          },
          'key'
        )
      );
    }

    items.push(
      new GateItem(
        'Sync Now',
        'sync',
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'cursorGate.syncNow',
          title: 'Sync Now',
        },
        'sync'
      )
    );

    items.push(
      new GateItem(
        'Share Chat',
        'share',
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'cursorGate.shareChat',
          title: 'Share Chat',
        },
        'export'
      )
    );

    items.push(
      new GateItem(
        this.formatLastSynced(),
        'status',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        'clock'
      )
    );

    if (this.status.dbExists === false) {
      items.push(
        new GateItem(
          'Local Cursor DB not found',
          'status',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'warning'
        )
      );
    }

    if (this.status.pendingImport) {
      items.push(
        new GateItem(
          'Pending import staged (restart Cursor)',
          'status',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'info'
        )
      );
    }

    if (this.status.lastError) {
      items.push(
        new GateItem(
          `Error: ${this.status.lastError}`,
          'status',
          vscode.TreeItemCollapsibleState.None,
          undefined,
          'error'
        )
      );
    }

    items.push(
      new GateItem(
        'Refresh Status',
        'refresh',
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'cursorGate.refresh',
          title: 'Refresh',
        },
        'refresh'
      )
    );

    return Promise.resolve(items);
  }

  private formatLastSynced(): string {
    const iso = this.status.lastSyncedAt;
    if (!iso) {
      return 'Last synced: never';
    }
    const then = new Date(iso).getTime();
    const diffMs = Date.now() - then;
    if (Number.isNaN(diffMs) || diffMs < 0) {
      return `Last synced: ${iso}`;
    }
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) {
      return 'Last synced: just now';
    }
    if (mins === 1) {
      return 'Last synced: 1 minute ago';
    }
    if (mins < 60) {
      return `Last synced: ${mins} minutes ago`;
    }
    const hours = Math.floor(mins / 60);
    if (hours < 24) {
      return `Last synced: ${hours} hour${hours === 1 ? '' : 's'} ago`;
    }
    return `Last synced: ${iso}`;
  }
}

class GateItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly action: GateAction,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    command?: vscode.Command,
    icon?: string
  ) {
    super(label, collapsibleState);
    this.command = command;
    this.contextValue = action;
    if (icon) {
      this.iconPath = new vscode.ThemeIcon(icon);
    }
  }
}
