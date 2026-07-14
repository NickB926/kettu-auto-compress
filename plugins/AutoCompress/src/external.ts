import { ReactNative } from "@vendetta/metro/common";

import {
  getCatboxUserhash,
  getCloudinaryConfig,
  maxBytes,
  MB,
} from "./config";
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

export type Provider = "ezgif" | "freeconvert" | "cloudinary" | "catbox";

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

async function postForm(
  url: string,
  formData: FormData,
  headers?: Record<string, string>
): Promise<{ text: string; status: number; url: string; json?: any }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      body: formData,
      headers,
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
      json,
    };
  } catch (fetchErr) {
    return await new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.timeout = 300_000;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
        }
        xhr.onload = () => {
          const text = String(xhr.responseText ?? "");
          let json: any;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({
            text,
            status: xhr.status,
            url: xhr.responseURL || url,
            json,
          });
        };
        xhr.onerror = () =>
          resolve({
            text: `network error (${fetchErr})`,
            status: 0,
            url,
          });
        xhr.ontimeout = () => resolve({ text: "timeout", status: 0, url });
        xhr.send(formData as any);
      } catch (e: any) {
        resolve({ text: String(e?.message ?? e), status: 0, url });
      }
    });
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

function pickResolution(targetBytes: number): string {
  // Keep resolution modest so Discord limit is reachable.
  if (targetBytes <= 12 * MB) return "640x360";
  if (targetBytes <= 20 * MB) return "854x480";
  return "1280x720";
}

function parseEzgifOutput(html: string): string | null {
  const patterns = [
    /href="((?:https?:)?\/\/ezgif\.com\/tmp\/[^"]+)"/i,
    /href="(\/tmp\/[^"]+\.(?:mp4|webm|mov|mkv))"/i,
    /src="((?:https?:)?\/\/ezgif\.com\/tmp\/[^"]+)"/i,
    /"(https:\/\/ezgif\.com\/tmp\/[^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      let u = m[1];
      if (u.startsWith("//")) u = "https:" + u;
      if (u.startsWith("/")) u = "https://ezgif.com" + u;
      return cleanHostedUrl(u);
    }
  }
  return null;
}

/** Unofficial ezgif form scrape — same site UI flow, no account. */
export async function compressWithEzgif(
  snap: FileSnapshot
): Promise<UploadResult> {
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const limit = maxBytes();
  const bitrate = targetBitrateKbps(limit, snap.durationSecs);
  const resolution = pickResolution(limit);

  // 1) Upload
  const up = new FormData();
  up.append("new-image", filePart(snap, filename, mime));

  const first = await postForm("https://ezgif.com/video-compressor", up);
  let redir = first.url || "";
  if (!/ezgif\.com\/video-compressor\//i.test(redir)) {
    // Sometimes body contains the edit URL
    const m = first.text.match(
      /https?:\/\/ezgif\.com\/video-compressor\/[a-z0-9-]+/i
    );
    if (m) redir = m[0];
  }
  if (!/ezgif\.com\/video-compressor\//i.test(redir)) {
    return {
      link: null,
      host: "ezgif",
      error: `ezgif upload failed (HTTP ${first.status})`,
    };
  }

  const id = redir.split("/").pop()!.replace(/\.html$/i, "");

  // 2) Compress (ajax)
  const form = new FormData();
  form.append("file", id);
  form.append("resolution", resolution);
  form.append("bitrate", String(bitrate));
  form.append("format", "mp4");
  form.append("ajax", "true");

  const second = await postForm(`${redir}?ajax=true`, form);
  const outUrl = parseEzgifOutput(second.text);
  if (!outUrl) {
    return {
      link: null,
      host: "ezgif",
      error: `ezgif compress failed (HTTP ${second.status})`,
    };
  }

  const cached = await cacheRemoteFile(
    outUrl,
    `ac_ezgif_${Date.now()}.mp4`
  );
  if (cached?.uri) {
    return {
      link: outUrl,
      host: "ezgif",
      localUri: cached.uri,
      localSize: cached.size || undefined,
    };
  }

  // Link-only fallback if we couldn't cache locally
  return { link: outUrl, host: "ezgif" };
}

