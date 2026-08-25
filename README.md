# CursorGate

Share and sync Cursor AI chats through your **private** GitHub repository. No third-party backend.

## Features (v0.1)

- **Connect GitHub** via VS Code / Cursor Authentication API
- **Share Chat** — export one conversation to `.cursor-chat-gate` (`shares/*.md` + `shares/*.json`)
- **Sync Now** — push/pull a bundle of recent chats (`sync/global_chats.json` + `sync/manifest.json`)
- Reads local Cursor SQLite via Python (no native Node sqlite bindings)
- Never writes live into `state.vscdb` while Cursor is running

## Requirements

- Cursor or VS Code `^1.85.0`
- Python 3 on `PATH` (`python` or `py` on Windows)
- GitHub account with permission to create a private repo

## Install (dev)

```bash
cd cursor-gate
npm install
npm run compile
```

Then in Cursor: **Extensions → … → Install from VSIX…** after `npm run package`, or press **F5** with the Extension Development Host launch config.

## Usage

1. Open the **CursorGate** activity bar icon.
2. Click **Connect GitHub** and approve the `repo` scope.
3. **Share Chat** — pick a conversation; open the returned private repo URL.
4. **Sync Now** — push local chats or pull a newer remote backup (staged import + restart prompt).

## Safety

Pull does **not** overwrite the live Cursor database. It stages `pending_import.json` under extension storage and asks you to fully restart Cursor before applying an import offline.

## Repo layout (created automatically)

Private repo: `.cursor-chat-gate`

```text
sync/manifest.json
sync/global_chats.json
shares/<composerId>.md
shares/<composerId>.json
```

## License

MIT
