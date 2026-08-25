import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Octokit } from '@octokit/rest';
import { ensurePrivateRepo, getOctokit, REPO_NAME } from './githubAuth';
import { exportComposer, listLocalChats } from './dbHandler';
import { ComposerExport } from './types';

function bubbleText(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const v = value as Record<string, unknown>;
  if (typeof v.text === 'string' && v.text.trim()) {
    return v.text;
  }
  if (typeof v.richText === 'string' && v.richText.trim()) {
    return v.richText;
  }
  return '';
}

function bubbleRole(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return 'message';
  }
  const t = (value as Record<string, unknown>).type;
  if (t === 1) {
    return 'user';
  }
  if (t === 2) {
    return 'assistant';
  }
  return 'message';
}

export function composerToMarkdown(composer: ComposerExport): string {
  const lines: string[] = [];
  lines.push(`# ${composer.name || 'Untitled'}`);
  lines.push('');
  lines.push(`- **composerId**: \`${composer.composerId}\``);
  if (composer.unifiedMode) {
    lines.push(`- **mode**: ${composer.unifiedMode}`);
  }
  if (composer.createdAt) {
    lines.push(`- **createdAt**: ${new Date(composer.createdAt).toISOString()}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  const headers =
    composer.composerData &&
    typeof composer.composerData === 'object' &&
    Array.isArray((composer.composerData as { fullConversationHeadersOnly?: unknown }).fullConversationHeadersOnly)
      ? (
          composer.composerData as {
            fullConversationHeadersOnly: Array<{ bubbleId?: string }>;
          }
        ).fullConversationHeadersOnly
      : [];

  const byBubbleId = new Map<string, unknown>();
  for (const b of composer.bubbles || []) {
    const parts = b.key.split(':');
    const bubbleId = parts[parts.length - 1];
    byBubbleId.set(bubbleId, b.value);
  }

  const orderedIds =
    headers.length > 0
      ? headers.map((h) => h.bubbleId).filter((id): id is string => !!id)
      : [...byBubbleId.keys()];

  if (orderedIds.length === 0 && (composer.bubbles || []).length === 0) {
    // Legacy conversationMap fallback
    const map =
      composer.composerData &&
      typeof composer.composerData === 'object'
        ? (composer.composerData as { conversationMap?: Record<string, unknown> }).conversationMap
        : undefined;
    if (map) {
      for (const [id, value] of Object.entries(map)) {
        lines.push(`### ${bubbleRole(value)}`);
        lines.push('');
        lines.push(bubbleText(value) || `_(empty bubble ${id})_`);
        lines.push('');
      }
    } else {
      lines.push('_No message bubbles found in export._');
    }
    return lines.join('\n');
  }

  for (const id of orderedIds) {
    const value = byBubbleId.get(id);
    lines.push(`### ${bubbleRole(value)}`);
    lines.push('');
    lines.push(bubbleText(value) || `_(empty bubble ${id})_`);
    lines.push('');
  }

  return lines.join('\n');
}

async function getFileSha(
  octokit: Octokit,
  owner: string,
  filePath: string
): Promise<string | undefined> {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo: REPO_NAME,
      path: filePath,
    });
    if (!Array.isArray(data) && data.type === 'file') {
      return data.sha;
    }
  } catch (e: unknown) {
    if ((e as { status?: number })?.status === 404) {
      return undefined;
    }
    throw e;
  }
  return undefined;
}

async function putFile(
  octokit: Octokit,
  owner: string,
  filePath: string,
  content: string,
  message: string
): Promise<void> {
  const sha = await getFileSha(octokit, owner, filePath);
  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: REPO_NAME,
    path: filePath,
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  });
}

export async function shareChat(context: vscode.ExtensionContext): Promise<string> {
  const chats = await listLocalChats(context);
  if (!chats.length) {
    throw new Error('No local chats found to share.');
  }

  const picked = await vscode.window.showQuickPick(
    chats.map((c) => ({
      label: c.name || 'Untitled',
      description: c.unifiedMode || '',
      detail: c.composerId,
      composerId: c.composerId,
    })),
    { placeHolder: 'Select a chat to share to your private GitHub repo' }
  );
  if (!picked) {
    return 'Share cancelled.';
  }

  const { octokit, login } = await getOctokit(true);
  await ensurePrivateRepo(octokit, login);

  const tmpDir = path.join(context.globalStorageUri.fsPath, 'tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const outFile = path.join(tmpDir, `share-${picked.composerId}.json`);
  const composer = await exportComposer(context, picked.composerId, outFile);
  const md = composerToMarkdown(composer);
  const json = JSON.stringify(composer, null, 2);

  const base = `shares/${picked.composerId}`;
  await putFile(octokit, login, `${base}.md`, md, `share: ${composer.name || picked.composerId}`);
  await putFile(octokit, login, `${base}.json`, json, `share: ${composer.name || picked.composerId} (json)`);

  const url = `https://github.com/${login}/${REPO_NAME}/blob/main/${base}.md`;
  const open = await vscode.window.showInformationMessage(
    `Shared “${composer.name}” to private repo.`,
    'Open on GitHub'
  );
  if (open === 'Open on GitHub') {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
  return url;
}
