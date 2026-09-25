import { useEffect, useState, type JSX } from "react";
import { AlertBanner, Button, Caption, Card, EmptyState, Heading, ListItem, Skeleton, Stack, Text, TextInput, tokens, usePal } from "./ui";
import { ApiError, clientName, THEME, get, post, reason, send, when } from "./shared";

interface GatewayView {
  servers: Array<{ name: string; url: string; hasToken: boolean; createdAt: number }>;
  calls: Array<{ at: number; client: string; subject: string | null; ok: boolean }>;
  max: number;
  model: { configured: boolean; summary: { model: string; provider: string; fallback: string | null } | null; dailyLimit: number };
  mcpUrl: string;
  now: number;
}

const NAME_RULE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function GatewayScreen(): JSX.Element {
  const pal = usePal(THEME);
  const [view, setView] = useState<GatewayView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const load = (): void => {
    void get<GatewayView>("/api/app/gateway").then(
      (next) => {
        setView(next);
        setLoadError(null);
      },
      (err: unknown) => setLoadError(reason(err)),
    );
  };

  useEffect(load, []);

  const cleanName = name.trim().toLowerCase();
  const nameProblem = cleanName && !NAME_RULE.test(cleanName) ? "Lowercase letters, numbers and dashes, up to 40 characters." : undefined;
  const ready = Boolean(cleanName && !nameProblem && url.trim() && !saving);

  const add = async (): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      const done = await post<{ name: string; tools: number }>("/api/app/gateway", { name: cleanName, url: url.trim(), token });
      setNotice({ ok: true, text: `Connected ${done.name}. It offers ${done.tools} ${done.tools === 1 ? "tool" : "tools"} to your agents.` });
      setName("");
      setUrl("");
      setToken("");
      load();
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : undefined;
      setNotice({ ok: false, text: detail ? `${reason(err)} ${detail}` : reason(err) });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (server: string): Promise<void> => {
    try {
      await send(`/api/app/gateway?name=${encodeURIComponent(server)}`, { method: "DELETE" });
    } catch (err) {
      setNotice({ ok: false, text: `${server}: ${reason(err)}` });
    } finally {
      setConfirm(null);
      load();
    }
  };

  if (loadError) return <AlertBanner variant="danger" title="The gateway could not be loaded" description={`${loadError}. Reload to try again.`} theme={THEME} />;
  if (!view) return <Skeleton theme={THEME} />;

  return (
    <Stack gap={32}>
      <Stack gap={4}>
        <Heading level={4} theme={THEME}>
          Gateway
        </Heading>
        <Text secondary theme={THEME}>
          Your agents connect to Company Brain once. Through it they reach the other MCP servers you add here, with your tokens kept on the server and every call logged.
        </Text>
      </Stack>

      <ConnectCard mcpUrl={view.mcpUrl} />

      <Stack gap={10}>
        <Heading level={5} theme={THEME}>
          MCP servers
        </Heading>
        <Card theme={THEME} padding={0}>
          {view.servers.length ? (
            view.servers.map((s, i) => (
              <ListItem
                key={s.name}
                title={s.name}
                subtitle={`${s.url} · ${s.hasToken ? "token stored" : "no token"} · added ${when(s.createdAt, view.now)}`}
                right={
                  confirm === s.name ? (
                    <Stack direction="row" gap={6} align="center">
                      <Button variant="ghost" size="sm" theme={THEME} onClick={() => setConfirm(null)}>
                        Keep
                      </Button>
                      <Button variant="danger" size="sm" theme={THEME} onClick={() => void remove(s.name)}>
                        Remove
                      </Button>
                    </Stack>
                  ) : (
                    <Button variant="ghost" size="sm" theme={THEME} onClick={() => setConfirm(s.name)}>
                      Remove
                    </Button>
                  )
                }
                divider={i < view.servers.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <EmptyState title="No servers yet" description="Add one below. Your agents see it through gateway_servers, gateway_tools and gateway_call." theme={THEME} />
          )}
        </Card>

        <Card theme={THEME}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void add();
            }}
          >
            <Stack gap={12}>
              <TextInput label="Name" value={name} placeholder="linear" error={nameProblem} onChange={(next: string) => setName(next)} theme={THEME} />
              <TextInput label="Server address" value={url} placeholder="https://mcp.example.com/mcp" onChange={(next: string) => setUrl(next)} theme={THEME} />
              <TextInput
                label="Token"
                type="password"
                value={token}
                placeholder="Optional. Sent as a bearer token."
                caption="Stored encrypted. It is never shown again, and agents never see it."
                onChange={(next: string) => setToken(next)}
                theme={THEME}
              />
              <Stack direction="row" justify="space-between" align="center" gap={12}>
                <Caption theme={THEME}>{`${view.servers.length} of ${view.max} servers`}</Caption>
                <Button variant="primary" arrow disabled={!ready} theme={THEME}>
                  {saving ? "Checking the server" : "Connect server"}
                </Button>
              </Stack>
            </Stack>
          </form>
        </Card>
        {notice ? <AlertBanner variant={notice.ok ? "success" : "danger"} title={notice.text} theme={THEME} /> : null}
      </Stack>

      <Stack gap={10}>
        <Heading level={5} theme={THEME}>
          Recent calls
        </Heading>
        <Card theme={THEME} padding={0}>
          {view.calls.length ? (
            view.calls.map((c, i) => (
              <ListItem
                key={`${c.at}-${i}`}
                title={c.subject ?? "unknown"}
                subtitle={`${clientName(c.client)} · ${when(c.at, view.now)}`}
                right={
                  <Text theme={THEME} style={{ ...tokens.type.sm, color: c.ok ? pal.success : pal.danger }}>
                    {c.ok ? "Answered" : "Failed"}
                  </Text>
                }
                divider={i < view.calls.length - 1}
                theme={THEME}
              />
            ))
          ) : (
            <EmptyState title="No calls yet" description="Calls your agents make through the gateway appear here." theme={THEME} />
          )}
        </Card>
      </Stack>

      <Stack gap={10}>
        <Heading level={5} theme={THEME}>
          Models
        </Heading>
        <Card theme={THEME}>
          <Stack gap={6}>
            <Text theme={THEME}>{view.model.configured && view.model.summary ? `Ask answers with ${view.model.summary.model} through ${view.model.summary.provider}${view.model.summary.fallback ? `, falling back to ${view.model.summary.fallback}` : ""}.` : view.model.configured ? "Ask has a model configured." : "No model is configured, so Ask cannot answer yet."}</Text>
            <Caption theme={THEME}>{`UP TO ${view.model.dailyLimit} QUESTIONS PER PERSON PER DAY`}</Caption>
          </Stack>
        </Card>
      </Stack>
    </Stack>
  );
}

function ConnectCard({ mcpUrl }: { mcpUrl: string }): JSX.Element {
  const pal = usePal(THEME);
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card theme={THEME}>
      <Stack gap={10}>
        <Stack gap={4}>
          <Text theme={THEME} weight="semibold">
            Connect any MCP client
          </Text>
          <Text secondary size="sm" theme={THEME}>
            Add this URL as a custom connector in Claude, ChatGPT, Cursor or VS Code. The client opens a GitHub sign-in, you allow it once, and it works on your brain. No token to copy.
          </Text>
        </Stack>
        <Text mono theme={THEME} style={{ overflowWrap: "anywhere" }}>
          {mcpUrl}
        </Text>
        <Text secondary size="sm" theme={THEME}>
          {`Claude Code: claude mcp add --transport http companybrain ${mcpUrl}`}
        </Text>
        <div role="status" aria-live="polite" style={{ minHeight: 18, fontSize: 12.5, color: copied === false ? pal.danger : pal.accentText }}>
          {copied === null ? "" : copied ? "URL copied." : "Copy failed. Select the URL above instead."}
        </div>
        <div>
          <Button variant="secondary" size="sm" theme={THEME} onClick={() => void copy()}>
            Copy URL
          </Button>
        </div>
      </Stack>
    </Card>
  );
}
