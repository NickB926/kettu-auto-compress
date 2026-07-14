import { findByProps } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";

import { getUploadSize, getUploadUri, applyCompressedUri } from "./utils";

type CompressResult = {
  ok: boolean;
  uri?: string;
  size?: number;
  method?: string;
  error?: string;
};

function nativeModules(): Record<string, any> {
  return (ReactNative as any)?.NativeModules ?? {};
}

export async function resolveUploadSize(media: any): Promise<number> {
  const known = getUploadSize(media);
  if (known > 0) return known;

  const uri = getUploadUri(media);
  if (!uri) return 0;

  const sized = await statSize(uri);
  if (typeof sized === "number" && sized > 0) {
    media.preCompressionSize = sized;
    media.currentSize = sized;
    return sized;
  }
  return 0;
}

/** Probe for optional native video compressors Discord or a loader might expose. */
export async function tryNativeVideoCompress(
  uri: string,
  targetBytes: number,
  durationSecs?: number
): Promise<CompressResult> {
  const mods = nativeModules();

  const dur = Math.max(1, durationSecs || 30);
  const targetBits = Math.floor(targetBytes * 0.88 * 8);
  const audioBits = 96_000;
  const videoBitrate = Math.max(150_000, Math.floor(targetBits / dur) - audioBits);

  const attempts: Array<() => Promise<CompressResult | null>> = [
    async () => {
      const Video = mods.VideoCompressor || mods.RNCompressor || mods.Compressor;
      if (!Video?.compress) return null;
      const out = await Video.compress(uri, {
        compressionMethod: "manual",
        bitrate: videoBitrate,
        maxSize: 720,
        minimumFileSizeForCompress: 0,
      });
      if (typeof out === "string") return { ok: true, uri: out, method: "VideoCompressor" };
      if (out?.uri) return { ok: true, uri: out.uri, size: out.size, method: "VideoCompressor" };
      return null;
    },
    async () => {
      const Media = mods.MediaManager || mods.DCDMediaManager || mods.VideoManager;
      if (!Media) return null;
      const fn =
        Media.compressVideo ||
        Media.createCompressedVideo ||
        Media.transcodeVideo ||
        Media.compress;
      if (typeof fn !== "function") return null;
      const out = await fn.call(Media, uri, {
        bitrate: videoBitrate,
        quality: "low",
        maxWidth: 1280,
        maxHeight: 720,
      });
      if (typeof out === "string") return { ok: true, uri: out, method: "MediaManager" };
      if (out?.uri) return { ok: true, uri: out.uri, size: out.size, method: "MediaManager" };
      return null;
    },
    async () => {
      const metro =
        findByProps("compressVideo") ||
        findByProps("createCompressedVideo") ||
        findByProps("transcodeVideo");
      if (!metro) return null;
      const fn =
        metro.compressVideo ||
        metro.createCompressedVideo ||
        metro.transcodeVideo;
      if (typeof fn !== "function") return null;
      const out = await fn(uri, {
        bitrate: videoBitrate,
        maxSize: 720,
      });
      if (typeof out === "string") return { ok: true, uri: out, method: "metro" };
      if (out?.uri) return { ok: true, uri: out.uri, size: out.size, method: "metro" };
      return null;
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (res?.ok && res.uri) return res;
    } catch (e) {
      console.warn("[AutoCompress] native attempt failed:", e);
    }
  }

  return {
    ok: false,
    error: "No native video compressor available in this Discord build",
  };
}

export async function statSize(uri: string): Promise<number | undefined> {
  const mods = nativeModules();
  const FS =
    mods.DCDFileManager ||
    mods.FileManager ||
    mods.RNFSManager ||
    mods.NativeFileReaderModule;

  try {
    if (typeof FS?.getSize === "function") {
      const s = await FS.getSize(uri);
      if (typeof s === "number") return s;
    }
    if (typeof FS?.stat === "function") {
      const s = await FS.stat(uri);
      const size = s?.size ?? s?.fileSize;
      if (typeof size === "number") return size;
    }
  } catch {}
  return undefined;
}

/**
 * Run Discord's built-in RN compress, then optionally a native re-encode
 * if still over the target size.
 */
export async function compressUpload(
  media: any,
  originalCompress: (...args: any[]) => Promise<any>,
  args: any[],
  targetBytes: number
): Promise<{
  proceeded: boolean;
  finalSize: number;
  method: string;
  prepResult?: any;
  nativeTried: boolean;
}> {
  const before = (await resolveUploadSize(media)) || getUploadSize(media);
  const uri = getUploadUri(media);

  const discordResult = await originalCompress.apply(media, args);

  const afterDiscord =
    getUploadSize(media) ||
    media?.postCompressionSize ||
    media?.currentSize ||
    before;

  if (afterDiscord > 0 && afterDiscord <= targetBytes) {
    return {
      proceeded: true,
      finalSize: afterDiscord,
      method: "discord",
      prepResult: discordResult,
      nativeTried: false,
    };
  }

  if (uri) {
    const native = await tryNativeVideoCompress(
      uri,
      targetBytes,
      media?.durationSecs
    );
    if (native.ok && native.uri) {
      const size = native.size ?? (await statSize(native.uri)) ?? afterDiscord;
      applyCompressedUri(media, native.uri, size);

      let prepResult = discordResult;
      try {
        prepResult = await originalCompress.apply(media, args);
      } catch (e) {
        console.warn("[AutoCompress] re-prep after native compress failed:", e);
      }

      const finalSize = getUploadSize(media) || size;

      return {
        proceeded: finalSize <= targetBytes,
        finalSize,
        method: native.method ?? "native",
        prepResult,
        nativeTried: true,
      };
    }

    return {
      proceeded: afterDiscord > 0 && afterDiscord <= targetBytes,
      finalSize: afterDiscord || before,
      method: "discord",
      prepResult: discordResult,
      nativeTried: true,
    };
  }

  return {
    proceeded: afterDiscord > 0 && afterDiscord <= targetBytes,
    finalSize: afterDiscord || before,
    method: "discord",
    prepResult: discordResult,
    nativeTried: false,
  };
}
