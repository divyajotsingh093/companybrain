import { useEffect, useState, type DragEvent, type JSX } from "react";
import { AlertBanner, Button, Caption, Card, EmptyState, Heading, ListItem, Skeleton, Stack, Text, tokens, usePal } from "./ui";
import { EASE, THEME, get, injectCss, post, reason, send, when } from "./shared";

export const UPLOADS = "Uploaded files";

const ACCEPT = ".md,.mdx,.markdown,.txt,.rst,.adoc";

interface Files {
  files: Array<{ name: string; title: string; size: number; indexedAt: number }>;
  now: number;
}

interface Upload {
  name: string;
  state: "waiting" | "sending" | "done" | "failed";
  message?: string;
}

const STATE_LABEL: Record<Upload["state"], string> = {
  waiting: "Waiting",
  sending: "Adding",
  done: "Added",
  failed: "Not added",
};

function injectFileStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-file-styles",
    `
    .cb-drop {
      position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 26px 20px;
      text-align: center; border: 1px dashed ${pal.border}; border-radius: 14px; background: ${pal.bgSubtle}; cursor: pointer;
      transition: border-color 160ms ${EASE}, background-color 160ms ${EASE};
    }
    .cb-drop[data-drag="true"] { border-color: ${pal.accent}; background: ${pal.accentBg}; }
    .cb-drop[data-busy="true"] { cursor: progress; }
    .cb-drop:focus-within { outline: 2px solid ${pal.accent}; outline-offset: 2px; }
    @media (hover: hover) and (pointer: fine) { .cb-drop:hover { border-color: ${pal.borderFocus}; } }
    .cb-drop-input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
    @media (prefers-reduced-motion: reduce) { .cb-drop { transition: none; } }
  `,
  );
}

