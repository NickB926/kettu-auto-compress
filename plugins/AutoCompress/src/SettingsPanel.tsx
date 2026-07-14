import { React, ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings } from "./config";

const ScrollView =
  ReactNative?.ScrollView ?? findByProps("ScrollView")?.ScrollView ?? ReactNative.View;

// Prefer modern Bunny/Kettu table rows when present; fall back to Forms.
const Table = findByProps("TableSwitchRow", "TableRowGroup", "TableRow");
const TextInputMod = findByProps("TextInput");
const { FormSection, FormInput, FormSwitch, FormRow, FormDivider } = Forms ?? {};

function parseMB(raw: string): number | null {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  if (isNaN(n) || n <= 0) return null;
  return n;
}

export default function SettingsPanel() {
  ensureSettings();
  useProxy(storage);

  // Local draft so backspacing "20" → "" → "25" does NOT snap back to 20.
  const [draft, setDraft] = React.useState(String(storage.maxMB ?? 20));

  React.useEffect(() => {
    // Sync when storage changes from outside (e.g. plugin reload defaults).
    setDraft(String(storage.maxMB ?? 20));
  }, [storage.maxMB]);

  const commitDraft = React.useCallback(() => {
    const n = parseMB(draft);
    if (n == null) {
      setDraft(String(storage.maxMB ?? 20));
      return;
    }
    storage.maxMB = n;
    setDraft(String(n));
  }, [draft]);

  const onDraftChange = (v: string) => {
    setDraft(v);
    const n = parseMB(v);
    // Only write when the typed value is a real positive number.
    // Never force 20 while the field is empty / half-typed.
    if (n != null) storage.maxMB = n;
  };

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const {
      TableRowGroup,
      TableSwitchRow,
      TableRow,
      Stack,
    } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size">
          <TableRow
            label="Max size (MB)"
            subLabel="Type freely — value saves when valid (e.g. 25)"
          />
          <TextInput
            value={draft}
            placeholder="20"
            keyboardType="numeric"
            onChange={(v: string) => onDraftChange(String(v ?? ""))}
            onBlur={commitDraft}
            isClearable
          />
        </TableRowGroup>

        <TableRowGroup title="What to compress">
          <TableSwitchRow
            label="Videos"
            subLabel="Intercept oversized videos before upload"
            value={!!storage.compressVideos}
            onValueChange={(v: boolean) => {
              storage.compressVideos = v;
            }}
          />
          <TableSwitchRow
            label="Images"
            subLabel="Same for oversized images"
            value={!!storage.compressImages}
            onValueChange={(v: boolean) => {
              storage.compressImages = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Failure / debug">
          <TableSwitchRow
            label="Block send if still too large"
            subLabel="Recommended"
            value={!!storage.blockOnFail}
            onValueChange={(v: boolean) => {
              storage.blockOnFail = v;
            }}
          />
          <TableSwitchRow
            label="Show toasts"
            value={!!storage.showToasts}
            onValueChange={(v: boolean) => {
              storage.showToasts = v;
            }}
          />
          <TableSwitchRow
            label="Debug toasts"
            subLabel="Toast every file the hook sees (turn off once it works)"
            value={!!storage.debugToasts}
            onValueChange={(v: boolean) => {
              storage.debugToasts = v;
            }}
          />
        </TableRowGroup>

        <TableRowGroup title="Limits">
          <TableRow
            label="No FFmpeg in pure Kettu plugins"
            subLabel="Uses Discord’s native compress. Long/4K clips may still stay over the limit."
          />
        </TableRowGroup>
        {Stack ? <Stack /> : null}
      </ScrollView>
    );
  }

  // Legacy Forms fallback
  return (
    <ScrollView style={{ flex: 1 }}>
      <FormSection title="Target size">
        <FormInput
          title="Max size (MB)"
          keyboardType="numeric"
          placeholder="20"
          value={draft}
          onChange={(v: string) => onDraftChange(String(v ?? ""))}
          onBlur={commitDraft}
        />
        <FormRow label="Type freely — only saves when the number is valid." />
      </FormSection>

      <FormDivider />

      <FormSection title="What to compress">
        <FormRow
          label="Videos"
          trailing={
            <FormSwitch
              value={!!storage.compressVideos}
              onValueChange={(v: boolean) => {
                storage.compressVideos = v;
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
                storage.compressImages = v;
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
                storage.blockOnFail = v;
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
                storage.showToasts = v;
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
                storage.debugToasts = v;
              }}
            />
          }
        />
      </FormSection>
    </ScrollView>
  );
}
