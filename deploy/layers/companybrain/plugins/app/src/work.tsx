import { useState, type JSX } from "react";
import { AlertBanner, Button, Caption, Card, EmptyState, Heading, Select, Stack, StatusBadge, Text, TextArea, TextInput, tokens, usePal } from "./ui";
import { ApiError, CLIENT_LABEL, EASE, THEME, injectCss, post, reason, when } from "./shared";

export type WorkStatus = "open" | "working" | "review" | "changes" | "done";

type UpdateKind = "progress" | "submitted" | "accepted" | "changes";

export interface WorkUpdate {
  id: string;
  kind: UpdateKind;
  body: string;
  authorLogin: string;
  client: string;
  at: number;
}

export interface WorkRequest {
  id: string;
  repoName: string;
  title: string;
  body: string;
  status: WorkStatus;
  createdAt: number;
  closedAt: number | null;
  resolution: string | null;
  updates: WorkUpdate[];
}

export interface Work {
  requests: WorkRequest[];
  now: number;
}

type Tone = "textTertiary" | "accent" | "warning" | "textSecondary" | "success";

const STATUS: Record<WorkStatus | "closed", { label: string; badge: string; tone: Tone }> = {
  open: { label: "Waiting for an agent", badge: "offline", tone: "textTertiary" },
  working: { label: "In progress", badge: "accent", tone: "accent" },
  review: { label: "Needs your review", badge: "pending", tone: "warning" },
  changes: { label: "Changes requested", badge: "default", tone: "textSecondary" },
  done: { label: "Done", badge: "online", tone: "success" },
  closed: { label: "Closed", badge: "offline", tone: "textTertiary" },
};

const UPDATE: Record<UpdateKind, { what: string; tone: Tone }> = {
  progress: { what: "reported progress", tone: "accent" },
  submitted: { what: "submitted it for your review", tone: "warning" },
  accepted: { what: "accepted it", tone: "success" },
  changes: { what: "asked for changes", tone: "textSecondary" },
};

interface Notice {
  variant: "success" | "default" | "danger";
  title: string;
  description?: string;
}

function statusOf(r: WorkRequest): WorkStatus | "closed" {
  return r.closedAt !== null && r.status !== "done" ? "closed" : r.status;
}

