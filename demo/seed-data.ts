// Seed content for the H0 demo. Two documents are real, read from a live Drive through
// this session's connector, with their real permissions. Two are synthetic — clearly
// labeled as such in their own titles and bodies — used only to demonstrate the `group`
// grantee kind and a second principal-only grant, since this personal Google account has
// no Groups or domain-wide sharing to pull a real example of those from. See
// docs/analysis and adrs/0002-permission-model.md for why the distinction matters: nothing
// here is presented as a real company document that it isn't.

export function chunk(text: string, maxLen = 1400): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxLen) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const REAL_RESUME = {
  file: {
    id: "1itkVZczmcs1qO0yP0v5j25Y8VcMby5YCArWsuOZE47M",
    title: "Manus_AI_Resume_Divyajot_Singh.md",
    viewUrl: "https://docs.google.com/document/d/1itkVZczmcs1qO0yP0v5j25Y8VcMby5YCArWsuOZE47M/edit?usp=drivesdk",
    modifiedTime: "2025-12-02T05:46:34.645Z",
  },
  permissions: [
    { displayName: "divyajotsingh093", emailAddress: "divyajotsingh093@gmail.com", role: "owner", type: "user" },
  ],
};

export const REAL_WHITEPAPER = {
  file: {
    id: "1av8Jsv7gwjOkglWp12tl9FqDO-Z2UOeajL1zGiLjPTE",
    title: "L&A New Business eApp Whitepaper 3.12.26",
    viewUrl: "https://docs.google.com/document/d/1av8Jsv7gwjOkglWp12tl9FqDO-Z2UOeajL1zGiLjPTE/edit?usp=drivesdk",
    modifiedTime: "2026-04-30T09:13:24.916Z",
  },
  permissions: [
    { role: "writer", type: "anyone" },
    { displayName: "brian", emailAddress: "brian@palaverlabs.com", role: "owner", type: "user" },
  ],
};

export const SYNTHETIC_COMP_REVIEW = {
  file: {
    id: "synthetic-comp-review",
    title: "Q3 Compensation Review (SYNTHETIC — demo only, not a real document)",
    viewUrl: undefined,
    modifiedTime: "2026-07-01T00:00:00Z",
  },
  permissions: [{ type: "user", role: "reader", emailAddress: "alice@demo.local" }],
  body:
    "This is a synthetic example document created only to demonstrate Company Brain's per-person " +
    "access control in the H0 demo. It is not a real compensation review and contains no real figures. " +
    "It is shared with exactly one demo principal, alice@demo.local, so the demo can show that a " +
    "colleague without that grant gets zero results for the same query.",
};

export const SYNTHETIC_RUNBOOK = {
  file: {
    id: "synthetic-eng-runbook",
    title: "Deployment Runbook (SYNTHETIC — demo only, not a real document)",
    viewUrl: undefined,
    modifiedTime: "2026-07-01T00:00:00Z",
  },
  permissions: [{ type: "group", role: "reader", emailAddress: "eng@demo.local" }],
  body:
    "This is a synthetic example document created only to demonstrate Company Brain's group-based " +
    "access control in the H0 demo. It is not a real runbook. It is shared with the demo group " +
    "eng@demo.local, so the demo can show that group membership, not just individual grants, " +
    "changes what a person can retrieve.",
};

export const DEMO_ASKERS = [
  {
    label: "You (divyajotsingh093@gmail.com) — owns the resume",
    asker: { principalId: "divyajotsingh093@gmail.com", groupIds: [], domains: ["gmail.com"] },
  },
  {
    label: "Brian (brian@palaverlabs.com) — owns the public whitepaper, nothing else",
    asker: { principalId: "brian@palaverlabs.com", groupIds: [], domains: ["palaverlabs.com"] },
  },
  {
    label: "Alice — synthetic colleague, in the synthetic eng group",
    asker: { principalId: "alice@demo.local", groupIds: ["eng@demo.local"], domains: ["demo.local"] },
  },
  {
    label: "An outsider with no grants at all",
    asker: { principalId: "nobody@example.com", groupIds: [], domains: ["example.com"] },
  },
];
