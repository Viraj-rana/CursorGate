export interface SyncManifest {
  version: 1;
  updatedAt: string;
  deviceId: string;
  composerIds: string[];
  payloadSha256: string;
}

export interface ChatBundle {
  version: 1;
  exportedAt: string;
  deviceId: string;
  composers: ComposerExport[];
}

export interface ComposerExport {
  composerId: string;
  name: string;
  createdAt?: number;
  unifiedMode?: string;
  workspacePath?: string;
  composerData: unknown;
  bubbles: Array<{ key: string; value: unknown }>;
  checkpoints?: Array<{ key: string; value: unknown }>;
}

export interface ComposerSummary {
  composerId: string;
  name: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  unifiedMode?: string;
  workspacePath?: string;
}

export interface GateStatus {
  connected: boolean;
  login?: string;
  lastSyncedAt?: string;
  lastError?: string;
  pendingImport: boolean;
  dbExists?: boolean;
}