export function pendingReviews(work: Work | null): number {
  return work?.requests.filter((r) => statusOf(r) === "review").length ?? 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function injectWorkStyles(pal: Record<string, string>): void {
  injectCss(
    "cb-work-styles",
    `
    .cb-work-row {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 16px;
      border: none; background: transparent; color: ${pal.text}; cursor: pointer; font-family: ${tokens.font.sans};
      transition: background-color 150ms ${EASE};
    }
    .cb-work-row:active { background: ${pal.bgMuted}; }
    @media (hover: hover) and (pointer: fine) { .cb-work-row:hover { background: ${pal.bgSubtle}; } }
    .cb-timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px; }
    .cb-timeline li { position: relative; padding-left: 20px; }
    .cb-timeline li::before {
      content: ""; position: absolute; left: 3.5px; top: 14px; bottom: -14px; width: 1px; background: ${pal.borderSubtle};
    }
    .cb-timeline li:last-child::before { display: none; }
    .cb-timeline-dot { position: absolute; left: 0; top: 5px; width: 8px; height: 8px; border-radius: 50%; }
    @media (prefers-reduced-motion: reduce) { .cb-work-row { transition: none; } }
  `,
  );
}

function Timeline({ request, login, now }: { request: WorkRequest; login: string; now: number }): JSX.Element {
  const pal = usePal(THEME);
  const entries = [
    { id: "asked", who: "You", what: "asked for this", body: request.body, at: request.createdAt, tone: "textTertiary" as Tone },
    ...request.updates.map((u) => ({
      id: u.id,
      who: u.client === "web" ? (u.authorLogin === login ? "You" : u.authorLogin) : (CLIENT_LABEL[u.client] ?? u.client),
      what: UPDATE[u.kind]?.what ?? u.kind,
      body: u.body,
      at: u.at,
      tone: UPDATE[u.kind]?.tone ?? ("textTertiary" as Tone),
    })),
  ];
  return (
    <ol className="cb-timeline" aria-label="What happened">
      {entries.map((e) => (
        <li key={e.id}>
          <span aria-hidden className="cb-timeline-dot" style={{ background: pal[e.tone] }} />
          <Stack gap={4}>
            <Text theme={THEME} size="sm">
              <span style={{ color: pal.text, fontWeight: tokens.weight.medium }}>{e.who}</span>
              <span style={{ color: pal.textSecondary }}> {e.what} · </span>
              <time style={{ color: pal.textTertiary }}>{when(e.at, now)}</time>
            </Text>
            {e.body ? (
              <p style={{ margin: 0, ...tokens.type.sm, lineHeight: 1.6, color: pal.textSecondary, fontFamily: tokens.font.sans, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{e.body}</p>
            ) : null}
          </Stack>
        </li>
      ))}
    </ol>
  );
}

function meta(r: WorkRequest, now: number): string {
  const last = r.updates[r.updates.length - 1];
  return `${r.repoName} · asked ${when(r.createdAt, now)}${last ? ` · last update ${when(last.at, now)}` : " · no updates yet"}`;
}

export function WorkScreen({ view, login, repos, onChanged }: { view: Work; login: string; repos: string[]; onChanged: () => void }): JSX.Element {
  const pal = usePal(THEME);
  injectWorkStyles(pal);
  const [creating, setCreating] = useState(view.requests.length === 0);
  const [repo, setRepo] = useState(repos.length === 1 ? (repos[0] ?? "") : "");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const review = view.requests.filter((r) => statusOf(r) === "review");
  const active = view.requests.filter((r) => ["open", "working", "changes"].includes(statusOf(r)));
  const finished = view.requests.filter((r) => ["done", "closed"].includes(statusOf(r)));

  const create = async (): Promise<void> => {
    if (!repo || !title.trim() || sending) return;
    setSending(true);
    setFormError(null);
    try {
      await post<{ id: string }>("/api/app/requests", { repo, title: title.trim(), body: detail.trim() });
      setNotice({ variant: "success", title: `Requested "${title.trim()}" in ${repo}`, description: "Agents working in that repository pick it up from its board. Their progress shows up here." });
      setTitle("");
      setDetail("");
      setCreating(false);
      onChanged();
    } catch (err) {
      setFormError(reason(err));
    } finally {
      setSending(false);
    }
  };

  const decide = async (r: WorkRequest, verdict: "accept" | "changes"): Promise<void> => {
    const note = (notes[r.id] ?? "").trim();
    if ((verdict === "changes" && !note) || busy) return;
    setBusy(`${r.id}:${verdict}`);
    setNotice(null);
    try {
      await post<{ status: WorkStatus }>("/api/app/work/review", { id: r.id, verdict, note });
      setNotes((prev) => ({ ...prev, [r.id]: "" }));
      setNotice(
        verdict === "accept"
          ? { variant: "success", title: `Accepted "${r.title}"`, description: "It is marked done and moved to Finished." }
          : { variant: "default", title: `Sent "${r.title}" back with your note`, description: "The agent sees your note on the board. It stays under In progress until it is submitted again." },
      );
      onChanged();
    } catch (err) {
      setNotice({ variant: "danger", title: reason(err) });
      if (err instanceof ApiError && (err.code === "not_in_review" || err.code === "not_found")) onChanged();
    } finally {
      setBusy(null);
    }
  };

  const toggle = (id: string): void => setOpenIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const list = (items: WorkRequest[]): JSX.Element => (
    <Card theme={THEME} padding={0}>
      {items.map((r, i) => {
        const open = openIds.includes(r.id);
        const s = STATUS[statusOf(r)];
        return (
          <div key={r.id} style={{ borderBottom: i < items.length - 1 ? `1px solid ${pal.borderSubtle}` : "none" }}>
            <button type="button" className="cb-work-row" aria-expanded={open} onClick={() => toggle(r.id)}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", ...tokens.type.base, fontWeight: tokens.weight.medium, overflowWrap: "anywhere" }}>{r.title}</span>
                <span style={{ display: "block", ...tokens.type.sm, color: pal.textTertiary, marginTop: 1, overflowWrap: "anywhere" }}>{meta(r, view.now)}</span>
              </span>
              <StatusBadge status={s.badge} theme={THEME}>
                {s.label}
              </StatusBadge>
            </button>
            {open ? (
              <div style={{ padding: "4px 16px 16px" }}>
                <Timeline request={r} login={login} now={view.now} />
              </div>
            ) : null}
          </div>
        );
      })}
    </Card>
  );

  const section = (label: string, items: WorkRequest[]): JSX.Element | null =>
    items.length ? (
      <Stack gap={10}>
        <Caption theme={THEME}>
          {`${label} · ${items.length}`}
        </Caption>
        {list(items)}
      </Stack>
    ) : null;

  return (
    <Stack gap={24}>
      <Stack direction="row" justify="space-between" align="flex-end" gap={12} wrap>
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Heading level={4} theme={THEME}>
            Requests
          </Heading>
          <Text secondary theme={THEME}>
            Ask for work in a repository. Agents pick it up from the board, report back here, and hand you the result to accept or send back.
          </Text>
        </Stack>
        <Button variant={creating ? "ghost" : "secondary"} size="sm" theme={THEME} onClick={() => setCreating(!creating)}>
          {creating ? "Close" : "New request"}
        </Button>
      </Stack>

      {notice ? (
        <div aria-live="polite">
          <AlertBanner variant={notice.variant} title={notice.title} description={notice.description} theme={THEME} />
        </div>
      ) : null}

      {review.length ? (
        <Stack gap={12}>
          <Stack gap={2}>
            <Heading level={5} theme={THEME}>
              {review.length === 1 ? "1 request is waiting on your review" : `${review.length} requests are waiting on your review`}
            </Heading>
            <Text secondary theme={THEME} style={tokens.type.sm}>
              Accept to close it, or say what needs to change and it goes back to the agent.
            </Text>
          </Stack>
          {review.map((r) => {
            const note = notes[r.id] ?? "";
            return (
              <Card key={r.id} theme={THEME} padding={16} style={{ border: `1px solid ${pal.warning}66`, background: pal.warningBg }}>
                <Stack gap={14}>
                  <Stack direction="row" justify="space-between" align="flex-start" gap={12} wrap>
                    <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                      <Text theme={THEME} size="md" weight="semibold" style={{ overflowWrap: "anywhere" }}>
                        {r.title}
                      </Text>
                      <Text theme={THEME} secondary style={{ ...tokens.type.sm, overflowWrap: "anywhere" }}>
                        {meta(r, view.now)}
                      </Text>
                    </Stack>
                    <StatusBadge status={STATUS.review.badge} theme={THEME}>
                      {STATUS.review.label}
                    </StatusBadge>
                  </Stack>
                  <Timeline request={r} login={login} now={view.now} />
                  <Stack gap={6}>
                    <Caption theme={THEME}>YOUR NOTE</Caption>
                    <TextArea
                      value={note}
                      rows={3}
                      placeholder="What needs to change, or anything to say with your acceptance"
                      onChange={(next: string) => setNotes((prev) => ({ ...prev, [r.id]: next }))}
                      theme={THEME}
                    />
                  </Stack>
                  <Stack direction="row" gap={8} justify="flex-end" align="center" wrap>
                    {note.trim() ? null : (
                      <Text secondary theme={THEME} style={{ ...tokens.type.sm, marginRight: "auto" }}>
                        Requesting changes needs a note, so the agent knows what to fix.
                      </Text>
                    )}
                    <Button variant="secondary" size="sm" theme={THEME} disabled={busy !== null || !note.trim()} onClick={() => void decide(r, "changes")}>
                      {busy === `${r.id}:changes` ? "Sending" : "Request changes"}
                    </Button>
                    <Button variant="primary" size="sm" theme={THEME} disabled={busy !== null} onClick={() => void decide(r, "accept")}>
                      {busy === `${r.id}:accept` ? "Accepting" : "Accept"}
                    </Button>
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      ) : view.requests.length ? (
        <Text secondary theme={THEME} style={tokens.type.sm}>
          {`Nothing is waiting on your review. ${plural(active.length, "request is", "requests are")} still with agents.`}
        </Text>
      ) : null}

      {creating ? (
        <Card theme={THEME} padding={16}>
          <Stack gap={14}>
            <Heading level={5} theme={THEME}>
              New request
            </Heading>
            <Stack gap={6}>
              <Caption theme={THEME}>REPOSITORY</Caption>
              <Select
                value={repo}
                options={repos}
                placeholder={repos.length ? "Pick a repository" : "No repositories yet"}
                disabled={sending || !repos.length}
                onChange={(next: string) => setRepo(next)}
                theme={THEME}
              />
            </Stack>
            <Stack gap={6}>
              <Caption theme={THEME}>WHAT YOU WANT DONE</Caption>
              <TextInput value={title} placeholder="One line an agent can act on" disabled={sending} onChange={(next: string) => setTitle(next)} theme={THEME} />
            </Stack>
            <Stack gap={6}>
              <Caption theme={THEME}>DETAIL, IF IT HELPS</Caption>
              <TextArea value={detail} rows={4} placeholder="Context, constraints, what done looks like" onChange={(next: string) => setDetail(next)} theme={THEME} />
            </Stack>
            {formError ? <AlertBanner variant="danger" title={formError} theme={THEME} /> : null}
            <Stack direction="row" gap={8} justify="flex-end" align="center" wrap>
              {repos.length ? null : (
                <Text secondary theme={THEME} style={{ ...tokens.type.sm, marginRight: "auto" }}>
                  Install the GitHub app on a repository first.
                </Text>
              )}
              <Button variant="primary" size="sm" theme={THEME} disabled={sending || !repo || !title.trim()} onClick={() => void create()}>
                {sending ? "Sending" : "Send request"}
              </Button>
            </Stack>
          </Stack>
        </Card>
      ) : null}

      {section("IN PROGRESS", active)}
      {section("FINISHED", finished)}

      {view.requests.length ? null : (
        <Card theme={THEME} padding={0}>
          <EmptyState
            title="No requests yet"
            description="Send one above. Agents connected to that repository pick requests up from its board, report progress here, and submit the result for you to review."
            theme={THEME}
          />
        </Card>
      )}
    </Stack>
  );
}
