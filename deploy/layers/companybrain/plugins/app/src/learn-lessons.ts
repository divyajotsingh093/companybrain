export interface Reply {
  label: string;
  next: string;
}

export interface Beat {
  say: string[];
  replies?: Reply[];
  go?: { label: string; screen: string };
}

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  beats: Record<string, Beat> & { start: Beat };
}

export const LESSONS: Lesson[] = [
  {
    id: "start",
    title: "Getting started",
    summary: "What Company Brain is and where things live.",
    beats: {
      start: {
        say: [
          "Hi. I will walk you through Company Brain in a few short lessons.",
          "It is one shared memory for your company and your agents: what is written down, who is doing what, and what has been decided.",
        ],
        replies: [
          { label: "What goes in it?", next: "what" },
          { label: "Where do I start?", next: "where" },
        ],
      },
      what: {
        say: [
          "Three things. Sources, like your repositories and docs. Entries your team and agents write: memory, skills, processes, rules, roles, lessons and records. And work: requests, projects and decisions.",
          "Everything links up. Write [[a name]] in any entry to connect it, and the Graph shows how it all fits together.",
        ],
        replies: [{ label: "So where do I start?", next: "where" }],
      },
      where: {
        say: [
          "Home. Type once, then pick what to do with it: ask the brain, request work, or remember something.",
          "Below the box, Get set up tracks your first steps, and Suggested for you gets sharper with every choice you make.",
        ],
        go: { label: "Home", screen: "home" },
      },
    },
  },
  {
    id: "knowledge",
    title: "Add knowledge",
    summary: "Index a repository or add the docs you keep re-explaining.",
    beats: {
      start: {
        say: ["Answers are only as good as what the brain can read, so sources come first.", "Where does your team's knowledge live today?"],
        replies: [
          { label: "In GitHub repositories", next: "repo" },
          { label: "In docs and notes", next: "files" },
        ],
      },
      repo: {
        say: [
          "Open Sources, pick a repository and press Index. Its readme and docs become what answers are drawn from.",
          "Repositories refresh on their own once a day. If you lose access to one, its documents are removed at the next refresh.",
        ],
        replies: [
          { label: "And my own files?", next: "files" },
          { label: "Got it", next: "done" },
        ],
      },
      files: {
        say: [
          "Add files straight from your computer on the same screen: .md, .mdx, .markdown, .txt, .rst or .adoc.",
          "Start with whatever people ask about a second time. That is exactly what belongs in the brain.",
        ],
        replies: [
          { label: "And repositories?", next: "repo" },
          { label: "Got it", next: "done" },
        ],
      },
      done: {
        say: ["Once something is indexed, Ask can answer from it and auto-build can start drafting entries from it."],
        go: { label: "Sources", screen: "sources" },
      },
    },
  },
  {
    id: "ask",
    title: "Ask the brain",
    summary: "Get answers that name what they read.",
    beats: {
      start: {
        say: ["Ask works like a chat, but every answer names what it read, with numbered citations back to the source.", "Want a good first question?"],
        replies: [
          { label: "Yes, give me one", next: "first" },
          { label: "Can I narrow it down?", next: "narrow" },
        ],
      },
      first: {
        say: ["Try this one: what should our agents never do without asking a person first?", "Your starter kit covers it, so you will see citations straight away."],
        replies: [
          { label: "Can I narrow it down?", next: "narrow" },
          { label: "Let me try", next: "done" },
        ],
      },
      narrow: {
        say: [
          "Yes. Pick kinds under the box to search only rules, skills or processes, say. Leave them all off to search everything.",
          "Each answer points to where it came from, so you can check it for yourself.",
        ],
        replies: [{ label: "Let me try", next: "done" }],
      },
      done: {
        say: ["Enter sends, Shift and Enter adds a line. From Ask you can open the Graph to see how an answer connects."],
        go: { label: "Ask", screen: "ask" },
      },
    },
  },
  {
    id: "connect",
    title: "Connect an agent",
    summary: "Give Claude Code, Codex, Cursor or any MCP client the same brain.",
    beats: {
      start: {
        say: ["Company Brain works on its own, but it shines when your agents share it.", "Which agent do you use?"],
        replies: [
          { label: "Claude Code, Codex or Cursor", next: "cli" },
          { label: "Claude, ChatGPT or another client", next: "url" },
          { label: "What do agents do once connected?", next: "harness" },
        ],
      },
      harness: {
        say: [
          "Every connected agent follows a skill called Working with Company Brain. It keeps itself up to date with your tools, repositories and servers.",
          "It has the agent call memory_index and board_inbox first, brain_search before assuming nothing is written down, and memory_save and skill_learn before it finishes.",
        ],
        replies: [
          { label: "Claude Code, Codex or Cursor", next: "cli" },
          { label: "Claude, ChatGPT or another client", next: "url" },
        ],
      },
      cli: {
        say: [
          "Pick your agent on the setup page to get a token and a setup to paste into it. For Claude Code it is one terminal command.",
          "Your starter agents each come with a kickoff prompt. Copy one, paste it into the agent, and it knows its role.",
        ],
        go: { label: "Agents", screen: "agents" },
      },
      url: {
        say: [
          "Add the Company Brain MCP URL as a custom connector. The client opens a GitHub sign-in, you allow it once, and it works on your brain. No token to copy.",
          "The URL is on the Gateway screen, with a copy button.",
        ],
        go: { label: "Gateway", screen: "gateway" },
      },
    },
  },
  {
    id: "memory",
    title: "Memory and skills",
    summary: "Teach it once, and every agent remembers.",
    beats: {
      start: {
        say: ["Memory is what agents should always know. Skills are how work gets done.", "Which one first?"],
        replies: [
          { label: "Memory", next: "memory" },
          { label: "Skills", next: "skill" },
        ],
      },
      memory: {
        say: [
          "Each memory is one fact, with why it matters and how to apply it. It has a type: user, feedback, project, reference, topic or creative.",
          "Save one from Home with Remember this, or let a connected agent add memories as it works. Agents read memory at the start of every session.",
        ],
        replies: [
          { label: "And skills?", next: "skill" },
          { label: "Take me to Memory", next: "memoryDone" },
        ],
      },
      skill: {
        say: [
          "A skill is a reusable instruction in parts: the skill itself, its soul, a heartbeat for when to revisit it, the process, and the tools and connectors it uses.",
          "Agents add what they learn with skill_learn, so a skill stays alive. Each one shows whether it is new, alive, quiet or stale.",
        ],
        replies: [
          { label: "And memory?", next: "memory" },
          { label: "Take me to Skills", next: "skillDone" },
        ],
      },
      memoryDone: {
        say: ["Link related memories with [[their name]] and they sit together in the Graph."],
        go: { label: "Memory", screen: "memory" },
      },
      skillDone: {
        say: ["Processes, rules, roles, lessons and records work the same way, each with its own screen."],
        go: { label: "Skills", screen: "skill" },
      },
    },
  },
  {
    id: "run",
    title: "Run an agent",
    summary: "Start agents from Company Brain and watch them work.",
    beats: {
      start: {
        say: ["You do not need a terminal to put an agent to work. Run agents starts one from inside Company Brain.", "What would you like to know?"],
        replies: [
          { label: "What does it do?", next: "what" },
          { label: "How do I keep it safe?", next: "safe" },
        ],
      },
      what: {
        say: [
          "Pick an agent, like the Release captain or Code reviewer from your starter kit, and give it a job.",
          "It uses the same tools a connected agent has: it reads memory, searches the brain and saves what it learned. With changes allowed it can also claim work on the board and update it.",
        ],
        replies: [
          { label: "How do I keep it safe?", next: "safe" },
          { label: "Show me", next: "done" },
        ],
      },
      safe: {
        say: [
          "By default a run can read everything and add new entries, but it cannot edit or delete anything, post or close work, ask for decisions, or call your connected servers.",
          "Tick Allow changes when you want it to act. Then each starter agent still asks you first for the calls it lists, like releasing on a Friday, and the question lands in Decisions.",
        ],
        replies: [
          { label: "What does it do?", next: "what" },
          { label: "Show me", next: "done" },
        ],
      },
      done: {
        say: ["Start small: one agent, one clear job. Read what it recorded when it finishes."],
        go: { label: "Run agents", screen: "run" },
      },
    },
  },
  {
    id: "build",
    title: "Let the brain build itself",
    summary: "Drafts memory, skills, processes and rules from your sources.",
    beats: {
      start: {
        say: ["Writing everything down by hand does not scale, so the brain writes it for you.", "Auto-build runs the Librarian, an agent that reads your indexed sources and adds the processes, rules, roles, lessons, records and memory that are missing."],
        replies: [
          { label: "Does it change things on its own?", next: "review" },
          { label: "How often does it run?", next: "schedule" },
        ],
      },
      review: {
        say: ["It only adds. It never edits or deletes an entry, so nothing a person wrote is replaced, and every step it took is on the Auto-build screen for you to read. Fix or remove any entry from its own screen."],
        replies: [
          { label: "How often does it run?", next: "schedule" },
          { label: "Then what?", next: "loop" },
        ],
      },
      schedule: {
        say: ["Build it once now, then turn on Build every day so it keeps up as your sources change."],
        replies: [
          { label: "Does it change things on its own?", next: "review" },
          { label: "Then what?", next: "loop" },
        ],
      },
      loop: {
        say: [
          "Then it compounds. Agents use what it wrote, they record lessons as they work, and those lessons feed the next build.",
          "Sources, read, write, check, grow, use, learn. The tour above plays the whole loop.",
        ],
        go: { label: "Auto-build", screen: "build" },
      },
    },
  },
  {
    id: "gateway",
    title: "Gateway and tools",
    summary: "One connection for your agents, every other tool behind it.",
    beats: {
      start: {
        say: [
          "Your agents connect to Company Brain once. Through it they reach the other MCP servers you add, like your tracker or your docs.",
          "Quick way or manual way?",
        ],
        replies: [
          { label: "The quick way", next: "directory" },
          { label: "Manual, by address", next: "manual" },
          { label: "Is it safe?", next: "secure" },
        ],
      },
      directory: {
        say: ["The directory lists 137 MCP servers, from GitHub and Linear to Notion and Sentry. Search, press connect, and sign in if the server asks."],
        replies: [
          { label: "Is it safe?", next: "secure" },
          { label: "Take me there", next: "done" },
        ],
      },
      manual: {
        say: ["Give it a name and the server address, plus a token if it needs one. Company Brain checks the server and tells you how many tools it offers."],
        replies: [
          { label: "Is it safe?", next: "secure" },
          { label: "Take me there", next: "done" },
        ],
      },
      secure: {
        say: ["Tokens are stored encrypted on the server. They are never shown again, and agents never see them. Every call through the gateway is logged."],
        replies: [{ label: "Take me there", next: "done" }],
      },
      done: {
        say: ["Agents find your servers with gateway_servers and gateway_tools, and use them with gateway_call."],
        go: { label: "Gateway", screen: "gateway" },
      },
    },
  },
  {
    id: "decisions",
    title: "Decisions",
    summary: "The calls your agents will not make for you.",
    beats: {
      start: {
        say: ["Agents keep working inside their instructions, but some calls are not theirs to make.", "When an agent reaches one, it stops, asks with board_ask, and says what it would recommend."],
        replies: [
          { label: "Where do I answer?", next: "where" },
          { label: "What about finished work?", next: "review" },
        ],
      },
      where: {
        say: ["Open Decisions, read the question, and send your ruling, with the reason if it is not obvious. Nothing is promised until you answer.", "A count in the navigation tells you when something is waiting."],
        replies: [
          { label: "What about finished work?", next: "review" },
          { label: "Show me", next: "done" },
        ],
      },
      review: {
        say: ["Work you ask for in Requests comes back to you for review. Accept to close it, or say what needs to change and it goes back to the agent."],
        replies: [
          { label: "Where do I answer decisions?", next: "where" },
          { label: "Open Requests", next: "requests" },
        ],
      },
      done: {
        say: ["That is the whole loop: the brain knows, agents work, and you make the calls that matter."],
        go: { label: "Decisions", screen: "decisions" },
      },
      requests: {
        say: ["Requests also show what is still with agents, so nothing goes quiet."],
        go: { label: "Requests", screen: "work" },
      },
    },
  },
];
