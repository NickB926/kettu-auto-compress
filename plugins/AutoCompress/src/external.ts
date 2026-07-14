import { ReactNative } from "@vendetta/metro/common";

import { maxBytes, MB } from "./config";
import { applyCompressedUri, getUploadUri } from "./utils";

export type FileSnapshot = {
  uri: string;
  filename: string;
  mimeType: string;
  channelId?: string;
  size: number;
  durationSecs?: number;
};

export type UploadResult = {
  link: string | null;
  error?: string;
  host?: string;
  localUri?: string;
  localSize?: number;
};

export function captureSnapshot(media: any): FileSnapshot | null {
  let uri = getUploadUri(media);
  if (!uri || typeof uri !== "string") return null;

  if (
    (uri.startsWith("/") || /^[A-Za-z]:[\\/]/.test(uri)) &&
    !uri.startsWith("file:") &&
    !/^https?:/i.test(uri) &&
    !uri.startsWith("content:")
  ) {
    uri = "file://" + uri;
  }

  return {
    uri,
    filename:
      media?.filename ??
      media?.item?.filename ??
      media?.name ??
      media?.item?.name ??
      "upload.bin",
    mimeType:
      media?.mimeType ??
      media?.item?.mimeType ??
      media?.contentType ??
      "application/octet-stream",
    channelId: media?.channelId,
    size:
      media?.preCompressionSize ||
      media?.currentSize ||
      media?.size ||
      media?.item?.size ||
      0,
    durationSecs: media?.durationSecs,
  };
}

function withExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("mp4") || mime.includes("video")) return `${filename}.mp4`;
  if (mime.includes("quicktime") || mime.includes("mov")) return `${filename}.mov`;
  return `${filename}.mp4`;
}

function normalizeMime(mimeType: string, filename: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

export function cleanHostedUrl(raw: string): string | null {
  if (!raw) return null;
  let u = String(raw)
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/[>"']+$/g, "");

  if (u.startsWith("//")) u = "https:" + u;
  if (!/^https?:\/\//i.test(u)) return null;
  u = u.replace(/^http:\/\//i, "https://");
  try {
    return new URL(u).toString();
  } catch {
    return null;
  }
}

function filePart(snap: FileSnapshot, filename: string, mime: string) {
  return { uri: snap.uri, name: filename, type: mime } as any;
}

const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

async function postForm(
  url: string,
  formData: FormData,
  headers?: Record<string, string>
): Promise<{
  text: string;
  status: number;
  url: string;
  location?: string;
  json?: any;
}> {
  const hdrs = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...(headers || {}),
  };

  // Prefer XHR: responseURL reflects redirects (RN fetch often does not).
  const viaXhr = await new Promise<{
    text: string;
    status: number;
    url: string;
    location?: string;
    json?: any;
  } | null>((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.timeout = 300_000;
      for (const [k, v] of Object.entries(hdrs)) {
        try {
          xhr.setRequestHeader(k, v);
        } catch {}
      }
      xhr.onload = () => {
        const text = String(xhr.responseText ?? "");
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {}
        let location: string | undefined;
        try {
          location = xhr.getResponseHeader("Location") || undefined;
        } catch {}
        resolve({
          text,
          status: xhr.status,
          url: xhr.responseURL || url,
          location,
          json,
        });
      };
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () =>
        resolve({ text: "timeout", status: 0, url });
      xhr.send(formData as any);
    } catch {
      resolve(null);
    }
  });
  if (viaXhr) return viaXhr;

  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers: hdrs,
      redirect: "follow",
    } as any);
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      text,
      status: response.status,
      url: (response as any).url || url,
      location: response.headers?.get?.("Location") || undefined,
      json,
    };
  } catch (e: any) {
    return { text: String(e?.message ?? e), status: 0, url };
  }
}

