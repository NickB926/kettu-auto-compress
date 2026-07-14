import { getUploadUri } from "./utils";

/** Temporary file host that accepts large media without an account. */
export async function uploadToLitterbox(
  media: any,
  duration = "12h"
): Promise<string | null> {
  try {
    const fileUri = getUploadUri(media);
    if (!fileUri) throw new Error("Missing file URI");

    const filename =
      media?.filename ?? media?.item?.filename ?? media?.name ?? "video.mp4";
    const mime =
      media?.mimeType ?? media?.item?.mimeType ?? "application/octet-stream";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("time", duration);
    formData.append("fileToUpload", {
      uri: fileUri,
      name: filename,
      type: mime,
    } as any);

    const response = await fetch(
      "https://litterbox.catbox.moe/resources/internals/api.php",
      { method: "POST", body: formData }
    );

    const text = await response.text();
    if (!text.startsWith("https://")) throw new Error(text);
    return text;
  } catch (err) {
    console.error("[AutoCompress] Litterbox upload failed:", err);
    return null;
  }
}

export async function uploadToCatbox(media: any): Promise<string | null> {
  try {
    const fileUri = getUploadUri(media);
    if (!fileUri) throw new Error("Missing file URI");

    const filename =
      media?.filename ?? media?.item?.filename ?? media?.name ?? "video.mp4";
    const mime =
      media?.mimeType ?? media?.item?.mimeType ?? "application/octet-stream";

    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", {
      uri: fileUri,
      name: filename,
      type: mime,
    } as any);

    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData,
    });

    const text = await response.text();
    if (!text.startsWith("https://")) throw new Error(text);
    return text;
  } catch (err) {
    console.error("[AutoCompress] Catbox upload failed:", err);
    return null;
  }
}
