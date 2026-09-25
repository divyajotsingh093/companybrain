import { useEffect, useState, type JSX } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { injectGlobalStyles } from "./global-styles";
import { AskScreen, type Turn } from "./ask";
import { GraphScreen } from "./graph";
import { FilesSection, UPLOADS } from "./files";
import { GatewayScreen } from "./gateway";
import { Shell } from "./shell";
import { HomeScreen, type Destination } from "./home";
import { MemoryScreen, type MemoryEntry } from "./memory";
import { SkillsScreen, type SkillEntry } from "./skills";
import { WorkScreen, pendingReviews, type Work } from "./work";
import { clientName, ERROR_COPY, get, reason, send, THEME, when } from "./shared";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  CardHeader,
  Caption,
  EmptyState,
  Heading,
  ListItem,
  Select,
  Skeleton,
  Stack,
  StatusBadge,
  Tag,
  Text,
  TextArea,
  TextInput,
  tokens,
  usePal,
} from "./ui";


interface StarterAgent {
  name: string;
  summary: string;
  skill: string;
  owns: string;
  asks: string;
  prompt: string;
}

interface Me {
  login: string;
  profile?: { name: string; company: string; kit: string; agents: string[]; askedAt: number | null } | null;
  starterAgents?: StarterAgent[];
  repos: Array<{ fullName: string; private: boolean; pushedAt?: string }>;
  tokens: Array<{ id: string; client: string; createdAt: number; lastUsedAt: number | null; expiresAt: number }>;
  activity: Array<{ at: number; client: string; tool: string; subject: string | null; ok: boolean }>;
  error?: string;
}

interface Post {
  id: string;
  type: string;
  title: string;
  body: string;
  target: string | null;
  to: string | null;
  authorLogin: string;
  client: string;
  createdAt: number;
  expiresAt: number | null;
}

interface BoardView {
  repo: string;
  role: string;
  moderator: boolean;
  tasks: Post[];
  claims: Post[];
  recent: Post[];
  now: number;
  error?: string;
}

const ENTRY_KINDS = ["project", "memory", "skill", "process", "rule", "lesson", "record", "role"] as const;

type EntryKind = (typeof ENTRY_KINDS)[number];

interface Entry {
  id: string;
  kind: EntryKind;
  ownerUid: number;
  name: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

interface Decisions {
  open: Post[];
  now: number;
}

interface Brain {
  kinds: Record<EntryKind, Entry[]>;
  limit: number;
  memoryTypes: Record<string, string>;
  skillParts: Record<string, string>;
  now: number;
}



interface Sources {
  sources: Array<{ repoName: string; documents: number; indexedAt: number }>;
  ownFiles?: number;
  canAsk: boolean;
  now: number;
}

interface Indexed {
  repo: string;
  indexed: number;
  skipped: number;
  error?: string;
  message?: string;
}

type Screen = "home" | "ask" | "graph" | "overview" | "work" | "sources" | "agents" | "gateway" | "decisions" | EntryKind;

const KIND_LABEL: Record<EntryKind, string> = {
  project: "Projects",
  memory: "Memory",
  skill: "Skills",
  process: "Processes",
  rule: "Rules",
  lesson: "Lessons",
  record: "Records",
  role: "Roles",
};

const KIND_SINGULAR: Record<EntryKind, string> = {
  project: "project",
  memory: "memory",
  skill: "skill",
  process: "process",
  rule: "rule",
  lesson: "lesson",
  record: "record",
  role: "role",
};

const KIND_PURPOSE: Record<EntryKind, string> = {
  project: "A piece of ongoing work and the state it is in.",
  memory: "Something learned that should survive this session.",
  skill: "A reusable instruction someone can follow later.",
  process: "How a recurring piece of work actually gets done, step by step.",
  rule: "A boundary, policy or approval requirement that constrains what may be done.",
  lesson: "What went wrong once and what to do differently.",
  record: "An observed fact with its evidence, not an opinion.",
  role: "Who owns an area and what they decide.",
};

const WIKI_LINK = /\[\[([^\]\n]{1,120})\]\]/g;
const REPO_MENTION = /(?:^|[\s(])([A-Za-z][\w-]{0,38})\/([A-Za-z][\w-]{0,99})(?=$|[\s),]|\.(?!\w))/g;

function isEntryKind(screen: Screen): screen is EntryKind {
  return (ENTRY_KINDS as readonly string[]).includes(screen);
}

