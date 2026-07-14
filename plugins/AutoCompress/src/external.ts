import { ReactNative } from "@vendetta/metro/common";

import {
  getCatboxUserhash,
  getCloudinaryConfig,
  maxBytes,
} from "./config";
import { applyCompressedUri, getUploadUri } from "./utils";

export type FileSnapshot = {
  uri: string;
  filename: string;
  mimeType: string;
  channelId?: string;
  size: number;
};

export type UploadResult = {
  link: string | null;
  error?: string;
  host?: string;
  /** If set, Discord can attach this local file as a real video (native player). */
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
  };
}

function withExtension(filename: string, mimeType: string): string {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("mp4") || mime.includes("video")) return `${filename}.mp4`;
  if (mime.includes("quicktime") || mime.includes("mov")) return `${filename}.mov`;
  if (mime.includes("webm")) return `${filename}.webm`;
  if (mime.includes("png")) return `${filename}.png`;
  if (mime.includes("jpeg") || mime.includes("jpg")) return `${filename}.jpg`;
  return `${filename}.mp4`;
}

function normalizeMime(mimeType: string, filename: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
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
  formData: FormData
): Promise<{ text: string; status: number; json?: any }> {
  try {
    const response = await fetch(url, { method: "POST", body: formData });
    const text = await response.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {}
    return { text, status: response.status, json };
  } catch (fetchErr) {
    return await new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.timeout = 180_000;
        xhr.onload = () => {
          const text = String(xhr.responseText ?? "");
          let json: any;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({ text, status: xhr.status, json });
        };
        xhr.onerror = () =>
          resolve({ text: `network error (${fetchErr})`, status: 0 });
        xhr.ontimeout = () => resolve({ text: "timeout", status: 0 });
        xhr.send(formData as any);
      } catch (e: any) {
        resolve({ text: String(e?.message ?? e), status: 0 });
      }
    });
  }
}

/** Download a remote video into a local RN URI Discord can attach. */
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
        reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });

    const safeName = filename.replace(/[^\w.\-]+/g, "_") || `ac_${Date.now()}.mp4`;
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

export async function uploadToCatbox(
  snap: FileSnapshot,
  userhash?: string
): Promise<UploadResult> {
  const hash = (userhash ?? getCatboxUserhash()).trim();
  if (!hash) {
    return {
      link: null,
      host: "catbox",
      error: "No Catbox userhash in settings",
    };
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

  const lower = (text || "").toLowerCase();
  if (status === 412 || lower.includes("invalid uploader")) {
    return {
      link: null,
      host: "catbox",
      error: "Invalid uploader — fix Catbox userhash",
    };
  }
  return {
    link: null,
    host: "catbox",
    error: `Catbox HTTP ${status}: ${(text || "").slice(0, 120)}`,
  };
}

/**
 * Upload to Cloudinary with an unsigned preset that should include
 * incoming transforms (e.g. q_auto:low, w_720, f_mp4) so the result is small.
 * Then try to cache locally so Discord can attach it (native video player).
 */
export async function uploadToCloudinary(
  snap: FileSnapshot
): Promise<UploadResult> {
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return {
      link: null,
      host: "cloudinary",
      error: "Set Cloudinary cloud name + unsigned upload preset in settings",
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
    const msg =
      json?.error?.message ||
      text?.slice?.(0, 140) ||
      `HTTP ${status}`;
    return { link: null, host: "cloudinary", error: `Cloudinary: ${msg}` };
  }

  const bytes = Number(json?.bytes ?? 0);
  const limit = maxBytes();

  // Prefer re-attaching into Discord when small enough → native embed/player.
  if (!bytes || bytes <= limit) {
    const cached = await cacheRemoteFile(
      secure,
      `ac_${Date.now()}_${filename}`
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

  // Still useful: Cloudinary URLs usually unfurl better than Catbox in Discord.
  return { link: secure, host: "cloudinary" };
}

export async function uploadExternal(
  snap: FileSnapshot,
  provider: "catbox" | "cloudinary",
  catboxUserhash?: string
): Promise<UploadResult & { host: string }> {
  if (provider === "cloudinary") {
    const cl = await uploadToCloudinary(snap);
    if (cl.link || cl.localUri) return { ...cl, host: "cloudinary" };
    // Fall back to Catbox hosting if Cloudinary fails and hash exists.
    if (getCatboxUserhash() || catboxUserhash) {
      const cb = await uploadToCatbox(snap, catboxUserhash);
      return { ...cb, host: cb.host || "catbox" };
    }
    return { ...cl, host: "cloudinary" };
  }

  const cb = await uploadToCatbox(snap, catboxUserhash);
  return { ...cb, host: "catbox" };
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
