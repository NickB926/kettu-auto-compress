import { getUploadUri } from "./utils";
import { getCatboxUserhash } from "./config";

const CATBOX_API = "https://catbox.moe/user/api.php";

export type FileSnapshot = {
  uri: string;
  filename: string;
  mimeType: string;
  channelId?: string;
  size: number;
};

export type UploadResult = { link: string | null; error?: string; host?: string };

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
  if (mime.includes("webp")) return `${filename}.webp`;
  if (mime.includes("gif")) return `${filename}.gif`;
  return `${filename}.bin`;
}

function normalizeMime(mimeType: string, filename: string): string {
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return mimeType || "application/octet-stream";
}

function parseCatboxResponse(
  text: string,
  status: number
): UploadResult {
  const cleaned = cleanHostedUrl(text);
  if (cleaned) {
    return { link: cleaned, host: "catbox" };
  }

  const trimmed = (text || "").trim();
  const lower = trimmed.toLowerCase();
  if (status === 412 || lower.includes("invalid uploader")) {
    return {
      link: null,
      host: "catbox",
      error:
        "Invalid uploader — Catbox rejected the userhash (re-copy from catbox.moe account page)",
    };
  }

  return {
    link: null,
    host: "catbox",
    error: `Catbox HTTP ${status}: ${trimmed.slice(0, 140) || "empty"}`,
  };
}

/** Pull a usable HTTPS Catbox URL out of the API response. */
export function cleanHostedUrl(raw: string): string | null {
  if (!raw) return null;
  // First token/line only — APIs sometimes append junk.
  let u = String(raw)
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/[>"']+$/g, "");

  if (!/^https?:\/\//i.test(u)) return null;
  u = u.replace(/^http:\/\//i, "https://");

  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    // Only trust Catbox hosts (files / litter / litterbox).
    if (!host.endsWith("catbox.moe")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function postFormData(
  formData: FormData
): Promise<{ text: string; status: number }> {
  // Fetch first (matches working Vendetta Catbox plugins).
  try {
    const response = await fetch(CATBOX_API, {
      method: "POST",
      body: formData,
    });
    return { text: await response.text(), status: response.status };
  } catch (fetchErr) {
    // XHR backup
    return await new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", CATBOX_API);
        xhr.timeout = 120_000;
        xhr.onload = () =>
          resolve({
            text: String(xhr.responseText ?? ""),
            status: xhr.status,
          });
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

/** Try reading the local URI as a Blob — Catbox is pickier than Litterbox. */
async function tryBlobUpload(
  snap: FileSnapshot,
  hash: string,
  filename: string,
  mime: string
): Promise<UploadResult | null> {
  try {
    const fileRes = await fetch(snap.uri);
    const blob = await fileRes.blob();
    if (!blob || (blob as any).size === 0) return null;

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("userhash", hash);
    // RN accepts (blob, filename) on some builds; object form on others.
    try {
      formData.append("fileToUpload", blob as any, filename);
    } catch {
      formData.append("fileToUpload", {
        uri: snap.uri,
        name: filename,
        type: mime,
      } as any);
    }

    const { text, status } = await postFormData(formData);
    const parsed = parseCatboxResponse(text, status);
    if (parsed.link) return parsed;
    // Keep trying other strategies unless hash is clearly wrong.
    if (status === 412 || (text || "").toLowerCase().includes("invalid uploader"))
      return parsed;
    return null;
  } catch {
    return null;
  }
}

async function tryUriUpload(
  snap: FileSnapshot,
  hash: string,
  filename: string,
  mime: string
): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("reqtype", "fileupload");
  formData.append("userhash", hash);
  formData.append("fileToUpload", {
    uri: snap.uri,
    name: filename,
    type: mime,
  } as any);

  const { text, status } = await postFormData(formData);
  return parseCatboxResponse(text, status);
}

export async function uploadToCatbox(
  mediaOrSnap: any,
  userhash?: string
): Promise<UploadResult> {
  const snap: FileSnapshot | null =
    mediaOrSnap?.uri && mediaOrSnap?.filename
      ? mediaOrSnap
      : captureSnapshot(mediaOrSnap);

  if (!snap?.uri) return { link: null, host: "catbox", error: "missing file URI" };

  const hash = (userhash ?? getCatboxUserhash()).trim();
  if (!hash) {
    return {
      link: null,
      host: "catbox",
      error:
        "No Catbox userhash set — open AutoCompress settings and paste it from catbox.moe",
    };
  }

  const filename = withExtension(snap.filename || "upload", snap.mimeType);
  const mime = normalizeMime(snap.mimeType, filename);

  // 1) Blob path (often matches what the website does)
  const viaBlob = await tryBlobUpload(snap, hash, filename, mime);
  if (viaBlob?.link) return viaBlob;
  if (viaBlob?.error?.toLowerCase().includes("invalid uploader")) return viaBlob;

  // 2) Classic RN { uri, name, type } (same shape Litterbox accepted)
  const viaUri = await tryUriUpload(snap, hash, filename, mime);
  if (viaUri.link) return viaUri;

  return (
    viaUri.error
      ? viaUri
      : viaBlob ?? {
          link: null,
          host: "catbox",
          error: "Catbox upload failed (blob + uri)",
        }
  );
}

/** Catbox only. */
export async function uploadExternal(
  snap: FileSnapshot,
  _preferred?: string,
  catboxUserhash?: string
): Promise<UploadResult & { host: string }> {
  const result = await uploadToCatbox(snap, catboxUserhash);
  return { ...result, host: "catbox" };
}