export async function cacheRemoteFile(
  url: string,
  filename: string
): Promise<{ uri: string; size: number } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob: any = await res.blob();
    const size = Number(blob?.size ?? 0);

    const nestedUri =
      blob?.data?.uri ||
      blob?._data?.uri ||
      blob?.uri ||
      (typeof blob?.blobId === "string" ? `blob:${blob.blobId}` : null);

    if (typeof nestedUri === "string" && nestedUri.length > 0) {
      return { uri: nestedUri, size: size || 0 };
    }

    const mods = (ReactNative as any)?.NativeModules ?? {};
    const FM =
      mods.DCDFileManager ||
      mods.FileManager ||
      mods.RNFSManager ||
      mods.NativeFileSystem;

    const base64: string = await new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = String(reader.result ?? "");
          const comma = result.indexOf(",");
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("FileReader failed"));
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });

    const safeName =
      filename.replace(/[^\w.\-]+/g, "_") || `ac_${Date.now()}.mp4`;
    const cacheRoot =
      FM?.cacheDirectory ||
      FM?.CachesDirectoryPath ||
      FM?.TemporaryDirectoryPath ||
      "";

    if (typeof FM?.writeFile === "function" && cacheRoot) {
      const path = `${String(cacheRoot).replace(/\/$/, "")}/${safeName}`;
      const bare = path.replace(/^file:\/\//, "");
      await FM.writeFile(bare, base64, "base64");
      return { uri: path.startsWith("file:") ? path : `file://${bare}`, size };
    }

    if (typeof FM?.saveFile === "function") {
      const path = await FM.saveFile(safeName, base64);
      if (typeof path === "string" && path) {
        return {
          uri: path.startsWith("file:") ? path : `file://${path}`,
          size,
        };
      }
    }

    return null;
  } catch (e) {
    console.warn("[AutoCompress] cacheRemoteFile failed:", e);
    return null;
  }
}

function targetBitrateKbps(targetBytes: number, durationSecs?: number): number {
  const dur = Math.max(1, durationSecs || 40);
  const totalBits = targetBytes * 0.82 * 8;
  const audioBits = 96_000;
  const videoBps = Math.max(250_000, totalBits / dur - audioBits);
  return Math.min(4000, Math.max(250, Math.floor(videoBps / 1000)));
}

function parseEzgifOutput(html: string): string | null {
  // Real ezgif output uses CDN hosts like //s1.ezgif.com/tmp/â€¦ (not ezgif.com/tmp).
  const patterns = [
    /src=["']((?:https?:)?\/\/s\d+\.ezgif\.com\/tmp\/[^"']+)["']/i,
    /href=["']((?:https?:)?\/\/s\d+\.ezgif\.com\/tmp\/[^"']+)["']/i,
    /src=["']((?:https?:)?\/\/(?:www\.)?ezgif\.com\/tmp\/[^"']+)["']/i,
    /href=["']((?:https?:)?\/\/(?:www\.)?ezgif\.com\/tmp\/[^"']+)["']/i,
    /((?:https?:)?\/\/s\d+\.ezgif\.com\/tmp\/[a-z0-9._-]+\.(?:mp4|webm|mov|mkv))/i,
    /href=["'](\/tmp\/[^"']+\.(?:mp4|webm|mov|mkv))["']/i,
    /src=["'](\/tmp\/[^"']+\.(?:mp4|webm|mov|mkv))["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      let u = m[1];
      if (u.startsWith("//")) u = "https:" + u;
      if (u.startsWith("/")) u = "https://s1.ezgif.com" + u;
      return cleanHostedUrl(u);
    }
  }
  return null;
}

