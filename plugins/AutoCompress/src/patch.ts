import { findByProps } from "@vendetta/metro";
import { instead, before } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

import { compressUpload, resolveUploadSize } from "./compress";
import { ensureSettings, maxBytes, MB } from "./config";
import {
  captureSnapshot,
  uploadExternal,
  type FileSnapshot,
} from "./external";
import {
  formatBytes,
  getUploadSize,
  isImageUpload,
  isVideoUpload,
} from "./utils";

const SNAP_KEY = "__acSnapshot";

function toast(msg: string, force = false) {
  const s = ensureSettings();
  if (force || s.showToasts || s.debugToasts) showToast(msg);
}

function externalEnabled(): boolean {
  // Treat anything except explicit false as on (matches default).
  return ensureSettings().fallbackExternal !== false;
}

function cancelUpload(media: any) {
  try {
    // Discord uses British spelling; some forks used the US spelling.
    if (typeof media.setStatus === "function") {
      try {
        media.setStatus("CANCELLED");
      } catch {}
      try {
        media.setStatus("CANCELED");
      } catch {}
    }
    if (typeof media.cancel === "function") media.cancel();
    if (typeof media.removeFromMsgDraft === "function") media.removeFromMsgDraft();
    if (typeof media.delete === "function") media.delete();
  } catch {}
}

function getChannelId(media?: any, snap?: FileSnapshot | null): string | undefined {
  if (media?.channelId) return media.channelId;
  if (snap?.channelId) return snap.channelId;
  try {
    return (
      findByProps("getChannelId", "getCurrentlySelectedChannelId")?.getChannelId?.() ??
      findByProps("getLastSelectedChannelId")?.getLastSelectedChannelId?.() ??
      findByProps("getChannelId")?.getChannelId?.()
    );
  } catch {
    return undefined;
  }
}

/** Clear Discord's stuck "Sending…" bubble after we hijack the upload. */
function purgePending(channelId?: string, media?: any) {
  if (!channelId) return;
  try {
    const Pending = findByProps("getPendingMessages", "deletePendingMessage");
    if (!Pending?.getPendingMessages || !Pending?.deletePendingMessage) return;

    const pending = Pending.getPendingMessages(channelId);
    if (!pending) return;

    const targetId =
      media?.messageId ?? media?.id ?? media?.nonce ?? media?.uniqueId;

    for (const [id, message] of Object.entries(pending) as [string, any][]) {
      const state = String(message?.state ?? "").toUpperCase();
      const hasAttach =
        !!message?.message?.attachments?.length ||
        !!message?.attachments?.length ||
        !!message?.uploads?.length ||
        !!message?.files?.length;

      const matchTarget = targetId && String(id) === String(targetId);
      const stuck =
        state.includes("SEND") ||
        state.includes("FAIL") ||
        state.includes("UPLOAD") ||
        state.includes("PENDING") ||
        state === "0" ||
        state === "1";

      if (matchTarget || (stuck && hasAttach) || stuck) {
        try {
          Pending.deletePendingMessage(channelId, id);
        } catch {}
      }
    }
  } catch (e) {
    console.warn("[AutoCompress] purgePending failed:", e);
  }
}


async function sendLink(channelId: string | undefined, content: string) {
  const MessageSender = findByProps("sendMessage");
  const payload = { content };

  if (channelId && MessageSender?.sendMessage) {
    try {
      // Don't mark as silent / suppress embeds — we want Discord to unfurl the media URL.
      const nonce = Date.now().toString();
      await MessageSender.sendMessage(channelId, payload, void 0, { nonce });
      return true;
    } catch (e) {
      console.warn("[AutoCompress] sendMessage failed:", e);
      try {
        await MessageSender.sendMessage(channelId, payload);
        return true;
      } catch {}
    }
  }
  try {
    (ReactNative as any)?.Clipboard?.setString?.(content);
    toast("Link copied (couldn't auto-send — paste it)", true);
    return false;
  } catch {
    toast(content, true);
    return false;
  }
}