function connections(body: string): string[] {
  const found = new Map<string, string>();
  for (const match of body.matchAll(WIKI_LINK)) {
    const name = (match[1] ?? "").replace(/\s+/g, " ").trim();
    if (name) found.set(`entry:${name.toLowerCase()}`, name);
  }
  for (const match of body.matchAll(REPO_MENTION)) {
    const name = `${match[1]}/${match[2]}`;
    if (name.length <= 140) found.set(`repo:${name.toLowerCase()}`, name);
  }
  return [...found.values()];
}


const SCREEN_LABEL: Record<Screen, string> = {
  home: "Home",
  ask: "Ask",
  graph: "Graph",
  overview: "Overview",
  work: "Requests",
  sources: "Sources",
  agents: "Agents",
  gateway: "Gateway",
  decisions: "Decisions",
  ...KIND_LABEL,
};

const NAV_GROUPS: Array<{ group: string | null; items: Screen[] }> = [
  { group: null, items: ["home", "ask", "graph", "overview"] },
  { group: "Work", items: ["work", "project", "sources"] },
  { group: "Knowledge", items: ["memory", "record", "lesson"] },
  { group: "Operating", items: ["process", "rule", "role"] },
  { group: "Build", items: ["skill", "agents", "gateway"] },
  { group: "Judgment", items: ["decisions"] },
];

const NARROW_WIDTH = 900;

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < NARROW_WIDTH);
  useEffect(() => {
    const onResize = (): void => setNarrow(window.innerWidth < NARROW_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

function Overview({ me, onOpen }: { me: Me; onOpen: (repo: string) => void }): JSX.Element {
  return (
    <Stack gap={14}>
      <Stack gap={2}>
        <Heading level={4} theme={THEME}>
          Repositories
        </Heading>
        <Text secondary theme={THEME}>
          What you and your agents share.
        </Text>
      </Stack>
      <Card theme={THEME} padding={0}>
        {me.repos.length ? (
          me.repos.map((repo, i) => (
            <ListItem
              key={repo.fullName}
              title={repo.fullName}
              subtitle={repo.pushedAt ? `Last push ${when(Date.parse(repo.pushedAt))}` : "No pushes yet"}
              right={repo.private ? <Badge theme={THEME}>private</Badge> : undefined}
              divider={i < me.repos.length - 1}
              onClick={() => onOpen(repo.fullName)}
              theme={THEME}
            />
          ))
        ) : (
          <EmptyState
            title="No repositories yet"
            description="Install the GitHub app on a repository, then it shows up here with its board."
            theme={THEME}
          />
        )}
      </Card>
    </Stack>
  );
}

function StarterAgents({ agents }: { agents: StarterAgent[] }): JSX.Element | null {
  const pal = usePal();
  const [copied, setCopied] = useState<{ name: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2400);
    return () => clearTimeout(t);
  }, [copied]);
  if (!agents.length) return null;
  const copy = async (a: StarterAgent): Promise<void> => {
    try {
      await navigator.clipboard.writeText(a.prompt);
      setCopied({ name: a.name, ok: true });
    } catch {
      setCopied({ name: a.name, ok: false });
    }
  };
  return (
    <Stack gap={10}>
      <Stack gap={2}>
        <Heading level={4} theme={THEME}>
          Starter agents
        </Heading>
        <Text secondary theme={THEME}>
          Ready-made roles from your starter kit. Connect Claude Code, Codex, Cursor or Grok, then paste a kickoff prompt to start one.
        </Text>
      </Stack>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))" }}>
        {agents.map((a) => (
          <Card key={a.name} theme={THEME} style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Stack gap={10} style={{ flex: 1 }}>
              <Stack gap={4}>
                <Text theme={THEME} weight="semibold">
                  {a.name}
                </Text>
                <Text secondary size="sm" theme={THEME}>
                  {a.summary}
                </Text>
              </Stack>
              <Text secondary size="sm" theme={THEME} style={{ color: pal.textTertiary }}>
                {`Follows the \u201c${a.skill}\u201d skill. Asks you before ${a.asks.charAt(0).toLowerCase()}${a.asks.slice(1)}`}
              </Text>
              <div style={{ flex: 1 }} />
              <div role="status" aria-live="polite" style={{ minHeight: 18, fontSize: 12.5, color: copied?.ok === false ? pal.danger : pal.accentText }}>
                {copied?.name === a.name ? (copied.ok ? "Kickoff prompt copied." : "Copy failed. Select the prompt in the role entry instead.") : ""}
              </div>
              <Button variant="secondary" size="sm" theme={THEME} onClick={() => void copy(a)}>
                Copy kickoff prompt
              </Button>
            </Stack>
          </Card>
        ))}
      </div>
    </Stack>
  );
}

