import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { ComposerExport, ComposerSummary } from './types';

function pythonScriptPath(context: vscode.ExtensionContext): string {
  return path.join(context.extensionPath, 'tools', 'cursor_db.py');
}

function resolvePythonBin(): string[] {
  if (process.platform === 'win32') {
    return ['python', 'py'];
  }
  return ['python3', 'python'];
}

function runPythonOnce(bin: string, script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) {
        resolve(out.trim());
      } else {
        reject(new Error(err || out || `${bin} exited ${code}`));
      }
    });
  });
}

export async function runPython(context: vscode.ExtensionContext, args: string[]): Promise<string> {
  const script = pythonScriptPath(context);
  if (!fs.existsSync(script)) {
    throw new Error(`Python helper missing: ${script}`);
  }
  const bins = resolvePythonBin();
  let lastError: Error | undefined;
  for (const bin of bins) {
    try {
      return await runPythonOnce(bin, script, args);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      // Try next binary if spawn failed (ENOENT) or similar
      const msg = lastError.message.toLowerCase();
      if (msg.includes('enoent') || msg.includes('not found')) {
        continue;
      }
      // Real script failure — don't keep trying
      throw lastError;
    }
  }
  throw lastError || new Error('Python 3 is required on PATH (python or py).');
}

export function getGlobalDbPath(): string {
  if (process.platform === 'darwin') {
    return path.join(
      process.env.HOME || '',
      'Library/Application Support/Cursor/User/globalStorage/state.vscdb'
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || '',
      'Cursor',
      'User',
      'globalStorage',
      'state.vscdb'
    );
  }
  return path.join(
    process.env.HOME || '',
    '.config/Cursor/User/globalStorage/state.vscdb'
  );
}

export async function dbExists(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    const raw = await runPython(context, ['paths']);
    const parsed = JSON.parse(raw) as { exists?: boolean };
    return !!parsed.exists;
  } catch {
    return fs.existsSync(getGlobalDbPath());
  }
}

export async function listLocalChats(
  context: vscode.ExtensionContext
): Promise<ComposerSummary[]> {
  const raw = await runPython(context, ['list']);
  return JSON.parse(raw) as ComposerSummary[];
}

export async function exportComposer(
  context: vscode.ExtensionContext,
  composerId: string,
  outFile: string
): Promise<ComposerExport> {
  await runPython(context, ['export', '--id', composerId, '--out', outFile]);
  return JSON.parse(fs.readFileSync(outFile, 'utf8')) as ComposerExport;
}

export async function stageImport(
  context: vscode.ExtensionContext,
  bundlePath: string,
  stagingDir: string
): Promise<string> {
  const raw = await runPython(context, [
    'stage-import',
    '--bundle',
    bundlePath,
    '--staging',
    stagingDir,
  ]);
  const parsed = JSON.parse(raw) as { staged?: string };
  return parsed.staged || path.join(stagingDir, 'pending_import.json');
}

export function watchGlobalDb(onChange: () => void): fs.FSWatcher | undefined {
  const db = getGlobalDbPath();
  const dir = path.dirname(db);
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    return fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (!filename || !String(filename).includes('state.vscdb')) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(onChange, 1500);
    });
  } catch {
    return undefined;
  }
}
