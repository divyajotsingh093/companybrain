import { useEffect, useState, type JSX } from "react";
import { AlertBanner, Button, Card, EmptyState, Eyebrow, Heading, Skeleton, Stack, StatusBadge, Tag, Text, TextArea, TextInput, usePal } from "./ui";
import { get, injectCss, post, reason, send, when } from "./shared";

export const SKILL_PARTS = ["Skill", "Soul", "Heartbeat", "BrainWeaver", "Process", "Tools", "Connectors", "Plugins"] as const;
export type SkillPart = (typeof SKILL_PARTS)[number];

interface Learned {
  at: string;
  by: string;
  note: string;
}

export type Parts = Record<SkillPart, { text: string; learned: Learned[] }>;

export interface SkillEntry {
  id: string;
  name: string;
  updatedAt: number;
  skill: Parts;
}

interface SkillView {
  name: string;
  parts: Parts;
  pulse: { state: "new" | "fresh" | "quiet" | "stale"; lastLearned: string | null; learned: number; uses: number };
  observed: Array<{ tool: string; subject: string | null; n: number }>;
  links: { outgoing: Array<{ toKind: string; toName: string }>; incoming: Array<{ fromKind: string; fromName: string }> };
  connectors: Array<{ name: string; connected: boolean }>;
  now: number;
}

const PULSE: Record<SkillView["pulse"]["state"], { status: string; label: string }> = {
  new: { status: "default", label: "New" },
  fresh: { status: "success", label: "Alive" },
  quiet: { status: "warning", label: "Quiet" },
  stale: { status: "error", label: "Stale" },
};

const SPAN: Record<SkillPart, number> = { Skill: 6, Soul: 3, Heartbeat: 3, BrainWeaver: 3, Process: 6, Tools: 2, Connectors: 2, Plugins: 2 };

injectCss(
  "cb-skill-grid",
  `
  .cb-bento { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 14px; }
  .cb-bento > [data-span="6"] { grid-column: span 6; }
  .cb-bento > [data-span="3"] { grid-column: span 3; }
  .cb-bento > [data-span="2"] { grid-column: span 2; }
  @media (max-width: 1100px) { .cb-bento > [data-span="2"] { grid-column: span 3; } }
  @media (max-width: 760px) { .cb-bento { grid-template-columns: 1fr; } .cb-bento > [data-span] { grid-column: span 1; } }
  .cb-skill-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .cb-skill-card { all: unset; box-sizing: border-box; display: flex; cursor: pointer; border-radius: 28px; }
  .cb-skill-card > .cb-bezel, .cb-bento > [data-span] > .cb-bezel { flex: 1; display: flex; height: 100%; }
  .cb-skill-card .cb-core, .cb-bento > [data-span] > .cb-bezel > .cb-core { flex: 1; }
  .cb-bento > [data-span] { display: flex; }
  .cb-skill-card:focus-visible { outline: 2px solid #5eeab0; outline-offset: 3px; }
  `,
);

const lastLearned = (parts: Parts): string | null =>
  SKILL_PARTS.flatMap((p) => parts[p].learned.map((l) => l.at))
    .sort()
    .at(-1) ?? null;

function PartCard({ part, purpose, data, extra }: { part: SkillPart; purpose: string; data: { text: string; learned: Learned[] }; extra?: JSX.Element | null }): JSX.Element {
  const pal = usePal();
  const empty = !data.text && !data.learned.length && !extra;
  return (
    <div data-span={SPAN[part]}>
      <Card>
        <Stack gap={12}>
          <Stack gap={4}>
            <Eyebrow dot={empty ? undefined : pal.accent}>{part}</Eyebrow>
            <Text secondary size="sm">
              {purpose}
            </Text>
          </Stack>
          {data.text ? <Text style={{ whiteSpace: "pre-wrap" }}>{data.text}</Text> : null}
          {extra}
          {data.learned.length ? (
            <Stack gap={8}>
              {data.learned.map((l, i) => (
                <div key={`${l.at}-${i}`} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999, background: pal.accent, flexShrink: 0, transform: "translateY(-2px)" }} />
                  <Text size="sm" style={{ flex: 1 }}>
                    {l.note}
                    <span style={{ color: pal.textTertiary }}>{` · ${l.by}, ${l.at}`}</span>
                  </Text>
                </div>
              ))}
            </Stack>
          ) : null}
          {empty ? (
            <Text secondary size="sm" style={{ color: pal.textTertiary }}>
              Nothing yet. Agents add to this with skill_learn as they work.
            </Text>
          ) : null}
        </Stack>
      </Card>
    </div>
  );
}

