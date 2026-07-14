import { findByProps } from "@vendetta/metro";
import { instead, before } from "@vendetta/patcher";
import { ReactNative } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

import { compressUpload, resolveUploadSize } from "./compress";
import { ensureSettings, maxBytes, MB } from "./config";
import {
  captureSnapshot,
  uploadExternal,
  applyLocalToMedia,
  cacheRemoteFile,
  isEphemeralMediaUrl,
  type FileSnapshot,
} from "./external";
import {
  formatBytes,
  getUploadSize,
  isImageUpload,
  isVideoUpload,
} from "./utils";

const SNAP_KEY = "__acSnapshot";

function toast(msg: string) {
  try {
    showToast(msg);
  } catch {}
}

function externalEnabled(): boolean {
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
    toast("Link copied (couldn't auto-send — paste it)");
    return false;
  } catch {
    toast(content);
    return false;
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * ezgif remux → Discord attachment only.
 * Never post ezgif/Litterbox URLs — they expire (~1h) and Discord embeds turn into 404s.
 */
async function tryExternal(
  media: any,
  size: number,
  snap: FileSnapshot | null,
  orig: (...a: any[]) => any,
  args: any[]
): Promise<{ prepResult: any } | "link" | false> {
  if (!externalEnabled()) return false;
  if (!snap?.uri) {
    toast("AutoCompress: no local file URI");
    return false;
  }

  const channelId = getChannelId(media, snap);
  const result = await uploadExternal(snap);
  const limit = maxBytes();

  async function attachLocal(
    localUri: string,
    localSize?: number
  ): Promise<{ prepResult: any } | false> {
    try {
      applyLocalToMedia(media, localUri, localSize);
      const prepResult = await orig(...args);
      return { prepResult };
    } catch (e) {
      console.warn("[AutoCompress] Discord re-attach failed:", e);
      return false;
    }
  }

  const under =
    !!result.localUri && (!result.localSize || result.localSize <= limit);

  if (under && result.localUri) {
    const ok = await attachLocal(result.localUri, result.localSize);
    if (ok) return ok;
  }

  // Under-limit remote but cache failed earlier — retry download before giving up.
  if (
    result.link &&
    !result.localUri &&
    (!result.error || /cache/i.test(result.error))
  ) {
    const cached = await cacheRemoteFile(
      result.link,
      `ac_ezgif_retry_${Date.now()}.mp4`
    );
    if (cached?.uri && (!cached.size || cached.size <= limit)) {
      const ok = await attachLocal(cached.uri, cached.size || undefined);
      if (ok) return ok;
    }
  }

  // Never send ephemeral ezgif/Litterbox links into chat (embeds → 404 later).
  if (result.link && isEphemeralMediaUrl(result.link)) {
    cancelUpload(media);
    purgePending(channelId, media);
    toast(
      "Couldn't attach as Discord video (won't post temp ezgif link — those 404 later)"
    );
    return false;
  }

  if (!result.link) {
    toast(`ezgif failed: ${result.error ?? "unknown"}`);
    cancelUpload(media);
    purgePending(channelId, media);
    return false;
  }

  // Non-ephemeral link only (shouldn't happen with ezgif-only).
  cancelUpload(media);
  purgePending(channelId, media);
  setTimeout(() => purgePending(channelId, media), 250);
  setTimeout(() => purgePending(channelId, media), 1000);
  await delay(700);
  await sendLink(channelId, result.link.trim());
  purgePending(channelId, media);
  return "link";
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

  if (!cares) return orig(...args);

  if (size > 0 && size <= hardLimit) return orig(...args);

  // Oversized: ezgif first while the URI is still valid.
  if (externalEnabled()) {
    const outcome = await tryExternal(
      media,
      size || snap?.size || 0,
      snap,
      orig,
      args
    );
    if (outcome === "link") return null;
    if (outcome && typeof outcome === "object" && "prepResult" in outcome) {
      return outcome.prepResult;
    }
  }

  try {
    const result = await compressUpload(media, orig, args, hardLimit);
    size = result.finalSize || getUploadSize(media) || size;

    if (result.proceeded && size > 0 && size <= hardLimit) {
      return result.prepResult;
    }

    const outcome = await tryExternal(
      media,
      size || 0,
      snap ?? captureSnapshot(media),
      orig,
      args
    );
    if (outcome === "link") return null;
    if (outcome && typeof outcome === "object" && "prepResult" in outcome) {
      return outcome.prepResult;
    }

    if (settings.blockOnFail) {
      toast(
        `Still ${formatBytes(size) || "too big"} — blocked (ezgif also failed)`
      );
      cancelUpload(media);
      return null;
    }

    return result.prepResult;
  } catch (err) {
    console.error("[AutoCompress] compress failed:", err);
    const outcome = await tryExternal(
      media,
      size || 0,
      snap ?? captureSnapshot(media),
      orig,
      args
    );
    if (outcome === "link") return null;
    if (outcome && typeof outcome === "object" && "prepResult" in outcome) {
      return outcome.prepResult;
    }

    if (settings.blockOnFail) {
      toast("Compression failed — blocked");
      cancelUpload(media);
      return null;
    }
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
              toast("Discord rejected file — recovering via ezgif…");
              tryExternal(
                self,
                getUploadSize(self) || snap?.size || 0,
                snap,
                async () => null,
                []
              ).catch((e) =>
                console.warn("[AutoCompress] 40005 recovery failed:", e)
              );
            } else {
              toast("Discord rejected (over limit). Enable ezgif compress in settings.");
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
    toast("AutoCompress: no upload hooks found (Discord update?)");
  }

  return () => {
    for (const u of unpatches) {
      try {
        u();
      } catch {}
    }
  };
}
