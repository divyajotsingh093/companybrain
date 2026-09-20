import { render } from "lit";
import { api } from "./core-bridge";
import { errMessage } from "../../chassis/src/errors";
import { brainMapTpl, skillKey, type MapSkill, type MapSkillDetail } from "./brain-map";
import "./brain-map.css";

let hostEl: HTMLElement | null = null;
let skills: MapSkill[] = [];
let scopeId: string | null = null;
let selectedKey: string | null = null;
let detail: MapSkillDetail | null = null;
let detailError = "";
let loadError = "";
let loading = false;
let detailRequest = 0;

export function resetBrainMapState(): void {
  hostEl = null;
  skills = [];
  scopeId = null;
  selectedKey = null;
  detail = null;
  detailError = "";
  loadError = "";
  loading = false;
  detailRequest += 1;
}

function draw(): void {
  if (!hostEl) return;
  render(
    brainMapTpl({
      skills,
      scopeId,
      selectedKey,
      detail,
      detailError,
      loading,
      error: loadError,
      onScope: openScope,
      onSelect: select,
    }),
    hostEl,
  );
}

function openScope(next: string | null): void {
  scopeId = next;
  selectedKey = null;
  detail = null;
  detailError = "";
  detailRequest += 1;
  draw();
}

function select(skill: MapSkill | null): void {
  selectedKey = skill ? skillKey(skill) : null;
  detail = null;
  detailError = "";
  const request = ++detailRequest;
  draw();
  if (!skill?.id) return;
  void api<{ skill: MapSkillDetail }>(`/api/skills/${encodeURIComponent(skill.id)}`)
    .then((r) => {
      if (request !== detailRequest) return;
      detail = r.skill;
    })
    .catch((e) => {
      if (request !== detailRequest) return;
      detailError = errMessage(e, "The rest of this skill's record could not be loaded.");
    })
    .finally(() => {
      if (request === detailRequest) draw();
    });
}

export async function renderBrainMap(host: HTMLElement): Promise<void> {
  hostEl = host;
  loading = true;
  loadError = "";
  draw();
  try {
    const r = await api<{ skills?: MapSkill[] }>("/api/skills");
    skills = r.skills ?? [];
    if (scopeId && !skills.some((skill) => (skill.scopeId ?? skill.scope) === scopeId)) scopeId = null;
    if (selectedKey && !skills.some((skill) => skillKey(skill) === selectedKey)) selectedKey = null;
  } catch (e) {
    loadError = errMessage(e, "The brain map could not load your skills. Try again shortly.");
  } finally {
    loading = false;
  }
  draw();
}
