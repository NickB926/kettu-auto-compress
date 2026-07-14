import { findByProps } from "@vendetta/metro";
import { instead, before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";

import { compressUpload, resolveUploadSize } from "./compress";
import { ensureSettings, maxBytes } from "./config";
import {
  formatBytes,
  getUploadSize,
  isImageUpload,
  isVideoUpload,
} from "./utils";

function toast(msg: string, force = false) {
  const s = ensureSettings();
  if (force || s.showToasts || s.debugToasts) showToast(msg);
}

function cancelUpload(media: any) {
  try {
    if (typeof media.setStatus === "function") media.setStatus("CANCELED");
    else if (typeof media.cancel === "function") media.cancel();
    else if (typeof media.removeFromMsgDraft === "function")
      media.removeFromMsgDraft();
  } catch {}
}

async function handleCompress(
  media: any,
  args: any[],
  orig: (...a: any[]) => any
) {
  const settings = ensureSettings();
  const limit = maxBytes();
  const video = isVideoUpload(media);
  const image = isImageUpload(media);

  const cares =
    (settings.compressVideos && video) || (settings.compressImages && image);

  // Resolve size up-front — Discord often leaves preCompressionSize empty
  // until later, which made the old plugin silently skip oversized files.
  let size = await resolveUploadSize(media);

  if (settings.debugToasts) {
    const kind = video ? "video" : image ? "image" : "file";
    const name =
      media?.filename ?? media?.item?.filename ?? media?.name ?? "?";
    toast(
      `AC saw ${kind}: ${name} · ${size ? formatBytes(size) : "size?"} · ≤${settings.maxMB}MB`,
      true
    );
  }

  if (!cares) return orig(...args);

  // Known under-limit → normal Discord path (still compresses lightly itself).
  if (size > 0 && size <= limit) return orig(...args);

  // Unknown size OR oversized → run our pipe (Discord compress → optional native → block).
  const kind = video ? "video" : "image";
  toast(
    `Compressing ${kind}${size ? ` (${formatBytes(size)})` : ""} → ≤${settings.maxMB}MB…`
  );

  try {
    const result = await compressUpload(media, orig, args, limit);
    size = result.finalSize || getUploadSize(media) || size;

    if (result.proceeded && size <= limit) {
      toast(`OK ${formatBytes(size)} via ${result.method}`);
      return result.prepResult;
    }

    if (settings.blockOnFail) {
      toast(
        `Still ${formatBytes(size) || "too big"} after ${result.method}` +
          (result.nativeTried ? "" : " (no extra encoder)") +
          ` — blocked`
      );
      cancelUpload(media);
      return null;
    }

    toast(`Still ${formatBytes(size)} — uploading anyway`);
    return result.prepResult;
  } catch (err) {
    console.error("[AutoCompress] compress failed:", err);
    if (settings.blockOnFail) {
      toast("Compression failed — blocked");
      cancelUpload(media);
      return null;
    }
    toast("Compression failed — original file");
    return orig(...args);
  }
}

export function patchUploader(): () => void {
  const unpatches: Array<() => void> = [];
  let hooked = false;

  // Primary: Discord RN prep/compress (same path catbox / NoCompression use)
  try {
    const mod = findByProps("CloudUpload");
    const CloudUpload = mod?.CloudUpload;
    if (CloudUpload?.prototype?.reactNativeCompressAndExtractData) {
      unpatches.push(
        instead(
          "reactNativeCompressAndExtractData",
          CloudUpload.prototype,
          function (args, orig) {
            const self = this;
            return handleCompress(self, args, (...a: any[]) =>
              orig.apply(self, a)
            );
          }
        )
      );
      hooked = true;
      console.log("[AutoCompress] hooked CloudUpload.reactNativeCompressAndExtractData");
    } else {
      console.warn("[AutoCompress] reactNativeCompressAndExtractData missing");
    }
  } catch (e) {
    console.error("[AutoCompress] CloudUpload hook failed:", e);
  }

  // Secondary: catch uploads earlier and stamp size when Discord forgets
  try {
    const uploadModule = findByProps("uploadLocalFiles");
    if (uploadModule?.uploadLocalFiles) {
      unpatches.push(
        before("uploadLocalFiles", uploadModule, (args) => {
          const bag = args?.[0];
          const files =
            bag?.items ?? bag?.files ?? bag?.uploads ?? (Array.isArray(bag) ? bag : null);
          if (!Array.isArray(files)) return;

          for (const file of files) {
            const media = file?.file ?? file;
            if (!media) continue;
            // Fire-and-forget size resolve so the later compress hook sees it.
            resolveUploadSize(media).catch(() => {});
          }
        })
      );
      hooked = true;
      console.log("[AutoCompress] hooked uploadLocalFiles");
    }
  } catch (e) {
    console.warn("[AutoCompress] uploadLocalFiles hook failed:", e);
  }

  // Tertiary: constructor path used by some AnonymousFileNames-style patches
  try {
    const cloudUploadModule = findByProps("CloudUpload");
    if (cloudUploadModule?.CloudUpload) {
      unpatches.push(
        before("CloudUpload", cloudUploadModule, (args) => {
          const uploadObject = args?.[0];
          if (!uploadObject) return;
          resolveUploadSize(uploadObject).catch(() => {});
        })
      );
    }
  } catch {}

  if (!hooked) {
    toast("AutoCompress: no upload hooks found (Discord update?)", true);
  } else {
    toast(`AutoCompress ready (≤${ensureSettings().maxMB}MB)`, true);
  }

  return () => {
    for (const u of unpatches) {
      try {
        u();
      } catch {}
    }
  };
}
