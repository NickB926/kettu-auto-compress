import { React, ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings } from "./config";

const ScrollView =
  ReactNative?.ScrollView ?? findByProps("ScrollView")?.ScrollView ?? ReactNative.View;

const Table = findByProps("TableSwitchRow", "TableRowGroup", "TableRow");
const TextInputMod = findByProps("TextInput");
const { FormSection, FormInput, FormSwitch, FormRow, FormDivider } = Forms ?? {};

function parseMB(raw: string): number | null {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return n;
}

export default function SettingsPanel() {
  React.useEffect(() => {
    ensureSettings();
  }, []);

  useProxy(storage);

  const [draft, setDraft] = React.useState(() =>
    String(storage.maxMB ?? 24)
  );
  const [hashDraft, setHashDraft] = React.useState(() =>
    String(storage.catboxUserhash ?? "")
  );
  const focused = React.useRef(false);
  const hashFocused = React.useRef(false);

  React.useEffect(() => {
    if (focused.current) return;
    setDraft(String(storage.maxMB ?? 24));
  }, [storage.maxMB]);

  React.useEffect(() => {
    if (hashFocused.current) return;
    setHashDraft(String(storage.catboxUserhash ?? ""));
  }, [storage.catboxUserhash]);

  const commitDraft = () => {
    const n = parseMB(draft);
    if (n == null) {
      setDraft(String(storage.maxMB ?? 24));
      return;
    }
    if (storage.maxMB !== n) storage.maxMB = n;
    setDraft(String(n));
  };

  const commitHash = () => {
    const next = String(hashDraft ?? "").trim();
    storage.catboxUserhash = next;
    setHashDraft(next);
  };

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow, TableRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size">
          <TableRow
            label="Max size (MB)"
            subLabel="Stay ≤24–25 for free Discord. Tap away to save."
          />
          <TextInput
            value={draft}
            placeholder="24"
            keyboardType="numeric"
            onChange={(v: string) => setDraft(String(v ?? ""))}
            onFocus={() => {
              focused.current = true;
            }}
            onBlur={() => {
              focused.current = false;
              commitDraft();
            }}
            isClearable
          />
        </TableRowGroup>

        <TableRowGroup title="What to compress">
          <TableSwitchRow
            label="Videos"
            value={!!storage.compressVideos}
            onValueChange={(v: boolean) => {
              if (storage.compressVideos !== v) storage.compressVideos = v;
            }}
          />
          <TableSwitchRow
            label="Images"
            value={!!storage.compressImages}
            onValueChange={(v: boolean) => {
              if (storage.compressImages !== v) storage.compressImages = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Catbox fallback">
          <TableSwitchRow
            label="Upload to Catbox when over limit"
            subLabel="Sends a files.catbox.moe link instead of a Discord attachment"
            value={!!storage.fallbackExternal}
            onValueChange={(v: boolean) => {
              if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
            }}
          />
          <TableRow
            label="Catbox userhash (required)"
            subLabel="Log into catbox.moe → copy userhash → paste here → tap away to save"
          />
          <TextInput
            value={hashDraft}
            placeholder="your userhash"
            autoCapitalize="none"
            autoCorrect={false}
            onChange={(v: string) => setHashDraft(String(v ?? ""))}
            onFocus={() => {
              hashFocused.current = true;
            }}
            onBlur={() => {
              hashFocused.current = false;
              commitHash();
            }}
            isClearable
          />
          <TableRow
            label={
              String(storage.catboxUserhash ?? "").trim()
                ? `Saved hash ending …${String(storage.catboxUserhash).trim().slice(-4)}`
                : "No userhash saved yet"
            }
          />
          <TableSwitchRow
            label="Block send if Catbox fails"
            value={!!storage.blockOnFail}
            onValueChange={(v: boolean) => {
              if (storage.blockOnFail !== v) storage.blockOnFail = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Debug">
          <TableSwitchRow
            label="Show toasts"
            value={!!storage.showToasts}
            onValueChange={(v: boolean) => {
              if (storage.showToasts !== v) storage.showToasts = v;
            }}
          />
          <TableSwitchRow
            label="Debug toasts"
            value={!!storage.debugToasts}
            onValueChange={(v: boolean) => {
              if (storage.debugToasts !== v) storage.debugToasts = v;
            }}
          />
        </TableRowGroup>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Catbox">
        <FormInput
          title="Catbox userhash"
          value={hashDraft}
          onChange={(v: string) => setHashDraft(String(v ?? ""))}
          onBlur={commitHash}
        />
        <FormRow
          label="External fallback"
          trailing={
            <FormSwitch
              value={!!storage.fallbackExternal}
              onValueChange={(v: boolean) => {
                if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
              }}
            />
          }
        />
      </FormSection>
      <FormDivider />
    </ScrollView>
  );
}
