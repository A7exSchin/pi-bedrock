# pi-bedrock

A [pi](https://github.com/earendil-works/pi) extension that injects vault core files, project-scoped files, and ephemeral notes into the system prompt — **compaction-proof context**. Because the system prompt is never compacted, the rules you anchor here survive indefinitely across long sessions.

## Install

```bash
pi install git:github.com/A7exSchin/pi-bedrock
```

Then create your config file:

```bash
cp ~/.pi/agent/git/github.com/A7exSchin/pi-bedrock/pi-bedrock.example.json \
   ~/.pi/agent/pi-bedrock.json
```

Edit `~/.pi/agent/pi-bedrock.json` to your needs. The extension loads on next pi startup.

## What it does

pi-bedrock hooks `before_agent_start` and re-reads its configured files from disk on every turn, appending them to the system prompt inside `<!-- pi-bedrock -->` markers. Three tiers:

- **Core** — files relative to the vault root, injected **every session** regardless of cwd.
- **Projects** — files injected only when the cwd is inside a project's `path`. Each project may name a `memory` directory whose `.md` files are all scanned.
- **Ephemeral** — session-scoped strings added at runtime via `/bedrock add`, cleared with `/bedrock clear`.

On `session_start` it also warns if any injected file is already loaded via `AGENTS.md`/context files, to avoid double token usage.

## Config

Config lives at `~/.pi/agent/pi-bedrock.json` (override with env `PI_BEDROCK_CONFIG`).

```json
{
  "vault": "~/GitLib/dev.a7exschin.knowledge",
  "core": [
    "_core/me.md",
    "_core/ai-conduct.md",
    "_core/conventions.md",
    "_core/preferences.md"
  ],
  "projects": [
    {
      "path": "~/GitLib/dev.a7exschin.knowledge",
      "name": "Knowledge Vault",
      "files": ["_core/meta.md"],
      "memory": "03-agents/03-memory/"
    }
  ]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `vault` | yes | Vault root (`~` expanded). Core files resolve relative to it. |
| `core` | yes | Files injected every session, relative to `vault`. |
| `projects` | no | Project entries injected when cwd is inside `path`. |
| `projects[].path` | yes | Project directory (`~` expanded). Triggers injection when cwd is inside. |
| `projects[].name` | no | Display name. Defaults to directory basename. |
| `projects[].root` | no | Directory where `files` and `memory` resolve from. Defaults to `path`. |
| `projects[].files` | yes | Files relative to `root` (or `path` if root unset). |
| `projects[].memory` | no | Directory relative to `root` (or `path`); all `.md` files injected. |

## Commands

```
/bedrock              Show status
/bedrock status       Show status
/bedrock list         List configured core/project/ephemeral context
/bedrock add <text>   Add a session-scoped ephemeral note
/bedrock clear        Clear all ephemeral notes
/bedrock reload       Re-read config from disk
```

## License

MIT
