import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { assertRepo, createGitHub } from "../src/github.ts";
import { openStore } from "../src/store.ts";

export interface BacklogTask {
  source: string;
  number: string;
  title: string;
  body: string;
}

const ITEM = /^(#{2,3}) (\d+[a-z]?)\. (.+)$/;
const HEADING = /^(#{1,6}) /;
const FENCE = /^\s*(```|~~~)/;

export function parseBacklog(source: string, markdown: string): BacklogTask[] {
  const tasks: BacklogTask[] = [];
  let current: BacklogTask | null = null;
  let level = 0;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) inFence = !inFence;
    const item = inFence ? null : ITEM.exec(line);
    const heading = inFence ? null : HEADING.exec(line);
    if (item) {
      if (current) tasks.push(current);
      level = (item[1] as string).length;
      current = { source, number: item[2] as string, title: (item[3] as string).trim(), body: "" };
      continue;
    }
    if (current && heading && (heading[1] as string).length <= level) {
      tasks.push(current);
      current = null;
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) tasks.push(current);
  return tasks.map((t) => ({ ...t, body: t.body.trim() }));
}

if (import.meta.main) {
  const [repoArg, ...files] = process.argv.slice(2);
  if (!repoArg || !files.length) {
    console.error("usage: BOARD_DB_PATH=<server database> node scripts/import-backlog.ts <owner/repo> <backlog.md>...");
    console.error("Run it on the server host against the same database the service uses. Set GITHUB_TOKEN for private repositories.");
    process.exit(2);
  }
  const repo = await createGitHub(process.env.GITHUB_TOKEN ?? null, {
    apiUrl: (process.env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""),
  }).repo(assertRepo(repoArg));
  const store = openStore(process.env.BOARD_DB_PATH ?? "board.db");
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const source = basename(file, ".md");
    for (const task of parseBacklog(source, readFileSync(resolve(file), "utf8"))) {
      const title = `${source} #${task.number}: ${task.title}`;
      if (store.hasTask(repo.id, title)) {
        skipped++;
        continue;
      }
      store.addPost({
        repoId: repo.id,
        repoName: repo.fullName,
        type: "task",
        title,
        body: task.body,
        authorLogin: "backlog-import",
        authorUid: 0,
        client: "import",
        system: true,
      });
      added++;
    }
  }
  store.close();
  console.log(`imported ${added} tasks into ${repo.fullName} (id ${repo.id}); ${skipped} already present`);
}