async function externalFallback(
  media: any,
  size: number,
  snap: FileSnapshot | null
): Promise<boolean> {
  if (!externalEnabled()) {
    toast("External fallback is OFF in AutoCompress settings", true);
    return false;
  }

  if (!snap?.uri) {
    toast("External failed: no local file URI to upload", true);
    return false;
  }

  const channelId = getChannelId(media, snap);

  // Drop Discord's attachment send immediately so the UI isn't stuck on Sending.
  cancelUpload(media);
  purgePending(channelId, media);
  setTimeout(() => purgePending(channelId, media), 250);
  setTimeout(() => purgePending(channelId, media), 1000);

  const settings = ensureSettings();
  const hash = String(settings.catboxUserhash ?? "").trim();
  if (!hash) {
    toast(
      "Set your Catbox userhash in AutoCompress settings (catbox.moe account page)",
      true
    );
    return false;
  }

  toast(
    `Uploading ${formatBytes(size) || "file"} to Catbox (…${hash.slice(-4)})…`,
    true
  );

  const result = await uploadExternal(snap, "catbox", hash);

  // One more cleanup pass in case Discord recreated a pending bubble.
  cancelUpload(media);
  purgePending(channelId, media);

  if (!result.link) {
    toast(`External failed: ${result.error ?? "unknown"}`, true);
    return false;
  }

  // Bare URL only — markdown [name](url) kills embeds and often breaks taps on mobile.
  const url = result.link.trim();
  await sendLink(channelId, url);
  purgePending(channelId, media);
  toast(`Sent Catbox link`, true);
  return true;
}

async function handleCompress(
  media: any,
  args: any[],
  orig: (...a: any[]) => any
) {
  const settings = ensureSettings();
  const limit = maxBytes();
  const hardLimit = Math.min(limit, 24.5 * MB);
  const video = isVideoUpload(media);
  const image = isImageUpload(media);

  // Capture URI BEFORE Discord touches the file (compress often invalidates it).
  const snap = captureSnapshot(media);
  try {
    media[SNAP_KEY] = snap;
  } catch {}

  const cares =
    (settings.compressVideos && video) || (settings.compressImages && image);

  let size = await resolveUploadSize(media);
  if (snap && (!snap.size || snap.size <= 0) && size > 0) snap.size = size;

  if (settings.debugToasts) {
    const kind = video ? "video" : image ? "image" : "file";
    toast(
      `AC ${kind}: ${snap?.filename ?? "?"} · ${size ? formatBytes(size) : "size?"} · uri=${snap?.uri ? "yes" : "NO"}`,
      true
    );
  }

  if (!cares) return orig(...args);

  if (size > 0 && size <= hardLimit) return orig(...args);

  // Oversized: go external FIRST while the URI is still valid.
  // Discord's built-in compress usually cannot hit free-tier video limits alone.
  if (externalEnabled()) {
    if (await externalFallback(media, size || snap?.size || 0, snap)) {
      return null;
    }
    // External failed — try Discord compress as a last resort.
    toast("External failed — trying Discord compress…", true);
  }

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

    // Still too big after Discord — try external again with original snapshot.
    if (await externalFallback(media, size || 0, snap ?? captureSnapshot(media))) {
      return null;
    }

    if (settings.blockOnFail) {
      toast(
        `Still ${formatBytes(size) || "too big"} — blocked (external upload also failed)`,
        true
      );
      cancelUpload(media);
      return null;
    }

    toast(`Still ${formatBytes(size)} — uploading anyway (may fail)`);
    return result.prepResult;
  } catch (err) {
    console.error("[AutoCompress] compress failed:", err);
    if (await externalFallback(media, size || 0, snap ?? captureSnapshot(media)))
      return null;

    if (settings.blockOnFail) {
      toast("Compression failed — blocked", true);
      cancelUpload(media);
      return null;
    }
    toast("Compression failed — original file");
    return orig(...args);
  }
}

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
      }
    } catch {}
  }

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

      if (typeof CloudUpload.prototype.handleError === "function") {
        unpatches.push(
          before("handleError", CloudUpload.prototype, function (args) {
            if (args?.[0] != 40005 && args?.[0] !== "40005") return;
            const self = this;
            const snap: FileSnapshot | null = self?.[SNAP_KEY] ?? captureSnapshot(self);

            // Recover: Discord API rejected after our pipe — try external now.
            if (externalEnabled()) {
              toast("Discord rejected file — recovering via external…", true);
              externalFallback(self, getUploadSize(self) || snap?.size || 0, snap).catch(
                (e) => console.warn("[AutoCompress] 40005 recovery failed:", e)
              );
            } else {
              toast(
                "Discord rejected (over limit). Turn ON External fallback in AutoCompress.",
                true
              );
            }
            setTimeout(() => purgePending(getChannelId(self, snap), self), 300);
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
            try {
              media[SNAP_KEY] = captureSnapshot(media);
            } catch {}
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
      `AutoCompress ready (≤${s.maxMB}MB${externalEnabled() ? " + external" : ""})`,
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
