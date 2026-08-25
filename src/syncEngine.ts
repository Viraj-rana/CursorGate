import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Octokit } from '@octokit/rest';
import { ensurePrivateRepo, getOctokit, REPO_NAME } from './githubAuth';
import { exportComposer, listLocalChats, stageImport } from './dbHandler';
import { ChatBundle, SyncManifest } from './types';

const MAX_COMPOSERS = 20;

function deviceId(context: vscode.ExtensionContext): string {
  const key = 'cursorGate.deviceId';
  let id = context.globalState.get<string>(key);
  if (!id) {
    id = crypto.randomUUID();
    void context.globalState.update(key, id);
  }
  return id;
}

async function getFile(
  octokit: Octokit,
  owner: string,
  filePath: string
): Promise<{ sha?: string; content?: string }> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo: REPO_NAME,
      path: filePath,
    });
    if (Array.isArray(data) || data.type !== 'file') {
      return {};
    }
    return {
      sha: data.sha,
      content: Buffer.from(data.content, 'base64').toString('utf8'),
    };
  } catch (e: unknown) {
    if ((e as { status?: number })?.status === 404) {
      return {};
    }
    throw e;
  }
}

async function putFile(
  octokit: Octokit,
  owner: string,
  filePath: string,
  content: string,
  message: string,
  sha?: string
): Promise<void> {
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: REPO_NAME,
    path: filePath,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

async function buildLocalBundle(context: vscode.ExtensionContext): Promise<{
  bundle: ChatBundle;
  manifest: SyncManifest;
  payload: string;
}> {
  const chats = await listLocalChats(context);
  if (!chats.length) {
    throw new Error('No local chats found to sync.');
  }

  const selected = chats.slice(0, MAX_COMPOSERS);
  const tmpDir = path.join(context.globalStorageUri.fsPath, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  const composers = [];
  for (const c of selected) {
    const out = path.join(tmpDir, `${c.composerId}.json`);
    composers.push(await exportComposer(context, c.composerId, out));
  }

  const bundle: ChatBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    deviceId: deviceId(context),
    composers,
  };
  const payload = JSON.stringify(bundle);
  const payloadSha = crypto.createHash('sha256').update(payload).digest('hex');
  const manifest: SyncManifest = {
    version: 1,
    updatedAt: bundle.exportedAt,
    deviceId: bundle.deviceId,
    composerIds: composers.map((c) => c.composerId),
    payloadSha256: payloadSha,
  };
  return { bundle, manifest, payload };
}

async function pushBundle(
  octokit: Octokit,
  login: string,
  payload: string,
  manifest: SyncManifest
): Promise<void> {
  const remoteBundleMeta = await getFile(octokit, login, 'sync/global_chats.json');
  await putFile(
    octokit,
    login,
    'sync/global_chats.json',
    payload,
    `chore(sync): push chats from ${manifest.deviceId}`,
    remoteBundleMeta.sha
  );

  const remoteManifestMeta = await getFile(octokit, login, 'sync/manifest.json');
  await putFile(
    octokit,
    login,
    'sync/manifest.json',
    JSON.stringify(manifest, null, 2),
    `chore(sync): update manifest from ${manifest.deviceId}`,
    remoteManifestMeta.sha
  );
}

async function pullAndStage(
  context: vscode.ExtensionContext,
  octokit: Octokit,
  login: string
): Promise<string> {
  const remoteBundle = await getFile(octokit, login, 'sync/global_chats.json');
  if (!remoteBundle.content) {
    throw new Error('Remote sync payload missing.');
  }
  const staging = path.join(context.globalStorageUri.fsPath, 'staging');
  fs.mkdirSync(staging, { recursive: true });
  const bundlePath = path.join(staging, 'download.json');
  fs.writeFileSync(bundlePath, remoteBundle.content, 'utf8');
  const staged = await stageImport(context, bundlePath, staging);
  await context.globalState.update('cursorGate.pendingImport', true);
  await vscode.window.showInformationMessage(
    'New chats downloaded successfully. Please close and fully restart Cursor to load synced conversations safely.'
  );
  return `Pulled remote backup and staged import at ${staged}`;
}

export async function syncNow(context: vscode.ExtensionContext): Promise<string> {
  const { octokit, login } = await getOctokit(true);
  await ensurePrivateRepo(octokit, login);

  const { manifest: localManifest, payload } = await buildLocalBundle(context);

  const remoteManifestFile = await getFile(octokit, login, 'sync/manifest.json');
  let remoteManifest: SyncManifest | undefined;
  if (remoteManifestFile.content) {
    try {
      remoteManifest = JSON.parse(remoteManifestFile.content) as SyncManifest;
    } catch {
      remoteManifest = undefined;
    }
  }

  const remoteIsNewer =
    !!remoteManifest &&
    new Date(remoteManifest.updatedAt).getTime() > new Date(localManifest.updatedAt).getTime() &&
    remoteManifest.payloadSha256 !== localManifest.payloadSha256;

  if (remoteIsNewer) {
    const choice = await vscode.window.showInformationMessage(
      'Remote CursorGate backup is newer. Pull and stage import?',
      'Pull',
      'Push local instead',
      'Cancel'
    );
    if (!choice || choice === 'Cancel') {
      return 'Sync cancelled.';
    }
    if (choice === 'Pull') {
      const msg = await pullAndStage(context, octokit, login);
      await context.globalState.update('cursorGate.lastSyncedAt', new Date().toISOString());
      return msg;
    }
  }

  await pushBundle(octokit, login, payload, localManifest);
  await context.globalState.update('cursorGate.lastSyncedAt', new Date().toISOString());
  await context.globalState.update('cursorGate.lastError', undefined);
  return `Pushed ${localManifest.composerIds.length} chats to ${login}/${REPO_NAME}`;
}

export function hasPendingImport(context: vscode.ExtensionContext): boolean {
  const staging = path.join(context.globalStorageUri.fsPath, 'staging', 'pending_import.json');
  return (
    !!context.globalState.get<boolean>('cursorGate.pendingImport') || fs.existsSync(staging)
  );
}
