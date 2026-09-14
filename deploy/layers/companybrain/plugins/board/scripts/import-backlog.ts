import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { loadConfig } from "../src/config.ts";
import { assertRepo } from "../src/github.ts";
import { openStore } from "../src/store.ts";

export interface BacklogTask {
  source: string;
  number: string;
  title: string;
  body: string;
}

const HEADING = /^(#{2,3}) (\d+[a-z]?)\. (.+)$/;

export function parseBacklog(source: string, markdown: string): BacklogTask[] {
  const tasks: BacklogTask[] = [];
  let current: BacklogTask | null = null;
  let level = 0;
  for (const line of markdown.split("\n")) {
    const match = HEADING.exec(line);
    const anyHeading = /^(#{1,6}) /.exec(line);
    if (match) {
      if (current) tasks.push(current);
      level = (match[1] as string).length;
      current = { source, number: match[2] as string, title: (match[3] as string).trim(), body: "" };
      continue;
    }
    if (current && anyHeading && (anyHeading[1] as string).length <= level) {
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
    console.error("usage: node scripts/import-backlog.ts <owner/repo> <backlog.md>...");
    process.exit(2);
  }
  const repo = assertRepo(repoArg);
  const store = openStore(loadConfig().dbPath);
  let added = 0;
  let skipped = 0;
  for (const file of files) {
    const source = basename(file, ".md");
    for (const task of parseBacklog(source, readFileSync(resolve(file), "utf8"))) {
      const title = `${source} #${task.number}: ${task.title}`;
      if (store.hasTask(repo, title)) {
        skipped++;
        continue;
      }
      store.add({ repo, type: "task", title, body: task.body, authorLogin: "backlog-import", authorUid: 0, client: "web" });
      added++;
    }
  }
  store.close();
  console.log(`imported ${added} tasks into ${repo} (${skipped} already present)`);
}
