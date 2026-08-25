# CursorGate — Sync & Share Cursor AI Chat History

**CursorGate** is a free Cursor / VS Code extension that lets you **sync Cursor AI chats across devices** and **share conversations** using your own **private GitHub repository** as storage.

No third-party backend. No paid cloud. Your chats stay in a repo you control.

- Marketplace: [viraj.cursor-gate](https://marketplace.visualstudio.com/items?itemName=viraj.cursor-gate)
- Source: [github.com/Viraj-rana/CursorGate](https://github.com/Viraj-rana/CursorGate)

## Why CursorGate?

Cursor stores AI chat / Composer / Agent history locally in SQLite (`state.vscdb`). That means:

- Switching laptops often **loses chat context**
- There is no built-in **private multi-device sync**
- Sharing a useful debugging session usually means copy-paste

CursorGate solves that with GitHub as a secure, serverless database layer.

## Features

- **Connect GitHub** — official VS Code / Cursor Authentication API (`repo` scope)
- **Share Chat** — export one conversation to Markdown + JSON in your private repo
- **Sync Now** — push/pull recent chats (`sync/global_chats.json` + `sync/manifest.json`)
- **Private by default** — creates `.cursor-chat-gate` as a **private** repository
- **Safe reads** — Python helper copies the DB (WAL-aware); never writes live into Cursor while it is running
- **Staged import** — pull downloads a package and asks you to restart Cursor before applying

## Install

1. Open **Extensions** in Cursor (`Ctrl+Shift+X`)
2. Search **CursorGate** or **sync Cursor chat history**
3. Install **CursorGate — Sync & Share Cursor AI Chats** by **viraj**
4. Reload if prompted

Or install by id: `viraj.cursor-gate`

## Quick start

1. Open the **CursorGate** icon in the activity bar
2. Click **Connect GitHub Account** and approve access
3. **Share Chat** — pick a conversation → open the private GitHub file
4. **Sync Now** — backup recent chats, or pull a newer remote backup

## Requirements

- **Cursor** or **VS Code** `^1.85.0`
- **Python 3** on `PATH` (`python` or `py` on Windows)
- A **GitHub** account that can create a private repository

## How it works

```text
Local Cursor chats (state.vscdb)
        │  read-only snapshot via Python
        ▼
   CursorGate extension
        │  GitHub OAuth
        ▼
Private repo: .cursor-chat-gate
  shares/<id>.md | shares/<id>.json
  sync/global_chats.json
  sync/manifest.json
```

## Repo layout

| Path | Purpose |
|------|---------|
| `shares/*.md` | Human-readable shared chat |
| `shares/*.json` | Full export of composer + bubbles |
| `sync/global_chats.json` | Sync bundle (recent chats) |
| `sync/manifest.json` | Timestamps / device id / checksum |

## Safety

- CursorGate does **not** overwrite the live `state.vscdb` while Cursor is open
- After a pull, you get: *New chats downloaded… please fully restart Cursor*
- Keep `.cursor-chat-gate` **private** — it can contain proprietary code from chats

## FAQ

### Does this upload chats to a company server?
No. Only your GitHub account and private repo are used.

### Will searching “CursorGate” find it?
Yes — after Marketplace verification finishes. Also try: *sync Cursor AI chats*, *share Cursor chat history*, *Cursor chat backup GitHub*.

### Can I sync between two PCs?
Yes. Install on both, Connect GitHub, Sync Now on device A, then Sync Now → Pull on device B (then restart Cursor).

### Does it work with Composer / Agent chats?
Yes. It reads modern Cursor storage (`composerData` / `bubbleId` in `cursorDiskKV`).

## Development

```bash
cd cursor-gate
npm install
npm run compile
```

Press **F5** for Extension Development Host, or `npm run package` then **Install from VSIX**.

## Keywords / topics

Cursor AI chat sync, share Cursor conversations, backup Composer history, multi-device Cursor chats, private GitHub chat store, CursorGate.

## License

MIT © Viraj Rana