function parseEzgifEditUrl(
  finalUrl: string,
  location: string | undefined,
  html: string
): string | null {
  const candidates = [location, finalUrl];
  for (const c of candidates) {
    if (c && /ezgif\.com\/video-compressor\/[^\s"'<>]+/i.test(c)) {
      const m = c.match(
        /https?:\/\/(?:www\.)?ezgif\.com\/video-compressor\/[a-z0-9._-]+(?:\.html)?/i
      );
      if (m) return m[0].replace(/\.html$/i, "") + ".html";
    }
  }
  const fromHtml = html.match(
    /(?:https?:)?\/\/(?:www\.)?ezgif\.com\/video-compressor\/([a-z0-9._-]+)/i
  );
  if (fromHtml) {
    const path = fromHtml[0].startsWith("http")
      ? fromHtml[0]
      : "https:" + fromHtml[0];
    return path.replace(/\.html$/i, "") + ".html";
  }
  // Relative links on the edit page after a followed redirect
  const rel = html.match(
    /(?:action|href)=["']\/video-compressor\/([a-z0-9._-]+)/i
  );
  if (rel?.[1]) {
    return `https://ezgif.com/video-compressor/${rel[1].replace(/\.html$/i, "")}.html`;
  }
  return null;
}

/** Stage via Litterbox so ezgif can import by URL (more reliable than RN file FormData). */
async function stageToLitterbox(snap: FileSnapshot): Promise<string | null> {
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "1h");
  form.append("fileToUpload", filePart(snap, filename, mime));
  const res = await postForm(
    "https://litterbox.catbox.moe/resources/internals/api.php",
    form
  );
  return cleanHostedUrl(res.text);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBytesSafe(bytes: number): string {
  if (!bytes) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

async function getText(
  url: string
): Promise<{ text: string; status: number; url: string }> {
  try {
    const xhrResult = await new Promise<{
      text: string;
      status: number;
      url: string;
    } | null>((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", url);
        xhr.timeout = 120_000;
        try {
          xhr.setRequestHeader("User-Agent", BROWSER_UA);
        } catch {}
        xhr.onload = () =>
          resolve({
            text: String(xhr.responseText ?? ""),
            status: xhr.status,
            url: xhr.responseURL || url,
          });
        xhr.onerror = () => resolve(null);
        xhr.ontimeout = () => resolve({ text: "timeout", status: 0, url });
        xhr.send();
      } catch {
        resolve(null);
      }
    });
    if (xhrResult) return xhrResult;
  } catch {}

  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA },
  } as any);
  return {
    text: await res.text(),
    status: res.status,
    url: (res as any).url || url,
  };
}
/** Same as opening the tool page and waiting for the video preview to finish loading. */
async function waitForEzgifReady(
  editUrl: string
): Promise<{ ok: boolean; durationSecs?: number; html: string }> {
  let lastHtml = "";
  for (let i = 0; i < 30; i++) {
    const page = await getText(editUrl);
    lastHtml = page.text || "";
    const ready =
      /name="bitrate"/i.test(lastHtml) &&
      (/<video[\s>]/i.test(lastHtml) ||
        /filestats/i.test(lastHtml) ||
        /source\s+src=/i.test(lastHtml) ||
        /Recompress video/i.test(lastHtml));
    if (ready && page.status >= 200 && page.status < 400) {
      const lengthMatch = lastHtml.match(
        /length:\s*(\d{1,2}):(\d{2}):(\d{2})/i
      );
      let durationSecs: number | undefined;
      if (lengthMatch) {
        durationSecs =
          parseInt(lengthMatch[1], 10) * 3600 +
          parseInt(lengthMatch[2], 10) * 60 +
          parseInt(lengthMatch[3], 10);
      }
      await sleep(1500);
      return { ok: true, durationSecs, html: lastHtml };
    }
    await sleep(2000);
  }
  return { ok: false, html: lastHtml };
}

async function ezgifRecompress(
  editUrl: string,
  fileId: string,
  resolution: string,
  bitrate: number
): Promise<{ outUrl: string | null; text: string; status: number }> {
  const form = new FormData();
  form.append("file", fileId);
  form.append("resolution", resolution);
  form.append("bitrate", String(bitrate));
  form.append("format", "mp4");
  form.append("video-compressor", "Recompress video!");
  form.append("ajax", "true");

  const second = await postForm(`${editUrl}?ajax=true`, form);
  return {
    outUrl: parseEzgifOutput(second.text),
    text: second.text,
    status: second.status,
  };
}

