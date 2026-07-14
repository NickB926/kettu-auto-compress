import { findByProps } from "@vendetta/metro";
import { instead, before } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

import { compressUpload, resolveUploadSize } from "./compress";
import { ensureSettings, maxBytes, MB } from "./config";
import { uploadToCatbox, uploadToLitterbox } from "./external";
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

function cleanupFailedPending(channelId?: string) {
  if (!channelId) return;
  try {
    const Pending = findByProps("getPendingMessages", "deletePendingMessage");
    const pending = Pending?.getPendingMessages?.(channelId);
    if (!pending) return;
    for (const [id, message] of Object.entries(pending) as [string, any][]) {
      if (message?.state === "FAILED") {
        Pending.deletePendingMessage(channelId, id);
      }
    }
  } catch {}
}

async function sendLink(channelId: string | undefined, content: string) {
  const MessageSender = findByProps("sendMessage");
  if (channelId && MessageSender?.sendMessage) {
    await MessageSender.sendMessage(channelId, { content });
    return true;
  }
  try {
    (ReactNative as any)?.Clipboard?.setString?.(content);
    toast("Link copied (couldn't send to chat)", true);
    return false;
  } catch {
    toast(content, true);
    return false;
  }
}

async function externalFallback(media: any, size: number): Promise<boolean> {
  const settings = ensureSettings();
  if (!settings.fallbackExternal) return false;

  const host = settings.externalHost === "catbox" ? "Catbox" : "Litterbox";
  toast(
    `Discord won't take ${formatBytes(size)} — uploading to ${host}…`,
    true
  );

  const link =
    settings.externalHost === "catbox"
      ? await uploadToCatbox(media)
      : await uploadToLitterbox(media, "12h");

  cancelUpload(media);
  const channelId =
    media?.channelId ?? findByProps("getChannelId")?.getChannelId?.();
  setTimeout(() => cleanupFailedPending(channelId), 400);

  if (!link) {
    toast(`${host} upload failed`, true);
    return false;
  }

  const name = media?.filename ?? media?.item?.filename ?? "file";
  const content = `[${name}](${link})`;
  await sendLink(channelId, content);
  toast(`Sent ${host} link`, true);
  return true;
}

async function handleCompress(
  media: any,
  args: any[],
  orig: (...a: any[]) => any
) {
  const settings = ensureSettings();
  const limit = maxBytes();
  // Keep a little headroom under Discord's free tier.
  const hardLimit = Math.min(limit, 24.5 * MB);
  const video = isVideoUpload(media);
  const image = isImageUpload(media);

  const cares =
    (settings.compressVideos && video) || (settings.compressImages && image);

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

  if (size > 0 && size <= hardLimit) return orig(...args);

  const kind = video ? "video" : "image";
  toast(
    `Compressing ${kind}${size ? ` (${formatBytes(size)})` : ""} → ≤${settings.maxMB}MB…`
  );

  try {
    const result = await compressUpload(media, orig, args, hardLimit);
    size = result.finalSize || getUploadSize(media) || size;

    if (result.proceeded && size > 0 && size <= hardLimit) {
      toast(`OK ${formatBytes(size)} via ${result.method}`);
      return result.prepResult;
    }

    // Discord still too big → external host (works) instead of pointless 40005.
    if (await externalFallback(media, size || 0)) {
      return null;
    }

    if (settings.blockOnFail) {
      toast(
        `Still ${formatBytes(size) || "too big"} — blocked (enable External fallback in settings)`,
        true
      );
      cancelUpload(media);
      return null;
    }

    toast(`Still ${formatBytes(size)} — uploading anyway (may fail)`);
    return result.prepResult;
  } catch (err) {
    console.error("[AutoCompress] compress failed:", err);
    if (await externalFallback(media, size || 0)) return null;

    if (settings.blockOnFail) {
      toast("Compression failed — blocked");
      cancelUpload(media);
      return null;
    }
    toast("Compression failed — original file");
    return orig(...args);
  }
}

/** Raise Discord's client-side attachment ceiling so huge videos reach our hook. */
function patchClientSizeLimits(unpatches: Array<() => void>) {
  const BIG = 500 * MB;
  const propSets = [
    ["getUserMaxFileSize"],
    ["getMaxFileSize"],
    ["getMaxAttachmentSize"],
    ["getMaxAttachmentSizeBytes"],
    ["maxFileSize"],
  ];

  for (const props of propSets) {
    try {
      const mod = findByProps(...props);
      if (!mod) continue;
      for (const key of props) {
        if (typeof mod[key] !== "function") continue;
        unpatches.push(
          instead(key, mod, function () {
            return BIG;
          })
        );
        console.log(`[AutoCompress] raised ${key}`);
      }
    } catch {}
  }

  // Some builds expose a Premium / file-size helper object.
  try {
    const premium =
      findByProps("canUseIncreasedAttachmentSize") ||
      findByProps("getPremiumType", "getMaxFileSize");
    if (premium && typeof premium.getMaxFileSize === "function") {
      unpatches.push(
        instead("getMaxFileSize", premium, function () {
          return BIG;
        })
      );
    }
  } catch {}
}

export function patchUploader(): () => void {
  const unpatches: Array<() => void> = [];
  let hooked = false;

  patchClientSizeLimits(unpatches);

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

      // If Discord still throws 40005, clean up + explain.
      if (typeof CloudUpload.prototype.handleError === "function") {
        unpatches.push(
          before("handleError", CloudUpload.prototype, function (args) {
            if (args?.[0] == 40005 || args?.[0] === "40005") {
              toast(
                "Discord still rejected the file (over limit). Enable External fallback.",
                true
              );
              const channelId = this?.channelId;
              setTimeout(() => cleanupFailedPending(channelId), 300);
            }
          })
        );
      }
    } else {
      console.warn("[AutoCompress] reactNativeCompressAndExtractData missing");
    }
  } catch (e) {
    console.error("[AutoCompress] CloudUpload hook failed:", e);
  }

  try {
    const uploadModule = findByProps("uploadLocalFiles");
    if (uploadModule?.uploadLocalFiles) {
      unpatches.push(
        before("uploadLocalFiles", uploadModule, (args) => {
          const bag = args?.[0];
          const files =
            bag?.items ??
            bag?.files ??
            bag?.uploads ??
            (Array.isArray(bag) ? bag : null);
          if (!Array.isArray(files)) return;

          for (const file of files) {
            const media = file?.file ?? file;
            if (!media) continue;
            resolveUploadSize(media).catch(() => {});
          }
        })
      );
      hooked = true;
    }
  } catch (e) {
    console.warn("[AutoCompress] uploadLocalFiles hook failed:", e);
  }

  if (!hooked) {
    toast("AutoCompress: no upload hooks found (Discord update?)", true);
  } else {
    const s = ensureSettings();
    toast(
      `AutoCompress ready (≤${s.maxMB}MB${s.fallbackExternal ? " + link fallback" : ""})`,
      true
    );
  }

  return () => {
    for (const u of unpatches) {
      try {
        u();
      } catch {}
    }
  };
}
