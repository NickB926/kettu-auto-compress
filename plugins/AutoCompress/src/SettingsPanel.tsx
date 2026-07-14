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
  // Init once on mount — never assign storage unconditionally during render.
  React.useEffect(() => {
    ensureSettings();
  }, []);

  useProxy(storage);

  const [draft, setDraft] = React.useState(() =>
    String(storage.maxMB ?? 20)
  );
  const focused = React.useRef(false);

  // Sync draft from storage only when not editing (avoids render ↔ proxy loops).
  React.useEffect(() => {
    if (focused.current) return;
    setDraft(String(storage.maxMB ?? 20));
  }, [storage.maxMB]);

  const commitDraft = () => {
    const n = parseMB(draft);
    if (n == null) {
      setDraft(String(storage.maxMB ?? 20));
      return;
    }
    if (storage.maxMB !== n) storage.maxMB = n;
    setDraft(String(n));
  };

  const maxInput = (
    <FormInput
      title="Max size (MB)"
      keyboardType="numeric"
      placeholder="20"
      value={draft}
      onChange={(v: string) => setDraft(String(v ?? ""))}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commitDraft();
      }}
    />
  );

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow, TableRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size">
          <TableRow
            label="Max size (MB)"
            subLabel="Edit freely, then tap away to save"
          />
          <TextInput
            value={draft}
            placeholder="20"
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
            subLabel="Intercept oversized videos before upload"
            value={!!storage.compressVideos}
            onValueChange={(v: boolean) => {
              if (storage.compressVideos !== v) storage.compressVideos = v;
            }}
          />
          <TableSwitchRow
            label="Images"
            subLabel="Same for oversized images"
            value={!!storage.compressImages}
            onValueChange={(v: boolean) => {
              if (storage.compressImages !== v) storage.compressImages = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Failure / debug">
          <TableSwitchRow
            label="Block send if still too large"
            subLabel="Recommended"
            value={!!storage.blockOnFail}
            onValueChange={(v: boolean) => {
              if (storage.blockOnFail !== v) storage.blockOnFail = v;
            }}
          />
          <TableSwitchRow
            label="Show toasts"
            value={!!storage.showToasts}
            onValueChange={(v: boolean) => {
              if (storage.showToasts !== v) storage.showToasts = v;
            }}
          />
          <TableSwitchRow
            label="Debug toasts"
            subLabel="Toast every file the hook sees (turn off once it works)"
            value={!!storage.debugToasts}
            onValueChange={(v: boolean) => {
              if (storage.debugToasts !== v) storage.debugToasts = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Limits">
          <TableRow
            label="No FFmpeg in pure Kettu plugins"
            subLabel="Uses Discord’s native compress. Long/4K clips may still stay over the limit."
          />
        </TableRowGroup>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Target size">
        {maxInput}
        <FormRow label="Edit freely, then tap away to save." />
      </FormSection>

      <FormDivider />

      <FormSection title="What to compress">
        <FormRow
          label="Videos"
          trailing={
            <FormSwitch
              value={!!storage.compressVideos}
              onValueChange={(v: boolean) => {
                if (storage.compressVideos !== v) storage.compressVideos = v;
              }}
            />
          }
        />
        <FormRow
          label="Images"
          trailing={
            <FormSwitch
              value={!!storage.compressImages}
              onValueChange={(v: boolean) => {
                if (storage.compressImages !== v) storage.compressImages = v;
              }}
            />
          }
        />
      </FormSection>

      <FormDivider />

      <FormSection title="Failure / debug">
        <FormRow
          label="Block send if still too large"
          trailing={
            <FormSwitch
              value={!!storage.blockOnFail}
              onValueChange={(v: boolean) => {
                if (storage.blockOnFail !== v) storage.blockOnFail = v;
              }}
            />
          }
        />
        <FormRow
          label="Show toasts"
          trailing={
            <FormSwitch
              value={!!storage.showToasts}
              onValueChange={(v: boolean) => {
                if (storage.showToasts !== v) storage.showToasts = v;
              }}
            />
          }
        />
        <FormRow
          label="Debug toasts"
          subLabel="Toast every file the hook sees"
          trailing={
            <FormSwitch
              value={!!storage.debugToasts}
              onValueChange={(v: boolean) => {
                if (storage.debugToasts !== v) storage.debugToasts = v;
              }}
            />
          }
        />
      </FormSection>
    </ScrollView>
  );
}
