import * as vscode from 'vscode';
import { Octokit } from '@octokit/rest';

export const REPO_NAME = '.cursor-chat-gate';
const SCOPES = ['repo'];

export async function getOctokit(createIfNone = true): Promise<{ octokit: Octokit; login: string }> {
  const session = await vscode.authentication.getSession('github', SCOPES, {
    createIfNone,
  });
  if (!session?.accessToken) {
    throw new Error('GitHub authentication was cancelled or failed.');
  }
  const octokit = new Octokit({ auth: session.accessToken });
  const { data: user } = await octokit.users.getAuthenticated();
  return { octokit, login: user.login };
}

export async function tryGetSession(): Promise<{ login: string } | undefined> {
  try {
    const session = await vscode.authentication.getSession('github', SCOPES, {
      createIfNone: false,
    });
    if (!session) {
      return undefined;
    }
    const octokit = new Octokit({ auth: session.accessToken });
    const { data: user } = await octokit.users.getAuthenticated();
    return { login: user.login };
  } catch {
    return undefined;
  }
}

export async function ensurePrivateRepo(octokit: Octokit, owner: string): Promise<void> {
  try {
    await octokit.repos.get({ owner, repo: REPO_NAME });
    return;
  } catch (err: unknown) {
    const status = (err as { status?: number })?.status;
    if (status !== 404) {
      throw err;
    }
  }

  await octokit.repos.createForAuthenticatedUser({
    name: REPO_NAME,
    private: true,
    auto_init: true,
    description: 'CursorGate private chat sync/share store — do not make public',
  });
}
