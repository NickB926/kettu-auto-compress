# AutoCompress (Kettu / Revenge / Bunny)

Best-effort plugin that keeps Discord mobile video (and optional image) uploads under a size limit (**default 24MB**).

When Discord’s own compressor can’t get under the limit (no FFmpeg in stock Revenge/Kettu), the plugin uses a **website-style remux** service (like ezgif / FreeConvert), downloads the result, and **re-attaches it as a normal Discord video** when possible.

## Install on your phone

1. Open **Kettu** / **Revenge** / **Bunny**
2. Go to **Plugins** → **Install from URL** (or equivalent)
3. Paste this URL exactly:

```
https://nickb926.github.io/kettu-auto-compress/AutoCompress
```

4. Enable **AutoCompress**
5. In plugin settings, leave provider on **ezgif** (no account), or set FreeConvert / Cloudinary / Catbox
6. Attach a video over ~20MB and watch for compress toasts

If install fails, wait a minute after a new push (GitHub Pages needs to finish deploying), then **Refetch**.

## Providers

| Provider | Account? | Result |
|----------|----------|--------|
| **ezgif** (default) | No | Compress via ezgif.com form → prefer Discord native video |
| **FreeConvert** | API key | Official compress API → prefer Discord native video |
| **Cloudinary** | Free unsigned preset | Remote transform → prefer Discord native video |
| **Catbox** | Userhash | Link only (often weak embeds) |

## What it is not

Pure Kettu plugins cannot ship FFmpeg. This is not desktop Vencord AutoCompress. ezgif is **unofficial form automation** (same as their website); it can break if their HTML changes.

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