function Editor({ name, parts, purposes, onDone }: { name: string | null; parts: Parts | null; purposes: Record<string, string>; onDone: (saved: string | null) => void }): JSX.Element {
  const [title, setTitle] = useState(name ?? "");
  const [text, setText] = useState<Record<SkillPart, string>>(() => Object.fromEntries(SKILL_PARTS.map((p) => [p, parts?.[p].text ?? ""])) as Record<SkillPart, string>);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed(null);
    try {
      await post("/api/app/brain", { kind: "skill", name: title.trim(), parts: text });
      onDone(title.trim());
    } catch (err) {
      setFailed(reason(err));
      setSaving(false);
    }
  };

  return (
    <Card>
      <Stack gap={14}>
        <Heading level={5}>{name ? `Edit ${name}` : "New skill"}</Heading>
        <TextInput label="Name" value={title} disabled={Boolean(name)} placeholder="What the skill is called" onChange={setTitle} />
        <div className="cb-bento">
          {SKILL_PARTS.map((p) => (
            <div key={p} data-span={p === "Skill" || p === "Process" ? 6 : 3}>
              <TextArea label={p} caption={purposes[p]} rows={p === "Process" ? 6 : 3} value={text[p]} onChange={(next) => setText((prev) => ({ ...prev, [p]: next }))} />
            </div>
          ))}
        </div>
        <Text secondary size="sm">
          What agents learned is kept when you save. Write links as [[Entry name]] and connectors as gateway:name.
        </Text>
        {failed ? <AlertBanner variant="danger" title={failed} /> : null}
        <Stack direction="row" gap={8} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={saving || !title.trim()} onClick={() => void save()}>
            {saving ? "Saving" : "Save skill"}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

function SkillDetail({ name, purposes, onBack, onEdit, onRemoved }: { name: string; purposes: Record<string, string>; onBack: () => void; onEdit: (parts: Parts) => void; onRemoved: () => void }): JSX.Element {
  const pal = usePal();
  const [view, setView] = useState<SkillView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    void get<SkillView>(`/api/app/skill?name=${encodeURIComponent(name)}`).then(setView, (err: unknown) => setFailed(reason(err)));
  }, [name]);

  if (failed) return <AlertBanner variant="danger" title="This skill could not be loaded" description={`${failed}. Reload to try again.`} />;
  if (!view) return <Skeleton height={320} />;

  const beat = PULSE[view.pulse.state];
  const woven = [...view.links.outgoing.map((l) => ({ dir: "to", kind: l.toKind, name: l.toName })), ...view.links.incoming.map((l) => ({ dir: "from", kind: l.fromKind, name: l.fromName }))];

  const extras: Partial<Record<SkillPart, JSX.Element | null>> = {
    Heartbeat: (
      <Stack direction="row" gap={8} wrap>
        <StatusBadge status={beat.status}>{beat.label}</StatusBadge>
        <Tag>{`${view.pulse.learned} learnings`}</Tag>
        <Tag>{view.pulse.uses === 1 ? "Read once in 30 days" : `Read ${view.pulse.uses} times in 30 days`}</Tag>
        <Tag>{view.pulse.lastLearned ? `Last learned ${view.pulse.lastLearned}` : "Never learned yet"}</Tag>
      </Stack>
    ),
    BrainWeaver: woven.length ? (
      <Stack direction="row" gap={6} wrap>
        {woven.map((w) => (
          <Tag key={`${w.dir}-${w.kind}-${w.name}`}>{`${w.dir === "to" ? "→" : "←"} ${w.name}`}</Tag>
        ))}
      </Stack>
    ) : null,
    Tools: view.observed.length ? (
      <Stack gap={6}>
        <Text secondary size="sm">
          Seen in use after reading this skill
        </Text>
        <Stack direction="row" gap={6} wrap>
          {view.observed.map((o) => (
            <Tag key={`${o.tool}-${o.subject}`}>{`${o.tool}${o.subject ? ` ${o.subject}` : ""} · ${o.n}`}</Tag>
          ))}
        </Stack>
      </Stack>
    ) : null,
    Connectors: view.connectors.length ? (
      <Stack direction="row" gap={6} wrap>
        {view.connectors.map((c) => (
          <StatusBadge key={c.name} status={c.connected ? "success" : "warning"}>
            {c.connected ? c.name : `${c.name} not connected`}
          </StatusBadge>
        ))}
      </Stack>
    ) : null,
  };

  const remove = async (): Promise<void> => {
    try {
      await send(`/api/app/brain?kind=skill&name=${encodeURIComponent(view.name)}`, { method: "DELETE" });
      onRemoved();
    } catch (err) {
      setFailed(reason(err));
    }
  };

  return (
    <Stack gap={22}>
      <Stack direction="row" justify="space-between" align="flex-end" gap={16} wrap>
        <Stack gap={8}>
          <button className="cb-btn" data-variant="ghost" data-size="sm" style={{ alignSelf: "flex-start", marginLeft: -10 }} onClick={onBack}>
            ← All skills
          </button>
          <Heading level={3}>{view.name}</Heading>
          <Stack direction="row" gap={8} align="center">
            <StatusBadge status={beat.status}>{beat.label}</StatusBadge>
            <Text secondary size="sm">
              {view.pulse.lastLearned ? `Learned ${view.pulse.learned} things, most recently ${view.pulse.lastLearned}` : "Nothing learned yet"}
            </Text>
          </Stack>
        </Stack>
        <Stack direction="row" gap={8}>
          <Button variant="ghost" size="sm" onClick={() => void remove()}>
            Remove
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onEdit(view.parts)}>
            Edit
          </Button>
        </Stack>
      </Stack>
      <div className="cb-bento">
        {SKILL_PARTS.map((p) => (
          <PartCard key={p} part={p} purpose={purposes[p] ?? ""} data={view.parts[p]} extra={extras[p] ?? null} />
        ))}
      </div>
      <Text secondary size="sm" style={{ color: pal.textTertiary }}>
        Agents read this with skill_read before a task and add to it with skill_learn afterwards.
      </Text>
    </Stack>
  );
}

