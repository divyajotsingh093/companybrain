import { useState } from "react";
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
  Stack,
  Stepper,
  Text,
  TextInput,
  ThemeProvider,
  tokens,
  usePal,
} from "./halaska-kit";

const THEME = "dark" as const;

const FEATURES = [
  { view: "ask", label: "Ask", blurb: "Ask anything, in your own words, and approve what it wants to do." },
  { view: "brain", label: "Brain", blurb: "Every skill your company has, and who can reach it." },
  { view: "skills", label: "Skills", blurb: "The jobs the agent knows how to do the same way every time.", count: 19 },
  { view: "automations", label: "Automations", blurb: "Work that happens on a schedule, without you asking." },
  { view: "agents", label: "Agents", blurb: "Claude Code, Codex, Cursor and Grok, and what each one claimed." },
  { view: "keychain", label: "Keychain", blurb: "The accounts the agent may use, and exactly what it may do with them." },
];

const JOURNEY = ["Connect a source", "Ask a question", "Save it as a skill", "Put it on a schedule"];

const SUGGESTIONS = [
  "Summarise where each open deal stands",
  "What changed in my accounts this week?",
  "Every Monday at 9, send me a pipeline digest",
];

function Home(): JSX.Element {
  const pal = usePal(THEME);
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<string | null>(null);

  return (
    <div style={{ background: pal.bg, minHeight: "100vh", padding: "48px 24px 96px" }}>
      <Stack gap={40} style={{ maxWidth: 880, margin: "0 auto" }}>
        <Stack gap={16} align="center" style={{ textAlign: "center" }}>
          <Orb variant="orbit" size={56} theme={THEME} />
          <Heading level={1} theme={THEME}>
            What do you want to do?
          </Heading>
          <Text secondary theme={THEME} style={{ maxWidth: "56ch" }}>
            Ask in your own words. The agent works from your own accounts, asks before it acts, and shows where each answer
            came from.
          </Text>
          <div style={{ width: "100%", maxWidth: 620 }}>
            <TextInput
              value={draft}
              onChange={setDraft}
              placeholder="Ask anything, or describe the job you want done…"
              theme={THEME}
            />
          </div>
          <Stack direction="row" gap={8} wrap justify="center">
            {SUGGESTIONS.map((s) => (
              <Button key={s} variant="secondary" size="sm" theme={THEME} onClick={() => setAsked(s)}>
                {s}
              </Button>
            ))}
            <Button variant="primary" size="sm" theme={THEME} disabled={!draft.trim()} onClick={() => setAsked(draft.trim())}>
              Ask
            </Button>
          </Stack>
          {asked ? (
            <Caption theme={THEME}>Sent to the agent: {asked}</Caption>
          ) : null}
        </Stack>

        <Card theme={THEME}>
          <CardHeader title="Getting started" subtitle="1 of 4 done" theme={THEME} />
          <Stepper steps={JOURNEY} current={1} theme={THEME} />
        </Card>

        <Stack gap={12}>
          <Caption theme={THEME}>NEEDS YOU</Caption>
          <Card theme={THEME}>
            <EmptyState
              title="Nothing needs you"
              description="Approvals waiting on you and connections that stopped working show up here."
              theme={THEME}
            />
          </Card>
        </Stack>

        <Stack gap={12}>
          <Caption theme={THEME}>EVERYTHING YOU CAN DO</Caption>
          <Card theme={THEME} padding={0}>
            {FEATURES.map((f, i) => (
              <ListItem
                key={f.view}
                title={f.label}
                subtitle={f.blurb}
                right={f.count ? <Badge theme={THEME}>{f.count}</Badge> : undefined}
                divider={i < FEATURES.length - 1}
                onClick={() => setAsked(`open ${f.label}`)}
                theme={THEME}
              />
            ))}
          </Card>
        </Stack>

        <Caption theme={THEME} style={{ fontFamily: tokens.font.mono }}>
          Company Brain · Halaska Kit
        </Caption>
      </Stack>
    </div>
  );
}

export function App(): JSX.Element {
  return (
    <ThemeProvider theme={THEME}>
      <Home />
    </ThemeProvider>
  );
}
