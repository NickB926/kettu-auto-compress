import { React, ReactNative } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { ensureSettings, type Provider } from "./config";

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

function Field({
  TextInput,
  value,
  onCommit,
  placeholder,
}: {
  TextInput: any;
  label?: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const focused = React.useRef(false);

  React.useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <TextInput
      value={draft}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      onChange={(v: string) => setDraft(String(v ?? ""))}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        onCommit(String(draft ?? "").trim());
      }}
      isClearable
    />
  );
}

function setProvider(p: Provider) {
  storage.provider = p;
}

export default function SettingsPanel() {
  React.useEffect(() => {
    ensureSettings();
  }, []);

  useProxy(storage);

  const [draft, setDraft] = React.useState(() => String(storage.maxMB ?? 20));
  const focused = React.useRef(false);
  const provider = (storage.provider as Provider) || "ezgif";

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

  if (Table?.TableRowGroup && TextInputMod?.TextInput) {
    const { TableRowGroup, TableSwitchRow, TableRow } = Table;
    const { TextInput } = TextInputMod;

    return (
      <ScrollView style={{ flex: 1 }}>
        <TableRowGroup title="Target size (MB)">
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

        <TableRowGroup title="Provider (oversized videos)">
          <TableSwitchRow
            label="ezgif (recommended, no account)"
            subLabel="Same site as ezgif.com video compressor → Discord video when possible"
            value={provider === "ezgif"}
            onValueChange={(v: boolean) => {
              if (v) setProvider("ezgif");
            }}
          />
          <TableSwitchRow
            label="FreeConvert"
            subLabel="Official API — needs free API key from freeconvert.com"
            value={provider === "freeconvert"}
            onValueChange={(v: boolean) => {
              if (v) setProvider("freeconvert");
            }}
          />
          <TableSwitchRow
            label="Cloudinary"
            subLabel="Unsigned upload preset with incoming transform"
            value={provider === "cloudinary"}
            onValueChange={(v: boolean) => {
              if (v) setProvider("cloudinary");
            }}
          />
          <TableSwitchRow
            label="Catbox (link only)"
            subLabel="No remux — Discord may not embed / play in-app"
            value={provider === "catbox"}
            onValueChange={(v: boolean) => {
              if (v) setProvider("catbox");
            }}
          />
          <TableSwitchRow
            label="External fallback enabled"
            value={!!storage.fallbackExternal}
            onValueChange={(v: boolean) => {
              if (storage.fallbackExternal !== v) storage.fallbackExternal = v;
            }}
          />
        </TableRowGroup>

        {provider === "freeconvert" && (
          <TableRowGroup title="FreeConvert API key">
            <TableRow
              label="freeconvert.com → Account → API"
              subLabel="Paste Bearer access token below"
            />
            <Field
              TextInput={TextInput}
              value={String(storage.freeConvertApiKey ?? "")}
              placeholder="api_production_…"
              onCommit={(v) => {
                storage.freeConvertApiKey = v;
              }}
            />
          </TableRowGroup>
        )}

        {provider === "cloudinary" && (
          <TableRowGroup title="Cloudinary setup">
            <TableRow
              label="Unsigned upload preset"
              subLabel="Incoming transform e.g. w_720,q_auto:low,f_mp4"
            />
            <TableRow label="Cloud name" />
            <Field
              TextInput={TextInput}
              value={String(storage.cloudinaryCloudName ?? "")}
              placeholder="your cloud name"
              onCommit={(v) => {
                storage.cloudinaryCloudName = v;
              }}
            />
            <TableRow label="Upload preset name" />
            <Field
              TextInput={TextInput}
              value={String(storage.cloudinaryUploadPreset ?? "")}
              placeholder="discord_compress"
              onCommit={(v) => {
                storage.cloudinaryUploadPreset = v;
              }}
            />
          </TableRowGroup>
        )}

        {(provider === "catbox" || provider === "ezgif") && (
          <TableRowGroup title="Catbox (optional fallback)">
            <TableRow
              label="Userhash"
              subLabel="Only needed if you pick Catbox, or as last-resort fallback"
            />
            <Field
              TextInput={TextInput}
              value={String(storage.catboxUserhash ?? "")}
              placeholder="catbox userhash"
              onCommit={(v) => {
                storage.catboxUserhash = v;
              }}
            />
          </TableRowGroup>
        )}

        <TableRowGroup title="Other">
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
      <FormSection title="Provider">
        <FormRow
          label="ezgif"
          trailing={
            <FormSwitch
              value={provider === "ezgif"}
              onValueChange={(v: boolean) => {
                if (v) setProvider("ezgif");
              }}
            />
          }
        />
        <FormInput
          title="FreeConvert API key"
          value={String(storage.freeConvertApiKey ?? "")}
          onChange={(v: string) => {
            storage.freeConvertApiKey = String(v ?? "");
          }}
        />
      </FormSection>
      <FormDivider />
    </ScrollView>
  );
}
