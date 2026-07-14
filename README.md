# AutoCompress (Kettu / Revenge / Bunny)

Best-effort plugin that keeps Discord mobile video (and optional image) uploads under a size limit (**default 24MB**).

If Discord’s own compressor still can’t get the file under the limit (common without FFmpeg), **v1.3+** uploads to **Litterbox/Catbox** and sends a link instead — that’s what actually works day-to-day on Kettu.

## Install on your phone

1. Open **Kettu** / **Revenge** / **Bunny**
2. Go to **Plugins** → **Install from URL** (or equivalent)
3. Paste this URL exactly:

```
https://nickb926.github.io/kettu-auto-compress/AutoCompress
```

4. Enable **AutoCompress**
5. Attach a video over 20MB and watch for compress toasts

If install fails, wait a minute after a new push (GitHub Pages needs to finish deploying), then try again.

## What it does

1. Hooks `CloudUpload.reactNativeCompressAndExtractData`
2. If a video (or optionally image) is over the limit:
   - Shows a toast
   - Runs Discord’s built-in native compressor
   - Probes optional native compress bridges if present
   - **Blocks the send** if still over the limit (default)

## What it is not

Pure Kettu plugins cannot ship FFmpeg. This is not desktop Vencord AutoCompress. Long / high-bitrate clips may still fail to land under 20MB.

## Settings

| Setting | Default | Notes |
|--------|---------|--------|
| Max size (MB) | `20` | Raise toward `25` if your account allows it |
| Videos | on | Main use case |
| Images | on | Discord compress + block-on-fail |
| Block send if still too large | on | Safer than a doomed upload |
| Show toasts | on | Progress / results |

## Develop locally

```bash
npm install --legacy-peer-deps
npm run build
npx --yes http-server dist -p 8731
```

Then install `http://YOUR_LAN_IP:8731/AutoCompress` from the phone (same Wi‑Fi).

Pushes to `main` rebuild and publish to GitHub Pages automatically.

## Repo

- Source: https://github.com/NickB926/kettu-auto-compress
- Install URL: https://nickb926.github.io/kettu-auto-compress/AutoCompress