function AgentsScreen({ me }: { me: Me }): JSX.Element {
  return (
    <Stack gap={32}>
      <StarterAgents agents={me.starterAgents ?? []} />
      <Stack gap={10}>
        <Heading level={4} theme={THEME}>
          Connected agents
        </Heading>
        <Card theme={THEME} padding={0}>
          {me.tokens.length ? (
            me.tokens.map((t, i) => (
              <ListItem
                key={t.id}
                title={clientName(t.client)}
                subtitle={`Last used ${when(t.lastUsedAt)} · expires ${when(t.expiresAt)}`}
                right={<StatusBadge status={t.lastUsedAt ? "success" : "default"} theme={THEME}>{t.lastUsedAt ? "active" : "unused"}</StatusBadge>}
                divider={i < me.tokens.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <Stack gap={12} style={{ padding: 20 }}>
              <EmptyState title="No agents connected" description="Pick your agent on the setup page to get a token and a setup to paste into it. For Claude Code it is one terminal command." theme={THEME} />
              <div>
                <Button variant="primary" size="sm" theme={THEME} onClick={() => window.location.assign("/")}>
                  Connect an agent
                </Button>
              </div>
            </Stack>
          )}
        </Card>
      </Stack>

      <Stack gap={10}>
        <Heading level={4} theme={THEME}>
          Recent activity
        </Heading>
        <Card theme={THEME} padding={0}>
          {me.activity.length ? (
            me.activity.map((e, i) => (
              <ListItem
                key={`${e.at}-${i}`}
                title={e.tool}
                subtitle={`${clientName(e.client)} · ${e.subject ?? "no subject"} · ${when(e.at)}`}
                right={<StatusBadge status={e.ok ? "success" : "error"} theme={THEME}>{e.ok ? "ok" : "failed"}</StatusBadge>}
                divider={i < me.activity.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <EmptyState title="No calls yet" description="Every tool call an agent makes is recorded here." theme={THEME} />
          )}
        </Card>
      </Stack>
    </Stack>
  );
}


function NotConfigured(): JSX.Element {
  return (
    <AlertBanner
      variant="warning"
      title="Answering is not configured yet"
      description="Indexing still works and your sources are kept. Questions need a model configured on the server before they can be answered."
      theme={THEME}
    />
  );
}

const STALE_AFTER = 48 * 3_600_000;

function SourcesScreen({ view, repos, onIndexed }: { view: Sources; repos: Me["repos"]; onIndexed: () => void }): JSX.Element {
  const [repo, setRepo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const indexed = view.sources.filter((s) => s.repoName !== UPLOADS);

  const index = async (target: string): Promise<void> => {
    if (!target || busy) return;
    setBusy(target);
    setFailed(null);
    setDone(null);
    try {
      const result = await send<Indexed>("/api/app/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo: target }) });
      if (result.error) {
        setFailed(result.message ?? ERROR_COPY[result.error] ?? "the request failed");
        return;
      }
      const skipped = result.skipped ? `, ${result.skipped} skipped` : "";
      setDone(`Indexed ${result.indexed} document${result.indexed === 1 ? "" : "s"} from ${result.repo}${skipped}.`);
      onIndexed();
    } catch (err) {
      setFailed(reason(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap={32}>
      <Stack gap={24}>
        <Stack gap={2}>
          <Heading level={4} theme={THEME}>
            Sources
          </Heading>
          <Text secondary theme={THEME}>
            The repositories and files your answers are allowed to read from.
          </Text>
        </Stack>

        {view.canAsk ? null : <NotConfigured />}

        <Stack gap={10}>
          <Stack direction="row" gap={10} align="flex-end" wrap>
            <Select
              value={repo}
              options={repos.map((r) => r.fullName)}
              placeholder="Pick a repository"
              disabled={busy !== null || !repos.length}
              onChange={(next: string) => setRepo(next)}
              theme={THEME}
              style={{ minWidth: 260, flex: 1 }}
            />
            <Button variant="primary" size="md" theme={THEME} disabled={busy !== null || !repo} onClick={() => void index(repo)}>
              {busy === repo ? "Indexing" : "Index"}
            </Button>
          </Stack>
          {busy ? (
            <Stack gap={8}>
              <Text secondary theme={THEME}>
                Reading {busy}. This takes a few seconds.
              </Text>
              <Skeleton theme={THEME} />
            </Stack>
          ) : null}
          {failed ? <AlertBanner variant="danger" title={failed} theme={THEME} /> : null}
          {done ? <AlertBanner variant="success" title={done} theme={THEME} /> : null}
        </Stack>

        <Stack gap={8}>
          <Card theme={THEME} padding={0}>
            {indexed.length ? (
              indexed.map((s, i) => {
                const stale = view.now - s.indexedAt > STALE_AFTER;
                return (
                  <ListItem
                    key={s.repoName}
                    title={s.repoName}
                    subtitle={`${s.documents} document${s.documents === 1 ? "" : "s"} · refreshed ${when(s.indexedAt, view.now)}`}
                    right={
                      <Stack direction="row" gap={8} align="center">
                        {stale ? (
                          <Badge variant="warning" theme={THEME}>
                            Stale
                          </Badge>
                        ) : null}
                        <Button variant="ghost" size="sm" theme={THEME} disabled={busy !== null} onClick={() => void index(s.repoName)}>
                          {busy === s.repoName ? "Refreshing" : "Refresh now"}
                        </Button>
                      </Stack>
                    }
                    divider={i < indexed.length - 1}
                    theme={THEME}
                  />
                );
              })
            ) : (
              <EmptyState
                title="No repositories indexed yet"
                description="Pick one of your repositories above and index it. Its readme and docs become what answers are drawn from."
                theme={THEME}
              />
            )}
          </Card>
          <Caption theme={THEME}>Repositories refresh on their own once a day. If you lose access to one, its documents are removed at the next refresh.</Caption>
        </Stack>
      </Stack>

      <FilesSection onChanged={onIndexed} />
    </Stack>
  );
}

function EntryEditor({ kind, entry, onClose, onSaved }: { kind: EntryKind; entry: Entry | null; onClose: () => void; onSaved: () => void }): JSX.Element {
  const pal = usePal(THEME);
  const [name, setName] = useState(entry?.name ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const editing = entry !== null;

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailed(null);
    try {
      await send("/api/app/brain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name, body }),
      });
      onSaved();
      onClose();
    } catch (err) {
      setFailed(reason(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(next: boolean) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Backdrop style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)" }} />
        <Dialog.Popup
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "min(560px, calc(100vw - 32px))",
            maxHeight: "calc(100vh - 64px)",
            overflowY: "auto",
            background: pal.bgElevated,
            border: `1px solid ${pal.border}`,
            borderRadius: 12,
            padding: 20,
          }}
        >
          <Stack gap={16}>
            <Stack gap={4}>
              <Dialog.Title style={{ margin: 0, ...tokens.type.lg, color: pal.text }}>
                {editing ? `Edit ${KIND_SINGULAR[kind]}` : `New ${KIND_SINGULAR[kind]}`}
              </Dialog.Title>
              {editing ? null : (
                <Dialog.Description style={{ margin: 0, ...tokens.type.sm, color: pal.textSecondary }}>
                  {KIND_PURPOSE[kind]}
                </Dialog.Description>
              )}
            </Stack>
            <Stack gap={6}>
              <Caption theme={THEME}>NAME</Caption>
              <TextInput
                value={name}
                disabled={editing}
                placeholder={`What this ${KIND_SINGULAR[kind]} is about`}
                onChange={(next: string) => setName(next)}
                theme={THEME}
              />
            </Stack>
            <Stack gap={6}>
              <Caption theme={THEME}>BODY</Caption>
              <TextArea
                value={body}
                rows={10}
                placeholder="What an agent should know next time"
                onChange={(next: string) => setBody(next)}
                theme={THEME}
              />
              <Caption theme={THEME}>WRITE [[A NAME]] TO CONNECT ANOTHER ENTRY, OR A REPOSITORY AS OWNER/NAME</Caption>
            </Stack>
            {failed ? (
              <Text theme={THEME} style={{ color: pal.danger ?? pal.text }}>
                {failed}
              </Text>
            ) : null}
            <Stack direction="row" gap={8} justify="flex-end">
              <Button variant="ghost" size="sm" theme={THEME} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" theme={THEME} disabled={busy || !name.trim() || !body.trim()} onClick={() => void save()}>
                {busy ? "Saving" : "Save"}
              </Button>
            </Stack>
          </Stack>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DecisionsScreen({ view, onAnswered }: { view: Decisions; onAnswered: () => void }): JSX.Element {
  const pal = usePal(THEME);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const submit = async (post: Post): Promise<void> => {
    const answer = (drafts[post.id] ?? "").trim();
    if (!answer) return;
    setBusy(post.id);
    setFailed(null);
    try {
      await send("/api/app/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: post.id, answer }) });
      setDrafts((prev) => ({ ...prev, [post.id]: "" }));
      setOpenId(null);
      onAnswered();
    } catch (err) {
      setFailed(reason(err));
      onAnswered();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack gap={10}>
      <Stack gap={2}>
        <Heading level={4} theme={THEME}>
          Waiting on you
        </Heading>
        <Text secondary theme={THEME}>
          {view.open.length
            ? "Your agents keep working inside their instructions. These are the calls they will not make for you."
            : "Your agents keep working inside their instructions."}
        </Text>
      </Stack>
      {failed ? (
        <Text theme={THEME} style={{ color: pal.danger ?? pal.text }}>
          {failed}
        </Text>
      ) : null}
      <Card theme={THEME} padding={0}>
        {view.open.length ? (
          view.open.map((post, i) => {
            const open = openId === post.id;
            const last = i === view.open.length - 1;
            return (
              <div key={post.id}>
                <ListItem
                  title={post.title}
                  subtitle={`${post.authorLogin} via ${clientName(post.client)} · ${when(post.createdAt, view.now)}`}
                  right={<StatusBadge status="warning" theme={THEME}>needs a ruling</StatusBadge>}
                  divider={!open && !last}
                  onClick={() => setOpenId(open ? null : post.id)}
                  theme={THEME}
                />
                {open ? (
                  <Stack gap={12} style={{ padding: "0 16px 16px", borderBottom: last ? "none" : `1px solid ${pal.borderSubtle}` }}>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        fontFamily: tokens.font.mono,
                        ...tokens.type.sm,
                        color: pal.textSecondary,
                      }}
                    >
                      {post.body}
                    </pre>
                    <TextArea
                      value={drafts[post.id] ?? ""}
                      rows={3}
                      placeholder="Your ruling, and the reason if it is not obvious"
                      onChange={(next: string) => setDrafts((prev) => ({ ...prev, [post.id]: next }))}
                      theme={THEME}
                    />
                    <Stack direction="row" gap={8} justify="flex-end" align="center">
                      <Text secondary theme={THEME} style={tokens.type.sm}>
                        Nothing is promised until you answer.
                      </Text>
                      <Button
                        variant="primary"
                        size="sm"
                        theme={THEME}
                        disabled={busy === post.id || !(drafts[post.id] ?? "").trim()}
                        onClick={() => void submit(post)}
                      >
                        {busy === post.id ? "Sending" : "Send ruling"}
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </div>
            );
          })
        ) : (
          <EmptyState
            title="Nothing is waiting on you"
            description="When an agent reaches a call it will not make on its own, it stops and asks here with what it would recommend."
            theme={THEME}
          />
        )}
      </Card>
    </Stack>
  );
}

function EntryBody({ body }: { body: string }): JSX.Element {
  const pal = usePal(THEME);
  const parts: JSX.Element[] = [];
  let read = 0;
  for (const match of body.matchAll(WIKI_LINK)) {
    const at = match.index ?? 0;
    if (at > read) parts.push(<span key={`text-${read}`}>{body.slice(read, at)}</span>);
    parts.push(
      <span key={`link-${at}`} style={{ color: pal.accentText ?? pal.accent, background: `${pal.accent}1f`, borderRadius: 4, padding: "0 4px" }}>
        {match[1]}
      </span>,
    );
    read = at + match[0].length;
  }
  if (read < body.length) parts.push(<span key={`text-${read}`}>{body.slice(read)}</span>);

  return (
    <pre
      style={{
        margin: 0,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontFamily: tokens.font.mono,
        ...tokens.type.sm,
        color: pal.textSecondary,
      }}
    >
      {parts}
    </pre>
  );
}

function Connections({ body }: { body: string }): JSX.Element | null {
  const linked = connections(body);
  if (!linked.length) return null;
  return (
    <Stack gap={8}>
      <Caption theme={THEME}>CONNECTS TO</Caption>
      <Stack direction="row" gap={6} wrap>
        {linked.map((name) => (
          <Tag key={name} theme={THEME}>
            {name}
          </Tag>
        ))}
      </Stack>
    </Stack>
  );
}

function EntriesScreen({ kind, entries, now, limit, onChanged }: { kind: EntryKind; entries: Entry[]; now: number; limit: number; onChanged: () => void }): JSX.Element {
  const pal = usePal(THEME);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const remove = async (entry: Entry): Promise<void> => {
    setRemoving(entry.id);
    setFailed(null);
    try {
      await send(`/api/app/brain?kind=${kind}&name=${encodeURIComponent(entry.name)}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setFailed(reason(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Stack gap={10}>
      <Stack direction="row" justify="space-between" align="center" gap={12} wrap>
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Heading level={4} theme={THEME}>
            {KIND_LABEL[kind]}
          </Heading>
          <Text secondary theme={THEME}>
            {KIND_PURPOSE[kind]}
          </Text>
        </Stack>
        <Stack direction="row" gap={10} align="center">
          <Caption theme={THEME} data-numeric>
            {entries.length}
            {entries.length >= limit ? " SHOWN, NEWEST FIRST" : entries.length === 1 ? " ENTRY" : " ENTRIES"}
          </Caption>
          <Button variant="secondary" size="sm" theme={THEME} onClick={() => setCreating(true)}>
            New {KIND_SINGULAR[kind]}
          </Button>
        </Stack>
      </Stack>
      {failed ? (
        <Text theme={THEME} style={{ color: pal.danger ?? pal.text }}>
          {failed}
        </Text>
      ) : null}
      <Card theme={THEME} padding={0}>
        {entries.length ? (
          entries.map((entry, i) => {
            const open = openId === entry.id;
            const last = i === entries.length - 1;
            return (
              <div key={entry.id}>
                <ListItem
                  title={entry.name}
                  subtitle={`Updated ${when(entry.updatedAt, now)} · ${entry.body.length} characters`}
                  divider={!open && !last}
                  onClick={() => setOpenId(open ? null : entry.id)}
                  theme={THEME}
                />
                {open ? (
                  <Stack gap={14} style={{ padding: "0 16px 16px", borderBottom: last ? "none" : `1px solid ${pal.borderSubtle}` }}>
                    <Stack direction="row" gap={8}>
                      <Button variant="ghost" size="sm" theme={THEME} onClick={() => setEditing(entry)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" theme={THEME} disabled={removing === entry.id} onClick={() => void remove(entry)}>
                        {removing === entry.id ? "Removing" : "Remove"}
                      </Button>
                    </Stack>
                    <EntryBody body={entry.body} />
                    <Connections body={entry.body} />
                  </Stack>
                ) : null}
              </div>
            );
          })
        ) : (
          <EmptyState
            title={`No ${KIND_LABEL[kind].toLowerCase()} yet`}
            description={`${KIND_PURPOSE[kind]} Agents write these with the brain_write tool, or add a ${KIND_SINGULAR[kind]} yourself.`}
            theme={THEME}
          />
        )}
      </Card>
      {creating ? <EntryEditor kind={kind} entry={null} onClose={() => setCreating(false)} onSaved={onChanged} /> : null}
      {editing ? <EntryEditor kind={kind} entry={editing} onClose={() => setEditing(null)} onSaved={onChanged} /> : null}
    </Stack>
  );
}

function BoardScreen({ view, onBack }: { view: BoardView; onBack: () => void }): JSX.Element {
  const section = (label: string, posts: Post[], empty: string): JSX.Element => (
    <Stack gap={10}>
      <Stack gap={2}>
        <Heading level={4} theme={THEME}>
          {label}
        </Heading>
        <Text secondary theme={THEME} data-numeric>
          {posts.length}
        </Text>
      </Stack>
      <Card theme={THEME} padding={0}>
        {posts.length ? (
          posts.map((p, i) => (
            <ListItem
              key={p.id}
              title={p.title}
              subtitle={`${p.authorLogin} via ${clientName(p.client)} · ${when(p.createdAt, view.now)}${p.target ? ` · on ${p.target}` : ""}${p.to ? ` · for ${p.to}` : ""}`}
              right={p.expiresAt ? <Badge theme={THEME}>{when(p.expiresAt, view.now)}</Badge> : undefined}
              divider={i < posts.length - 1}
              theme={THEME}
            />
          ))
        ) : (
          <EmptyState title={empty} description="" theme={THEME} />
        )}
      </Card>
    </Stack>
  );

  return (
    <Stack gap={28}>
      <Stack direction="row" justify="space-between" align="center" wrap gap={12}>
        <Stack gap={4}>
          <Heading level={2} theme={THEME}>
            {view.repo}
          </Heading>
          <Text secondary theme={THEME}>
            Your access: {view.role}
            {view.moderator ? " · you can close anything here" : ""}
          </Text>
        </Stack>
        <Button variant="secondary" size="sm" theme={THEME} onClick={onBack}>
          All repositories
        </Button>
      </Stack>
      {section("Active claims", view.claims, "Nobody holds a claim")}
      {section("Findings, handoffs and decisions", view.recent, "Nothing recorded yet")}
      {section("Open tasks", view.tasks, "No open tasks")}
    </Stack>
  );
}

export function App(): JSX.Element {
  const pal = usePal(THEME);
  injectGlobalStyles(pal);
  const narrow = useNarrow();
  const [me, setMe] = useState<Me | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>("home");
  const [sources, setSources] = useState<Sources | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decisions | null>(null);
  const [decisionsError, setDecisionsError] = useState<string | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [thread, setThread] = useState<Turn[]>([]);
  const [seed, setSeed] = useState<string | undefined>(undefined);
  const [autoAsk, setAutoAsk] = useState(false);

  const loadDecisions = (): void => {
    void get<Decisions>("/api/app/decisions").then(
      (next) => {
        setDecisions(next);
        setDecisionsError(null);
      },
      (err: unknown) => setDecisionsError(reason(err)),
    );
  };

  const loadWork = (): void => {
    void get<Work>("/api/app/work").then(
      (next) => {
        setWork(next);
        setWorkError(null);
      },
      (err: unknown) => setWorkError(reason(err)),
    );
  };

  const loadSources = (): void => {
    void get<Sources>("/api/app/sources").then(
      (next) => {
        setSources(next);
        setSourcesError(null);
      },
      (err: unknown) => setSourcesError(reason(err)),
    );
  };

  const loadBrain = (): void => {
    void get<Brain>("/api/app/brain").then(
      (next) => {
        setBrain(next);
        setBrainError(null);
      },
      (err: unknown) => setBrainError(reason(err)),
    );
  };

  useEffect(() => {
    void get<Me>("/api/app/me")
      .then(setMe, (err: unknown) => setFailed(reason(err)))
      .finally(() => setLoading(false));
    loadBrain();
    loadDecisions();
    loadWork();
    loadSources();
  }, []);

  const openRepo = (repo: string): void => {
    setBoard(null);
    setFailed(null);
    void get<BoardView>(`/api/app/board?repo=${encodeURIComponent(repo)}`).then(setBoard, (err: unknown) => setFailed(`${repo} could not be opened: ${reason(err)}.`));
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, board]);

  const select = (next: Screen): void => {
    setBoard(null);
    setSeed(undefined);
    setAutoAsk(false);
    setFailed(null);
    setScreen(next);
    loadDecisions();
    loadWork();
    if (next === "sources" || next === "ask" || next === "home") loadSources();
    if (isEntryKind(next) || next === "home") loadBrain();
  };

  const go = (next: Destination, text?: string): void => {
    select(next);
    if (text) {
      if (next === "ask") setThread([]);
      setSeed(text);
      setAutoAsk(next === "ask");
    }
  };

  const skeleton = (
    <Stack gap={12}>
      <Skeleton theme={THEME} />
      <Skeleton theme={THEME} />
    </Stack>
  );

  const content = (): JSX.Element | null => {
    if (loading) return skeleton;
    if (me?.error) {
      return (
        <Card theme={THEME}>
          <CardHeader title="GitHub could not be reached" subtitle={me.error} theme={THEME} />
        </Card>
      );
    }
    if (failed) {
      return (
        <Card theme={THEME}>
          <CardHeader title="That did not load" subtitle={`${failed} Reload to try again.`} theme={THEME} />
        </Card>
      );
    }
    if (board) return <BoardScreen view={board} onBack={() => select("overview")} />;
    if (!me) return null;
    if (screen === "home") {
      const memories = (brain?.kinds.memory ?? []) as unknown as Array<{ memory?: { auto: boolean } }>;
      const skills = (brain?.kinds.skill ?? []) as unknown as Array<{ skill?: Record<string, { learned: unknown[] }> }>;
      return (
        <HomeScreen
          facts={{
            login: me.login,
            first: (me.profile?.name ?? "").split(/\s+/)[0] ?? "",
            kit: me.profile?.kit ?? "",
            asked: Boolean(me.profile?.askedAt) || thread.length > 0,
            knowledge: (sources?.ownFiles ?? 0) > 0 || (sources?.sources ?? []).some((s) => s.repoName !== UPLOADS),
            rules: brain?.kinds.rule.length ?? 0,
            starterAgents: me.starterAgents?.length ?? 0,
            agents: me.tokens.length,
            sources: sources?.sources.length ?? 0,
            memories: memories.length,
            taught: memories.some((m) => m.memory && !m.memory.auto) || skills.some((s) => Object.values(s.skill ?? {}).some((p) => p.learned.length > 0)),
            skills: skills.length,
            reviews: pendingReviews(work),
            decisions: decisions?.open.length ?? 0,
          }}
          onGo={go}
        />
      );
    }
    if (screen === "ask") {
      return <AskScreen thread={thread} setThread={setThread} canAsk={sources?.canAsk ?? true} seed={seed} autoAsk={autoAsk} onOpenGraph={() => select("graph")} onOpenDecisions={() => select("decisions")} />;
    }
    if (screen === "graph") {
      return (
        <GraphScreen
          onAsk={(question) => {
            setBoard(null);
            setSeed(question);
            setScreen("ask");
          }}
        />
      );
    }
    if (screen === "overview") return <Overview me={me} onOpen={openRepo} />;
    if (screen === "agents") return <AgentsScreen me={me} />;
    if (screen === "gateway") return <GatewayScreen />;
    if (screen === "work") {
      if (workError) {
        return (
          <Card theme={THEME}>
            <CardHeader title="Requests could not be loaded" subtitle={`${workError}. Reload to try again.`} theme={THEME} />
          </Card>
        );
      }
      if (!work) return skeleton;
      return <WorkScreen view={work} login={me.login} repos={me.repos.map((r) => r.fullName)} onChanged={loadWork} seed={seed} />;
    }
    if (screen === "sources") {
      if (sourcesError) {
        return (
          <Card theme={THEME}>
            <CardHeader title="Sources could not be loaded" subtitle={`${sourcesError}. Reload to try again.`} theme={THEME} />
          </Card>
        );
      }
      if (!sources) return skeleton;
      return <SourcesScreen view={sources} repos={me.repos} onIndexed={loadSources} />;
    }
    if (screen === "decisions") {
      if (decisionsError) {
        return (
          <Card theme={THEME}>
            <CardHeader title="Decisions could not be loaded" subtitle={`${decisionsError}. Reload to try again.`} theme={THEME} />
          </Card>
        );
      }
      if (!decisions) return skeleton;
      return <DecisionsScreen view={decisions} onAnswered={loadDecisions} />;
    }
    if (brainError) {
      return (
        <Card theme={THEME}>
          <CardHeader title="Your brain could not be loaded" subtitle={`Reading ${KIND_LABEL[screen].toLowerCase()} failed: ${brainError}. Reload to try again.`} theme={THEME} />
        </Card>
      );
    }
    if (!brain) return skeleton;
    if (screen === "memory") return <MemoryScreen entries={(brain.kinds.memory ?? []) as unknown as MemoryEntry[]} purposes={brain.memoryTypes} now={brain.now} onChanged={loadBrain} seed={seed} />;
    if (screen === "skill") return <SkillsScreen entries={(brain.kinds.skill ?? []) as unknown as SkillEntry[]} purposes={brain.skillParts} now={brain.now} onChanged={loadBrain} />;
    return <EntriesScreen key={screen} kind={screen} entries={brain.kinds[screen] ?? []} now={brain.now} limit={brain.limit} onChanged={loadBrain} />;
  };

  const eyebrow = board ? "Board" : (NAV_GROUPS.find((g) => g.items.includes(screen))?.group ?? SCREEN_LABEL[screen]);

  return (
    <div className="cb-root">
      <div className="cb-backdrop" aria-hidden />
      <div className="cb-grain" aria-hidden />
      <Shell
        groups={NAV_GROUPS}
        screen={screen}
        labels={SCREEN_LABEL}
        counts={{ decisions: decisions?.open.length ?? 0, work: pendingReviews(work) }}
        onSelect={select}
        login={me?.login ?? ""}
        narrow={narrow}
        eyebrow={eyebrow}
      >
        <div key={board ? "board" : screen} data-screen>
          {content()}
        </div>
      </Shell>
    </div>
  );
}