export function SkillsScreen({ entries, purposes, now, onChanged }: { entries: SkillEntry[]; purposes: Record<string, string>; now: number; onChanged: () => void }): JSX.Element {
  const pal = usePal();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ name: string | null; parts: Parts | null } | null>(null);

  if (editing) {
    return (
      <Editor
        name={editing.name}
        parts={editing.parts}
        purposes={purposes}
        onDone={(saved) => {
          setEditing(null);
          if (saved) {
            onChanged();
            setSelected(saved);
          }
        }}
      />
    );
  }

  if (selected) {
    return (
      <SkillDetail
        key={selected}
        name={selected}
        purposes={purposes}
        onBack={() => setSelected(null)}
        onEdit={(parts) => setEditing({ name: selected, parts })}
        onRemoved={() => {
          setSelected(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <Stack gap={22}>
      <Stack direction="row" justify="space-between" align="flex-end" gap={16} wrap>
        <Stack gap={6} style={{ maxWidth: 640 }}>
          <Heading level={4}>Skills</Heading>
          <Text secondary>
            Each skill has eight parts: Skill, Soul, Heartbeat, BrainWeaver, Process, Tools, Connectors and Plugins. Agents read one before a task and add what they learned afterwards, so every run starts smarter.
          </Text>
        </Stack>
        <Button variant="primary" size="sm" arrow onClick={() => setEditing({ name: null, parts: null })}>
          New skill
        </Button>
      </Stack>
      {entries.length ? (
        <div className="cb-skill-cards">
          {entries.map((e) => {
            const learned = SKILL_PARTS.reduce((n, p) => n + e.skill[p].learned.length, 0);
            const filled = SKILL_PARTS.filter((p) => e.skill[p].text || e.skill[p].learned.length).length;
            const last = lastLearned(e.skill);
            return (
              <button key={e.id} className="cb-skill-card" onClick={() => setSelected(e.name)}>
                <Card>
                  <Stack gap={12}>
                    <Text weight="medium" size="md">
                      {e.name}
                    </Text>
                    <Text secondary size="sm" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {e.skill.Skill.text || e.skill.Skill.learned[0]?.note || "No description yet."}
                    </Text>
                    <div aria-label={`${filled} of 8 parts filled`} style={{ display: "flex", gap: 4 }}>
                      {SKILL_PARTS.map((p) => (
                        <span key={p} title={p} style={{ flex: 1, height: 3, borderRadius: 999, background: e.skill[p].text || e.skill[p].learned.length ? pal.accent : "rgba(255,255,255,0.08)" }} />
                      ))}
                    </div>
                    <Text secondary size="sm" style={{ color: pal.textTertiary }}>
                      {learned ? `${learned} learned · last ${last}` : `Updated ${when(e.updatedAt, now)}`}
                    </Text>
                  </Stack>
                </Card>
              </button>
            );
          })}
        </div>
      ) : (
        <Card>
          <EmptyState title="No skills yet" description="Attach an agent from Agents and a starter skill appears here, filled in with your tools and connectors. Agents add more as they learn." />
        </Card>
      )}
    </Stack>
  );
}
