# Hex — desktop pet (experimental)

A small Electron tray companion for Blu: a frameless, transparent sprite that sits on the desktop
and opens a chat window positioned to whichever side of it has room.

**Status: experimental, and not currently the primary surface.** WhatsApp is where Blu actually
lives; this and the Expo app in `mobile/` are secondary clients over the same `/api` routes.

## Running it

```bash
cd desktop
npm install
API_BASE=https://your-deployment.vercel.app API_TOKEN=your-dashboard-token npm start
```

On Windows PowerShell:

```powershell
$env:API_BASE="https://your-deployment.vercel.app"; $env:API_TOKEN="your-dashboard-token"; npm start
```

`API_TOKEN` must match `DASHBOARD_TOKEN` in the server environment. See `.env.example`.

## Known gaps

- **Sprite frames are not in the repo.** `FRAMES_DIR` defaults to `desktop/frames`, which does not
  exist yet — the animation assets were never committed, so the pet renders without them. Set
  `PET_FRAMES_DIR` to a directory of PNG frames, or add them here.
- No packaging step; it runs from source only.
