import { getUploadUri } from "./utils";

export type FileSnapshot = {
  uri: string;
  filename: string;
  mimeType: string;
  channelId?: string;
  size: number;
};

export function captureSnapshot(media: any): FileSnapshot | null {
  let uri = getUploadUri(media);
  if (!uri || typeof uri !== "string") return null;

  // Discord sometimes gives absolute paths without the file:// scheme.
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

function xhrPostForm(
  url: string,
  formData: FormData
): Promise<{ ok: boolean; text: string; status: number }> {
  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.onload = () => {
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          text: String(xhr.responseText ?? ""),
          status: xhr.status,
        });
      };
      xhr.onerror = () => {
        resolve({ ok: false, text: "network error", status: 0 });
      };
      xhr.ontimeout = () => {
        resolve({ ok: false, text: "timeout", status: 0 });
      };
      xhr.timeout = 10 * 60 * 1000;
      xhr.send(formData as any);
    } catch (e: any) {
      resolve({ ok: false, text: String(e?.message ?? e), status: 0 });
    }
  });
}

async function postForm(
  url: string,
  formData: FormData
): Promise<{ ok: boolean; text: string; status: number }> {
  // Prefer XHR — Discord's RN fetch often mishandles FormData file URIs.
  const viaXhr = await xhrPostForm(url, formData);
  if (viaXhr.text.startsWith("https://") || viaXhr.status > 0) return viaXhr;

  try {
    const response = await fetch(url, { method: "POST", body: formData });
    const text = await response.text();
    return { ok: response.ok, text, status: response.status };
  } catch (e: any) {
    return {
      ok: false,
      text: viaXhr.text || String(e?.message ?? e),
      status: 0,
    };
  }
}

function buildFilePart(snap: FileSnapshot) {
  return {
    uri: snap.uri,
    name: snap.filename,
    type: snap.mimeType,
  } as any;
}

export type UploadResult = { link: string | null; error?: string };

export async function uploadToLitterbox(
  mediaOrSnap: any,
  duration = "12h"
): Promise<UploadResult> {
  const snap: FileSnapshot | null =
    mediaOrSnap?.uri && mediaOrSnap?.filename
      ? mediaOrSnap
      : captureSnapshot(mediaOrSnap);

  if (!snap?.uri) return { link: null, error: "missing file URI" };

  try {
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", duration);
    formData.append("fileToUpload", buildFilePart(snap));

    const { text, status } = await postForm(
      "https://litterbox.catbox.moe/resources/internals/api.php",
      formData
    );

    if (text.startsWith("https://")) return { link: text };
    return {
      link: null,
      error: `Litterbox HTTP ${status}: ${text.slice(0, 120) || "empty"}`,
    };
  } catch (err: any) {
    console.error("[AutoCompress] Litterbox upload failed:", err);
    return { link: null, error: String(err?.message ?? err) };
  }
}

export async function uploadToCatbox(mediaOrSnap: any): Promise<UploadResult> {
  const snap: FileSnapshot | null =
    mediaOrSnap?.uri && mediaOrSnap?.filename
      ? mediaOrSnap
      : captureSnapshot(mediaOrSnap);

  if (!snap?.uri) return { link: null, error: "missing file URI" };

  try {
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", buildFilePart(snap));

    const { text, status } = await postForm(
      "https://catbox.moe/user/api.php",
      formData
    );

    if (text.startsWith("https://")) return { link: text };
    return {
      link: null,
      error: `Catbox HTTP ${status}: ${text.slice(0, 120) || "empty"}`,
    };
  } catch (err: any) {
    console.error("[AutoCompress] Catbox upload failed:", err);
    return { link: null, error: String(err?.message ?? err) };
  }
}

/** Try preferred host, then the other. */
export async function uploadExternal(
  snap: FileSnapshot,
  preferred: "litterbox" | "catbox"
): Promise<UploadResult & { host: string }> {
  const order =
    preferred === "catbox"
      ? (["catbox", "litterbox"] as const)
      : (["litterbox", "catbox"] as const);

  let last: UploadResult = { link: null, error: "no attempt" };
  for (const host of order) {
    last =
      host === "catbox"
        ? await uploadToCatbox(snap)
        : await uploadToLitterbox(snap, "12h");
    if (last.link) return { ...last, host };
  }
  return { ...last, host: preferred };
}
