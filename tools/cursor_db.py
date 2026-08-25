#!/usr/bin/env python3
"""Read/export Cursor chat rows without native Node sqlite bindings."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any


def cursor_user_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Cursor/User"
    if sys.platform == "win32":
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise RuntimeError("APPDATA is not set")
        return Path(appdata) / "Cursor" / "User"
    return Path.home() / ".config" / "Cursor" / "User"


def global_db_path() -> Path:
    return cursor_user_dir() / "globalStorage" / "state.vscdb"


def copy_db_snapshot(src: Path) -> Path:
    """WAL-safe snapshot: copy .vscdb + -wal + -shm into a temp dir."""
    if not src.exists():
        raise FileNotFoundError(f"Cursor DB not found: {src}")
    tmp = Path(tempfile.mkdtemp(prefix="cursorgate-"))
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(src) + suffix) if suffix else src
        if p.exists():
            shutil.copy2(p, tmp / p.name)
    return tmp / src.name


def open_ro(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    return sqlite3.connect(uri, uri=True)


def _blob_to_str(raw: Any) -> str:
    if isinstance(raw, str):
        return raw
    if isinstance(raw, memoryview):
        raw = raw.tobytes()
    if isinstance(raw, bytes):
        return raw.decode("utf-8", "replace")
    return str(raw)


def _parse_json(raw: Any) -> Any:
    return json.loads(_blob_to_str(raw))


def list_composers(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    # Cursor 3.0+ central index
    row = conn.execute(
        "SELECT value FROM ItemTable WHERE key = ?",
        ("composer.composerHeaders",),
    ).fetchone()
    if row and row[0]:
        try:
            data = _parse_json(row[0])
            for c in data.get("allComposers", []):
                cid = c.get("composerId")
                if not cid:
                    continue
                ws = c.get("workspaceIdentifier") or {}
                uri = ws.get("uri") or {}
                out.append(
                    {
                        "composerId": cid,
                        "name": c.get("name") or "Untitled",
                        "createdAt": c.get("createdAt"),
                        "lastUpdatedAt": c.get("lastUpdatedAt"),
                        "unifiedMode": c.get("unifiedMode"),
                        "workspacePath": uri.get("fsPath"),
                    }
                )
            if out:
                out.sort(key=lambda x: x.get("lastUpdatedAt") or x.get("createdAt") or 0, reverse=True)
                return out
        except Exception:
            pass

    # Fallback: scan composerData:* keys
    for (key,) in conn.execute(
        "SELECT key FROM cursorDiskKV WHERE key LIKE 'composerData:%'"
    ):
        cid = key.split(":", 1)[1]
        val = conn.execute(
            "SELECT value FROM cursorDiskKV WHERE key = ?", (key,)
        ).fetchone()
        name = "Untitled"
        created = None
        mode = None
        last_updated = None
        if val and val[0]:
            try:
                obj = _parse_json(val[0])
                name = obj.get("name") or name
                created = obj.get("createdAt")
                last_updated = obj.get("lastUpdatedAt")
                mode = obj.get("unifiedMode")
            except Exception:
                pass
        out.append(
            {
                "composerId": cid,
                "name": name,
                "createdAt": created,
                "lastUpdatedAt": last_updated,
                "unifiedMode": mode,
            }
        )

    out.sort(key=lambda x: x.get("lastUpdatedAt") or x.get("createdAt") or 0, reverse=True)
    return out


def export_composer(conn: sqlite3.Connection, composer_id: str) -> dict[str, Any]:
    cd_key = f"composerData:{composer_id}"
    row = conn.execute(
        "SELECT value FROM cursorDiskKV WHERE key = ?", (cd_key,)
    ).fetchone()
    if not row:
        raise SystemExit(f"composer not found: {composer_id}")

    composer_data = _parse_json(row[0])

    bubbles = []
    for key, value in conn.execute(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE ?",
        (f"bubbleId:{composer_id}:%",),
    ):
        try:
            bubbles.append({"key": key, "value": _parse_json(value)})
        except Exception:
            bubbles.append({"key": key, "value": _blob_to_str(value)})

    checkpoints = []
    for key, value in conn.execute(
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE ?",
        (f"checkpointId:{composer_id}:%",),
    ):
        try:
            checkpoints.append({"key": key, "value": _parse_json(value)})
        except Exception:
            checkpoints.append({"key": key, "value": _blob_to_str(value)})

    return {
        "composerId": composer_id,
        "name": composer_data.get("name") or "Untitled",
        "createdAt": composer_data.get("createdAt"),
        "unifiedMode": composer_data.get("unifiedMode"),
        "composerData": composer_data,
        "bubbles": bubbles,
        "checkpoints": checkpoints,
    }


def stage_import(bundle_path: Path, staging_dir: Path) -> None:
    """Never write live DB while Cursor runs — stage only."""
    staging_dir.mkdir(parents=True, exist_ok=True)
    dest = staging_dir / "pending_import.json"
    shutil.copy2(bundle_path, dest)
    print(json.dumps({"ok": True, "staged": str(dest)}))


def _configure_stdio() -> None:
    """Avoid Windows cp1252 UnicodeEncodeError on chat titles."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        except Exception:
            pass


def main() -> None:
    _configure_stdio()
    p = argparse.ArgumentParser(description="CursorGate SQLite helper")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("paths")
    sub.add_parser("list")

    e = sub.add_parser("export")
    e.add_argument("--id", required=True)
    e.add_argument("--out", required=True)

    s = sub.add_parser("stage-import")
    s.add_argument("--bundle", required=True)
    s.add_argument("--staging", required=True)

    args = p.parse_args()

    if args.cmd == "paths":
        db = global_db_path()
        print(
            json.dumps(
                {
                    "userDir": str(cursor_user_dir()),
                    "globalDb": str(db),
                    "exists": db.exists(),
                }
            )
        )
        return

    if args.cmd == "stage-import":
        stage_import(Path(args.bundle), Path(args.staging))
        return

    snap = copy_db_snapshot(global_db_path())
    conn = open_ro(snap)
    try:
        if args.cmd == "list":
            print(json.dumps(list_composers(conn), ensure_ascii=False))
        elif args.cmd == "export":
            data = export_composer(conn, args.id)
            out_path = Path(args.out)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(data, ensure_ascii=False, indent=2)
            out_path.write_text(payload, encoding="utf-8")
            digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
            print(json.dumps({"ok": True, "out": str(out_path), "sha256": digest}))
    finally:
        conn.close()
        # Best-effort cleanup of snapshot dir
        try:
            shutil.rmtree(snap.parent, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
