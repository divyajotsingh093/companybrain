import { useState, type JSX } from "react";
import { AlertBanner, Button, Card, EmptyState, Eyebrow, Heading, ListItem, Select, Stack, Tag, Text, TextArea, TextInput, usePal } from "./ui";
import { post, reason, send, when } from "./shared";

export const MEMORY_TYPES = ["user", "feedback", "project", "reference", "topic", "creative"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryFields {
  type: MemoryType;
  description: string;
  fact: string;
  why: string;
  how: string;
  auto: boolean;
}

export interface MemoryEntry {
  id: string;
  name: string;
  updatedAt: number;
  memory: MemoryFields;
}

const TYPE_LABEL: Record<MemoryType, string> = { user: "User", feedback: "Feedback", project: "Projects", reference: "References", topic: "Topics", creative: "Creative" };
const TYPE_COLOR: Record<MemoryType, string> = { user: "#8ff2c9", feedback: "#f5c451", project: "#7cc4ff", reference: "#c4b5fd", topic: "#f9a8d4", creative: "#fdba74" };

function Editor({ start, purposes, onDone, seed }: { start: MemoryEntry | null; purposes: Record<string, string>; onDone: (saved: boolean) => void; seed?: string }): JSX.Element {
  const [type, setType] = useState<MemoryType>(start?.memory.type ?? "topic");
  const [name, setName] = useState(start?.name ?? (!seed ? "" : seed.length <= 80 && !seed.includes("\n") ? seed.trim() : seed.split(/\s+/).slice(0, 6).join(" ").replace(/[.,;:!?]+$/, "")));
  const [description, setDescription] = useState(start?.memory.description ?? seed?.split("\n")[0]?.slice(0, 160) ?? "");
  const [fact, setFact] = useState(start?.memory.fact ?? seed ?? "");
  const [why, setWhy] = useState(start?.memory.why ?? "");
  const [how, setHow] = useState(start?.memory.how ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed(null);
    try {
      await post("/api/app/brain", { kind: "memory", name: name.trim(), memory: { type, description: description.trim(), fact, why, how } });
      onDone(true);
    } catch (err) {
      setFailed(reason(err));
      setSaving(false);
    }
  };

  return (
    <Card>
      <Stack gap={14}>
        <Heading level={5}>{start ? `Edit ${start.name}` : "New memory"}</Heading>
        <Stack direction="row" gap={12} wrap>
          <Select
            label="Type"
            value={type}
            options={MEMORY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            onChange={(next) => setType(next as MemoryType)}
            style={{ flex: "1 1 180px" }}
          />
          <div style={{ flex: "2 1 260px" }}>
            <TextInput label="Name" value={name} disabled={Boolean(start)} placeholder="A short name to recall it by" onChange={setName} />
          </div>
        </Stack>
        <Text secondary size="sm">
          {purposes[type]}
        </Text>
        <TextInput label="Description" value={description} placeholder="One line, used to decide when this matters" onChange={setDescription} />
        <TextArea label="What to remember" rows={4} value={fact} placeholder="One fact. Link related memories with [[their name]]." onChange={setFact} />
        <TextArea label="Why" rows={2} value={why} placeholder="The reason, so it can be judged in edge cases" onChange={setWhy} />
        <TextArea label="How to apply" rows={2} value={how} placeholder="When and where this should change what an agent does" onChange={setHow} />
        {failed ? <AlertBanner variant="danger" title={failed} /> : null}
        <Stack direction="row" gap={8} justify="flex-end">
          <Button variant="ghost" size="sm" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={saving || !name.trim() || !fact.trim()} onClick={() => void save()}>
            {saving ? "Saving" : "Save memory"}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

export function MemoryScreen({ entries, purposes, now, onChanged, seed }: { entries: MemoryEntry[]; purposes: Record<string, string>; now: number; onChanged: () => void; seed?: string }): JSX.Element {
  const pal = usePal();
  const [filter, setFilter] = useState<MemoryType | "all">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryEntry | null | "new">(seed ? "new" : null);
  const [failed, setFailed] = useState<string | null>(null);

  const counts = Object.fromEntries(MEMORY_TYPES.map((t) => [t, entries.filter((e) => e.memory.type === t).length])) as Record<MemoryType, number>;
  const shown = MEMORY_TYPES.filter((t) => (filter === "all" || filter === t) && counts[t] > 0);

  const forget = async (entry: MemoryEntry): Promise<void> => {
    setFailed(null);
    try {
      await send(`/api/app/brain?kind=memory&name=${encodeURIComponent(entry.name)}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      setFailed(reason(err));
    }
  };

  const chip = (id: MemoryType | "all", label: string, count: number): JSX.Element => (
    <button
      key={id}
      className="cb-btn"
      data-variant={filter === id ? "secondary" : "ghost"}
      data-size="sm"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
    >
      {id !== "all" ? <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: TYPE_COLOR[id] }} /> : null}
      {label}
      <span style={{ color: pal.textTertiary, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </button>
  );

  return (
    <Stack gap={22}>
      <Stack direction="row" justify="space-between" align="flex-end" gap={16} wrap>
        <Stack gap={6} style={{ maxWidth: 620 }}>
          <Heading level={4}>Memory</Heading>
          <Text secondary>What your agents know about you and your work, one fact at a time. They add to it as they work, and fill it in when an agent is first attached, a repository is indexed or a server is connected.</Text>
        </Stack>
        <Button variant="primary" size="sm" arrow onClick={() => setEditing("new")}>
          New memory
        </Button>
      </Stack>

      <Stack direction="row" gap={6} wrap>
        {chip("all", "All", entries.length)}
        {MEMORY_TYPES.map((t) => chip(t, TYPE_LABEL[t], counts[t]))}
      </Stack>

      {editing ? (
        <Editor
          start={editing === "new" ? null : editing}
          seed={editing === "new" ? seed : undefined}
          purposes={purposes}
          onDone={(saved) => {
            setEditing(null);
            if (saved) onChanged();
          }}
        />
      ) : null}
      {failed ? <AlertBanner variant="danger" title={failed} /> : null}

      {!entries.length ? (
        <Card>
          <EmptyState title="Nothing remembered yet" description="Attach an agent from Agents and it starts here: who you are, your projects, and what it learns about how you work." />
        </Card>
      ) : (
        shown.map((t) => (
          <Stack key={t} gap={10}>
            <Stack direction="row" gap={10} align="center" wrap>
              <Eyebrow dot={TYPE_COLOR[t]}>{TYPE_LABEL[t]}</Eyebrow>
              <Text secondary size="sm">
                {purposes[t]}
              </Text>
            </Stack>
            <Card padding={0}>
              {entries
                .filter((e) => e.memory.type === t)
                .map((e, i, list) => {
                  const isOpen = open === e.id;
                  return (
                    <div key={e.id}>
                      <ListItem
                        title={e.name}
                        subtitle={e.memory.description}
                        right={<Tag>{e.memory.auto ? "Learned automatically" : `Updated ${when(e.updatedAt, now)}`}</Tag>}
                        divider={!isOpen && i < list.length - 1}
                        onClick={() => setOpen(isOpen ? null : e.id)}
                      />
                      {isOpen ? (
                        <Stack gap={12} style={{ padding: "0 20px 18px" }}>
                          <Text style={{ whiteSpace: "pre-wrap" }}>{e.memory.fact}</Text>
                          {e.memory.why ? (
                            <Text secondary style={{ whiteSpace: "pre-wrap" }}>
                              <strong style={{ color: pal.text, fontWeight: 500 }}>Why: </strong>
                              {e.memory.why}
                            </Text>
                          ) : null}
                          {e.memory.how ? (
                            <Text secondary style={{ whiteSpace: "pre-wrap" }}>
                              <strong style={{ color: pal.text, fontWeight: 500 }}>How to apply: </strong>
                              {e.memory.how}
                            </Text>
                          ) : null}
                          <Stack direction="row" gap={8}>
                            <Button variant="secondary" size="sm" onClick={() => setEditing(e)}>
                              Edit
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => void forget(e)}>
                              Forget
                            </Button>
                          </Stack>
                        </Stack>
                      ) : null}
                    </div>
                  );
                })}
            </Card>
          </Stack>
        ))
      )}
    </Stack>
  );
}