/** Upload â†’ wait load â†’ one-shot compress (one retry) â†’ download if under limit. */
export async function compressWithEzgif(
  snap: FileSnapshot
): Promise<UploadResult> {
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const limit = maxBytes();

  let first: Awaited<ReturnType<typeof postForm>> | null = null;
  let staged: string | null = null;
  try {
    staged = await stageToLitterbox(snap);
  } catch (e) {
    console.warn("[AutoCompress] litterbox stage failed:", e);
  }

  if (staged) {
    const up = new FormData();
    up.append("new-image-url", staged);
    up.append("upload", "Upload video!");
    first = await postForm("https://ezgif.com/video-compressor", up);
  }

  if (!first || !parseEzgifEditUrl(first.url, first.location, first.text)) {
    const up = new FormData();
    up.append("new-image", filePart(snap, filename, mime));
    up.append("upload", "Upload video!");
    first = await postForm("https://ezgif.com/video-compressor", up);
  }

  const redir = parseEzgifEditUrl(first.url, first.location, first.text);
  if (!redir) {
    return {
      link: null,
      host: "ezgif",
      error: `ezgif upload failed (HTTP ${first.status}${staged ? ", staged" : ""})`,
    };
  }

  const id = redir.split("/").pop()!.replace(/\.html$/i, "");

  const ready = await waitForEzgifReady(redir);
  if (!ready.ok) {
    return {
      link: null,
      host: "ezgif",
      error: "ezgif never finished loading the video",
    };
  }

  const durationSecs = Math.max(
    1,
    ready.durationSecs || snap.durationSecs || 40
  );
  const aimBytes = Math.floor(limit * 0.9);

  const resolution =
    durationSecs > 90
      ? "426x240"
      : durationSecs > 45
        ? "640x360"
        : durationSecs > 20
          ? "854x480"
          : "1280x720";

  let bitrate = targetBitrateKbps(aimBytes, durationSecs);
  bitrate = Math.min(2000, Math.max(200, bitrate));

  const attempts: Array<{ resolution: string; bitrate: number }> = [
    { resolution, bitrate },
    {
      resolution:
        resolution === "1280x720"
          ? "854x480"
          : resolution === "854x480"
            ? "640x360"
            : resolution === "640x360"
              ? "426x240"
              : "320x240",
      bitrate: Math.max(150, Math.floor(bitrate * 0.5)),
    },
  ];

  let lastError = "ezgif compress failed";
  let lastUrl: string | null = null;

  for (let i = 0; i < attempts.length; i++) {
    const pass = attempts[i];
    const { outUrl, text, status } = await ezgifRecompress(
      redir,
      id,
      pass.resolution,
      pass.bitrate
    );

    if (!outUrl) {
      lastError = `ezgif compress failed (HTTP ${status})`;
      await sleep(1500);
      continue;
    }
    lastUrl = outUrl;

    const reported = parseEzgifFileSizeBytes(text);
    if (reported && reported > limit) {
      if (i === 0) continue;
      lastError = `still ${formatBytesSafe(reported)} after 2 passes`;
      break;
    }

    const cached = await cacheRemoteFile(outUrl, `ac_ezgif_${Date.now()}.mp4`);
    const size = cached?.size || reported || 0;

    if (cached?.uri && (!size || size <= limit)) {
      return {
        link: outUrl,
        host: "ezgif",
        localUri: cached.uri,
        localSize: size || reported || undefined,
      };
    }

    if (cached?.uri && size > limit && i === 0) continue;

    if (cached?.uri) {
      return {
        link: outUrl,
        host: "ezgif",
        localUri: cached.uri,
        localSize: size,
        error:
          size > limit
            ? `still ${formatBytesSafe(size)} after passes`
            : undefined,
      };
    }

    lastError = "ezgif OK but couldn't save into Discord cache";
  }

  if (lastUrl) {
    return { link: lastUrl, host: "ezgif", error: lastError };
  }
  return { link: null, host: "ezgif", error: lastError };
}

function parseEzgifFileSizeBytes(html: string): number | null {
  const m = html.match(
    /File size:\s*<strong>\s*([\d.]+)\s*(KiB|KB|MiB|MB|GiB|GB|B)\s*<\/strong>/i
  );
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toUpperCase();
  if (unit === "B") return Math.round(n);
  if (unit === "KIB" || unit === "KB") return Math.round(n * 1024);
  if (unit === "MIB" || unit === "MB") return Math.round(n * 1024 * 1024);
  if (unit === "GIB" || unit === "GB") return Math.round(n * 1024 * 1024 * 1024);
  return null;
}

export async function uploadExternal(
  snap: FileSnapshot
): Promise<UploadResult & { host: string }> {
  const r = await compressWithEzgif(snap);
  return { ...r, host: r.host || "ezgif" };
}

export function applyLocalToMedia(
  media: any,
  localUri: string,
  size?: number
): void {
  applyCompressedUri(media, localUri, size);
  media.mimeType = media.mimeType || "video/mp4";
  if (media.filename && !/\.mp4$/i.test(media.filename)) {
    media.filename = withExtension(media.filename, "video/mp4");
  }
}