export function FilesSection({ onChanged }: { onChanged: () => void }): JSX.Element {
  const pal = usePal(THEME);
  injectFileStyles(pal);
  const [view, setView] = useState<Files | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const running = uploads.some((u) => u.state === "waiting" || u.state === "sending");

  const load = (): void => {
    void get<Files>("/api/app/files").then(
      (next) => {
        setView(next);
        setLoadError(null);
      },
      (err: unknown) => setLoadError(reason(err)),
    );
  };

  useEffect(load, []);

  const upload = async (list: File[]): Promise<void> => {
    if (!list.length || running) return;
    const mark = (i: number, patch: Partial<Upload>): void => setUploads((prev) => prev.map((u, j) => (j === i ? { ...u, ...patch } : u)));
    setUploads(list.map((f) => ({ name: f.name, state: "waiting" })));
    for (const [i, file] of list.entries()) {
      mark(i, { state: "sending" });
      try {
        await post<{ name: string }>("/api/app/files", { name: file.name, content: await file.text() });
        mark(i, { state: "done" });
      } catch (err) {
        mark(i, { state: "failed", message: reason(err) });
      }
    }
    load();
    onChanged();
  };

  const remove = async (name: string): Promise<void> => {
    setRemoving(name);
    setRemoveError(null);
    try {
      await send(`/api/app/files?name=${encodeURIComponent(name)}`, { method: "DELETE" });
    } catch (err) {
      setRemoveError(`${name}: ${reason(err)}`);
    } finally {
      setRemoving(null);
      setConfirm(null);
      load();
      onChanged();
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setDragging(false);
    void upload([...e.dataTransfer.files]);
  };

  const onDragLeave = (e: DragEvent<HTMLLabelElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };

  const added = uploads.filter((u) => u.state === "done").length;

  return (
    <Stack gap={14}>
      <Stack gap={2}>
        <Heading level={5} theme={THEME}>
          Files
        </Heading>
        <Text secondary theme={THEME}>
          Add text you want answers to draw on. Files are private to you: only your questions read them, and nobody else sees them.
        </Text>
      </Stack>

      <label
        className="cb-drop"
        data-drag={dragging}
        data-busy={running}
        onDragOver={(e) => {
          e.preventDefault();
          if (!running) setDragging(true);
        }}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          type="file"
          multiple
          accept={ACCEPT}
          className="cb-drop-input"
          disabled={running}
          onChange={(e) => {
            const picked = [...(e.target.files ?? [])];
            e.target.value = "";
            void upload(picked);
          }}
        />
        <span style={{ ...tokens.type.base, fontWeight: tokens.weight.medium, color: pal.text, fontFamily: tokens.font.sans }}>
          {running ? "Adding your files" : dragging ? "Drop to add them" : "Drop files here, or choose files"}
        </span>
        <span style={{ ...tokens.type.sm, color: pal.textTertiary, fontFamily: tokens.font.sans, maxWidth: 460, lineHeight: 1.5 }}>
          Markdown, plain text, reStructuredText or AsciiDoc (.md .mdx .markdown .txt .rst .adoc), up to 40,000 characters each. Adding a file with the same name replaces it.
        </span>
      </label>

      {uploads.length ? (
        <div aria-live="polite">
          <Stack gap={6}>
            {running ? null : (
              <Caption theme={THEME}>{`${added} of ${uploads.length} added`}</Caption>
            )}
            <Card theme={THEME} padding={0}>
              {uploads.map((u, i) => (
                <div
                  key={`${u.name}-${i}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    padding: "10px 16px",
                    borderBottom: i < uploads.length - 1 ? `1px solid ${pal.borderSubtle}` : "none",
                  }}
                >
                  <Text theme={THEME} mono style={{ ...tokens.type.sm, overflowWrap: "anywhere", minWidth: 0 }}>
                    {u.name}
                  </Text>
                  <Text
                    theme={THEME}
                    style={{ ...tokens.type.sm, color: u.state === "failed" ? pal.danger : u.state === "done" ? pal.success : pal.textSecondary, overflowWrap: "anywhere" }}
                  >
                    {u.message ? `${STATE_LABEL[u.state]}: ${u.message}` : STATE_LABEL[u.state]}
                  </Text>
                </div>
              ))}
            </Card>
            {running ? null : (
              <Stack direction="row" justify="flex-end">
                <Button variant="ghost" size="sm" theme={THEME} onClick={() => setUploads([])}>
                  Clear
                </Button>
              </Stack>
            )}
          </Stack>
        </div>
      ) : null}

      {removeError ? <AlertBanner variant="danger" title={removeError} theme={THEME} /> : null}

      {loadError ? (
        <AlertBanner variant="danger" title="Your files could not be loaded" description={`${loadError}. Reload to try again.`} theme={THEME} />
      ) : !view ? (
        <Skeleton theme={THEME} />
      ) : (
        <Card theme={THEME} padding={0}>
          {view.files.length ? (
            view.files.map((f, i) => (
              <ListItem
                key={f.name}
                title={f.title}
                subtitle={`${f.name} · ${f.size.toLocaleString()} characters · added ${when(f.indexedAt, view.now)}`}
                right={
                  confirm === f.name ? (
                    <Stack direction="row" gap={6} align="center">
                      <Button variant="ghost" size="sm" theme={THEME} disabled={removing === f.name} onClick={() => setConfirm(null)}>
                        Keep
                      </Button>
                      <Button variant="danger" size="sm" theme={THEME} disabled={removing === f.name} onClick={() => void remove(f.name)}>
                        {removing === f.name ? "Removing" : "Remove"}
                      </Button>
                    </Stack>
                  ) : (
                    <Button variant="ghost" size="sm" theme={THEME} onClick={() => setConfirm(f.name)}>
                      Remove
                    </Button>
                  )
                }
                divider={i < view.files.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <EmptyState title="No files yet" description="Add a text file above. Your questions can draw on it straight away." theme={THEME} />
          )}
        </Card>
      )}
    </Stack>
  );
}