/** FreeConvert official API — needs Bearer access token. */
export async function compressWithFreeConvert(
  snap: FileSnapshot,
  apiKey: string
): Promise<UploadResult> {
  const key = apiKey.trim();
  if (!key) {
    return {
      link: null,
      host: "freeconvert",
      error: "Set FreeConvert API key in settings",
    };
  }

  const auth = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const limit = maxBytes();
  const bitrate = targetBitrateKbps(limit, snap.durationSecs);
  const [rw, rh] = pickResolution(limit).split("x");

  // 1) Create standalone upload task → pre-signed form
  const uploadTaskRes = await fetch(
    "https://api.freeconvert.com/v1/process/import/upload",
    { method: "POST", headers: auth }
  );
  const uploadTask = await uploadTaskRes.json().catch(() => null);
  const formMeta = uploadTask?.result?.form;
  if (!uploadTaskRes.ok || !uploadTask?.id || !formMeta?.url) {
    return {
      link: null,
      host: "freeconvert",
      error: `FreeConvert upload init: ${uploadTask?.message || uploadTaskRes.status}`,
    };
  }

  const form = new FormData();
  for (const [k, v] of Object.entries(formMeta.parameters || {})) {
    form.append(k, String(v));
  }
  form.append("file", filePart(snap, filename, mime));

  const up = await postForm(formMeta.url, form);
  if (up.status < 200 || up.status >= 300) {
    return {
      link: null,
      host: "freeconvert",
      error: `FreeConvert upload HTTP ${up.status}`,
    };
  }

  // 2) Job: compress + export using uploaded task id
  const jobRes = await fetch("https://api.freeconvert.com/v1/process/jobs", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      tasks: {
        "compress-1": {
          operation: "compress",
          input: uploadTask.id,
          input_format: "mp4",
          output_format: "mp4",
          options: {
            video_codec: "h264",
            video_bitrate: bitrate,
            width: Number(rw) || 854,
            height: Number(rh) || 480,
          },
        },
        "export-1": {
          operation: "export/url",
          input: ["compress-1"],
          filename: `ac_${Date.now()}.mp4`,
        },
      },
    }),
  });
  const job = await jobRes.json().catch(() => null);
  if (!jobRes.ok || !job?.id) {
    return {
      link: null,
      host: "freeconvert",
      error: `FreeConvert job: ${job?.message || jobRes.status}`,
    };
  }

  // 3) Poll
  let exportUrl: string | null = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(
      `https://api.freeconvert.com/v1/process/jobs/${job.id}`,
      { headers: auth }
    );
    const body = await poll.json().catch(() => null);
    const status = String(body?.status ?? "").toLowerCase();
    if (
      status === "completed" ||
      status === "job.completed" ||
      status.includes("completed")
    ) {
      const tasks = Array.isArray(body?.tasks)
        ? body.tasks
        : Object.values(body?.tasks || {});
      for (const t of tasks as any[]) {
        const url =
          t?.result?.url ||
          t?.result?.files?.[0]?.url ||
          t?.result?.exportUrl;
        if (url) {
          exportUrl = cleanHostedUrl(url);
          break;
        }
      }
      break;
    }
    if (
      status === "failed" ||
      status === "job.failed" ||
      status.includes("fail")
    ) {
      return {
        link: null,
        host: "freeconvert",
        error: "FreeConvert job failed",
      };
    }
  }

  if (!exportUrl) {
    return {
      link: null,
      host: "freeconvert",
      error: "FreeConvert timed out waiting for output",
    };
  }

  const cached = await cacheRemoteFile(exportUrl, `ac_fc_${Date.now()}.mp4`);
  if (cached?.uri) {
    return {
      link: exportUrl,
      host: "freeconvert",
      localUri: cached.uri,
      localSize: cached.size || undefined,
    };
  }
  return { link: exportUrl, host: "freeconvert" };
}

export async function uploadToCatbox(
  snap: FileSnapshot,
  userhash?: string
): Promise<UploadResult> {
  const hash = (userhash ?? getCatboxUserhash()).trim();
  if (!hash) {
    return { link: null, host: "catbox", error: "No Catbox userhash" };
  }
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const formData = new FormData();
  formData.append("reqtype", "fileupload");
  formData.append("userhash", hash);
  formData.append("fileToUpload", filePart(snap, filename, mime));
  const { text, status } = await postForm(
    "https://catbox.moe/user/api.php",
    formData
  );
  const link = cleanHostedUrl(text);
  if (link) return { link, host: "catbox" };
  return {
    link: null,
    host: "catbox",
    error: `Catbox HTTP ${status}: ${(text || "").slice(0, 100)}`,
  };
}

export async function uploadToCloudinary(
  snap: FileSnapshot
): Promise<UploadResult> {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return {
      link: null,
      host: "cloudinary",
      error: "Cloudinary not configured",
    };
  }
  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
    cfg.cloudName
  )}/video/upload`;
  const formData = new FormData();
  formData.append("upload_preset", cfg.uploadPreset);
  formData.append("file", filePart(snap, filename, mime));
  const { text, status, json } = await postForm(endpoint, formData);
  const secure =
    cleanHostedUrl(json?.secure_url) ||
    cleanHostedUrl(json?.url) ||
    cleanHostedUrl(text);
  if (!secure) {
    return {
      link: null,
      host: "cloudinary",
      error: `Cloudinary: ${json?.error?.message || status}`,
    };
  }
  const bytes = Number(json?.bytes ?? 0);
  const limit = maxBytes();
  if (!bytes || bytes <= limit) {
    const cached = await cacheRemoteFile(
      secure,
      `ac_cl_${Date.now()}_${filename}`
    );
    if (cached?.uri) {
      return {
        link: secure,
        host: "cloudinary",
        localUri: cached.uri,
        localSize: cached.size || bytes || undefined,
      };
    }
  }
  return { link: secure, host: "cloudinary" };
}

export async function uploadExternal(
  snap: FileSnapshot,
  provider: Provider,
  opts?: { catboxUserhash?: string; freeConvertApiKey?: string }
): Promise<UploadResult & { host: string }> {
  if (provider === "ezgif") {
    const r = await compressWithEzgif(snap);
    if (r.link || r.localUri) return { ...r, host: "ezgif" };
    // Optional Catbox if configured
    if ((opts?.catboxUserhash || getCatboxUserhash()).trim()) {
      const cb = await uploadToCatbox(snap, opts?.catboxUserhash);
      if (cb.link) return { ...cb, host: "catbox", error: r.error };
    }
    return { ...r, host: "ezgif" };
  }
  if (provider === "freeconvert") {
    const r = await compressWithFreeConvert(
      snap,
      opts?.freeConvertApiKey || ""
    );
    return { ...r, host: "freeconvert" };
  }
  if (provider === "cloudinary") {
    const r = await uploadToCloudinary(snap);
    if (r.link || r.localUri) return { ...r, host: "cloudinary" };
    if ((opts?.catboxUserhash || getCatboxUserhash()).trim()) {
      const cb = await uploadToCatbox(snap, opts?.catboxUserhash);
      if (cb.link) return { ...cb, host: "catbox", error: r.error };
    }
    return { ...r, host: "cloudinary" };
  }
  const cb = await uploadToCatbox(snap, opts?.catboxUserhash);
  return { ...cb, host: cb.host || "catbox" };
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
