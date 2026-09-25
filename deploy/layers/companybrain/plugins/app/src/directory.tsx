import { useEffect, useMemo, useState, type JSX } from "react";
import { AlertBanner, Badge, Button, Card, Heading, Skeleton, Stack, Tag, Text, TextInput, usePal } from "./ui";
import { ApiError, THEME, get, post, reason } from "./shared";

interface DirectoryServer {
  slug: string;
  name: string;
  url: string;
  auth: "oauth" | "bearer" | "none";
  category: string;
  description: string;
  publisher: string;
  official: boolean;
}

const PAGE = 24;
const AUTH_LABEL: Record<DirectoryServer["auth"], string> = { oauth: "Sign in", bearer: "Token", none: "No sign-in" };

export function Directory({ connected, stale, full, onConnected }: { connected: Set<string>; stale: Set<string>; full: boolean; onConnected: (text: string) => void }): JSX.Element {
  const pal = usePal(THEME);
  const [servers, setServers] = useState<DirectoryServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<{ slug: string; text: string } | null>(null);

  useEffect(() => {
    void get<{ servers: DirectoryServer[] }>("/api/app/directory").then(
      (next) => setServers(next.servers),
      (err: unknown) => setLoadError(reason(err)),
    );
  }, []);

  const categories = useMemo(() => [...new Set((servers ?? []).map((s) => s.category))].sort(), [servers]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (servers ?? [])
      .filter((s) => !category || s.category === category)
      .filter((s) => words.every((w) => `${s.name} ${s.publisher} ${s.description} ${s.category}`.toLowerCase().includes(w)))
      .sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name));
  }, [servers, query, category]);

  const connect = async (s: DirectoryServer): Promise<void> => {
    if (s.auth === "bearer" && asking !== s.slug) {
      setAsking(s.slug);
      setToken("");
      return;
    }
    setBusy(s.slug);
    setProblem(null);
    try {
      if (s.auth === "oauth") {
        const started = await post<{ redirect?: string; name?: string; tools?: number }>("/api/app/gateway/oauth/start", { name: s.slug, url: s.url });
        if (started.redirect) {
          window.location.assign(started.redirect);
          return;
        }
        onConnected(`Connected ${s.name}. It offers ${started.tools ?? 0} tools to your agents.`);
      } else {
        const done = await post<{ tools: number }>("/api/app/gateway", { name: s.slug, url: s.url, token: s.auth === "bearer" ? token.trim() : "" });
        onConnected(`Connected ${s.name}. It offers ${done.tools} ${done.tools === 1 ? "tool" : "tools"} to your agents.`);
        setAsking(null);
        setToken("");
      }
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : undefined;
      setProblem({ slug: s.slug, text: detail ? `${reason(err)} ${detail}` : reason(err) });
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <AlertBanner variant="danger" title="The directory could not be loaded" description={`${loadError}. Reload to try again.`} theme={THEME} />;
  if (!servers) return <Skeleton height={220} theme={THEME} />;

  const chip = (value: string | null, label: string) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        setCategory(value);
        setLimit(PAGE);
      }}
      aria-pressed={category === value}
      style={{
        border: 0,
        cursor: "pointer",
        padding: "5px 12px",
        borderRadius: 999,
        fontSize: 12.5,
        color: category === value ? pal.text : pal.textSecondary,
        background: category === value ? "rgba(15,174,147,0.18)" : "rgba(255,255,255,0.04)",
        boxShadow: `inset 0 0 0 1px ${category === value ? "rgba(15,174,147,0.5)" : "rgba(255,255,255,0.07)"}`,
      }}
    >
      {label}
    </button>
  );

  return (
    <Stack gap={12}>
      <Stack gap={4}>
        <Heading level={5} theme={THEME}>
          Directory
        </Heading>
        <Text secondary theme={THEME}>
          {`${servers.length} ready-made MCP servers. Connect one and every agent on your brain can use it. Servers marked Sign in open their own sign-in page; you approve there and come back here.`}
        </Text>
      </Stack>
      <TextInput label="Search the directory" value={query} placeholder="Linear, Stripe, Notion, analytics..." onChange={(next: string) => { setQuery(next); setLimit(PAGE); }} theme={THEME} />
      <div role="group" aria-label="Filter by category" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {chip(null, "All")}
        {categories.map((c) => chip(c, c))}
      </div>
      {full ? <AlertBanner variant="warning" title="You have reached the server limit. Remove one to connect another." theme={THEME} /> : null}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))" }}>
        {shown.slice(0, limit).map((s) => {
          const isConnected = connected.has(s.slug);
          const again = stale.has(s.slug);
          return (
            <Card key={s.slug} theme={THEME} style={{ display: "flex", flexDirection: "column" }}>
              <Stack gap={8} style={{ flex: 1 }}>
                <Stack direction="row" justify="space-between" align="center" gap={8}>
                  <Text theme={THEME} weight="semibold">
                    {s.name}
                  </Text>
                  <Tag>{AUTH_LABEL[s.auth]}</Tag>
                </Stack>
                <Stack direction="row" gap={6} align="center">
                  <Text secondary size="sm" theme={THEME}>
                    {s.publisher}
                  </Text>
                  {s.official ? <Badge>Official</Badge> : null}
                </Stack>
                <Text secondary size="sm" theme={THEME} style={{ flex: 1 }}>
                  {s.description}
                </Text>
                {asking === s.slug ? (
                  <TextInput label={`${s.name} token`} type="password" value={token} placeholder="Paste the API token" caption="Stored encrypted. Agents never see it." onChange={(next: string) => setToken(next)} theme={THEME} />
                ) : null}
                {problem?.slug === s.slug ? (
                  <Text size="sm" theme={THEME} style={{ color: pal.danger }}>
                    {problem.text}
                  </Text>
                ) : null}
                <Button
                  variant={isConnected ? "ghost" : "secondary"}
                  size="sm"
                  disabled={isConnected || busy !== null || (full && !again) || (asking === s.slug && !token.trim())}
                  onClick={() => void connect(s)}
                  theme={THEME}
                >
                  {isConnected ? "Connected" : busy === s.slug ? (s.auth === "oauth" ? "Opening sign-in" : "Checking the server") : again ? "Sign in again" : s.auth === "oauth" ? `Sign in to ${s.name}` : asking === s.slug ? "Connect with this token" : "Connect"}
                </Button>
              </Stack>
            </Card>
          );
        })}
      </div>
      {shown.length === 0 ? <Text secondary theme={THEME}>Nothing matches. Try another word, or add the server by address below.</Text> : null}
      {shown.length > limit ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE * 2)} theme={THEME}>
            {`Show more (${shown.length - limit} left)`}
          </Button>
        </div>
      ) : null}
    </Stack>
  );
}
