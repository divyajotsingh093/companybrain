import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Caption,
  EmptyState,
  Heading,
  ListItem,
  Orb,
  Skeleton,
  Stack,
  StatusBadge,
  Text,
  ThemeProvider,
  tokens,
  usePal,
} from "./halaska-kit";

const THEME = "dark" as const;

interface Me {
  login: string;
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

const CLIENT_LABEL: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  web: "Web",
  import: "Import",
};

function when(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const diff = ms - now;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const [n, unit] = mins < 60 ? [mins, "min"] : mins < 2880 ? [Math.round(mins / 60), "h"] : [Math.round(mins / 1440), "d"];
  if (mins < 1) return "just now";
  return diff > 0 ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin" });
  if (r.status === 401) {
    location.href = "/";
    throw new Error("sign in");
  }
  return (await r.json()) as T;
}

function Overview({ me, onOpen }: { me: Me; onOpen: (repo: string) => void }): JSX.Element {
  return (
    <Stack gap={32}>
      <Stack gap={10}>
        <Caption theme={THEME}>REPOSITORIES YOU AND YOUR AGENTS SHARE</Caption>
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

      <Stack gap={10}>
        <Caption theme={THEME}>AGENTS CONNECTED</Caption>
        <Card theme={THEME} padding={0}>
          {me.tokens.length ? (
            me.tokens.map((t, i) => (
              <ListItem
                key={t.id}
                title={CLIENT_LABEL[t.client] ?? t.client}
                subtitle={`Last used ${when(t.lastUsedAt)} · expires ${when(t.expiresAt)}`}
                right={<StatusBadge status={t.lastUsedAt ? "success" : "default"} theme={THEME}>{t.lastUsedAt ? "active" : "unused"}</StatusBadge>}
                divider={i < me.tokens.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <EmptyState title="No agents connected" description="Create a token on the home page, then paste its setup into the agent." theme={THEME} />
          )}
        </Card>
      </Stack>

      <Stack gap={10}>
        <Caption theme={THEME}>RECENT AGENT ACTIVITY</Caption>
        <Card theme={THEME} padding={0}>
          {me.activity.length ? (
            me.activity.map((e, i) => (
              <ListItem
                key={`${e.at}-${i}`}
                title={e.tool}
                subtitle={`${CLIENT_LABEL[e.client] ?? e.client} · ${e.subject ?? "no subject"} · ${when(e.at)}`}
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

function BoardScreen({ view, onBack }: { view: BoardView; onBack: () => void }): JSX.Element {
  const section = (label: string, posts: Post[], empty: string): JSX.Element => (
    <Stack gap={10}>
      <Caption theme={THEME}>
        {label} · {posts.length}
      </Caption>
      <Card theme={THEME} padding={0}>
        {posts.length ? (
          posts.map((p, i) => (
            <ListItem
              key={p.id}
              title={p.title}
              subtitle={`${p.authorLogin} via ${CLIENT_LABEL[p.client] ?? p.client} · ${when(p.createdAt, view.now)}${p.target ? ` · on ${p.target}` : ""}${p.to ? ` · for ${p.to}` : ""}`}
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
      {section("ACTIVE CLAIMS", view.claims, "Nobody holds a claim")}
      {section("FINDINGS AND HANDOFFS", view.recent, "Nothing recorded yet")}
      {section("OPEN TASKS", view.tasks, "No open tasks")}
    </Stack>
  );
}

export function App(): JSX.Element {
  const pal = usePal(THEME);
  const [me, setMe] = useState<Me | null>(null);
  const [board, setBoard] = useState<BoardView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void get<Me>("/api/app/me")
      .then(setMe)
      .finally(() => setLoading(false));
  }, []);

  const openRepo = (repo: string): void => {
    setBoard(null);
    void get<BoardView>(`/api/app/board?repo=${encodeURIComponent(repo)}`).then(setBoard);
  };

  return (
    <ThemeProvider theme={THEME}>
      <div style={{ background: pal.bg, minHeight: "100vh", padding: "40px 20px 88px" }}>
        <Stack gap={32} style={{ maxWidth: 860, margin: "0 auto" }}>
          <Stack direction="row" gap={12} align="center" justify="space-between" wrap>
            <Stack direction="row" gap={10} align="center">
              <Orb variant="orbit" size={26} theme={THEME} />
              <Heading level={3} theme={THEME}>
                Company Brain
              </Heading>
            </Stack>
            <Text secondary theme={THEME} style={{ fontFamily: tokens.font.mono }}>
              {me?.login ?? ""}
            </Text>
          </Stack>

          {loading ? (
            <Stack gap={12}>
              <Skeleton theme={THEME} />
              <Skeleton theme={THEME} />
            </Stack>
          ) : me?.error ? (
            <Card theme={THEME}>
              <CardHeader title="GitHub could not be reached" subtitle={me.error} theme={THEME} />
            </Card>
          ) : board ? (
            <BoardScreen view={board} onBack={() => setBoard(null)} />
          ) : me ? (
            <Overview me={me} onOpen={openRepo} />
          ) : null}
        </Stack>
      </div>
    </ThemeProvider>
  );
}
