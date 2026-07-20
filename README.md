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

pi-bedrock hooks `before_agent_start` and re-reads its configured files from disk on every turn, appending them to the system prompt inside `<!-- pi-bedrock -->` markers. Four tiers:

- **Core** — files relative to the vault root, injected **every session** regardless of cwd.
- **Projects** — files injected only when the cwd is inside a project's `path`. Each project may name a `memory` directory whose `.md` files are all scanned.
- **Modes** — a named, session-bound behavioral context. A mode is activated with `/bedrock <mode>` on an **empty session** and is **immutable once the first turn happens** — it cannot be switched or deactivated for that session. The bound mode is persisted in the session, so it survives `/reload` and `/resume`. Its files resolve relative to `vault`.
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
  ],
  "modes": {
    "learn": {
      "files": ["03-agents/01-prompts/learning-mode.md"]
    }
  }
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
| `modes` | no | Session modes keyed by name (see below). |
| `modes.<name>.files` | yes | Files (relative to `vault`) injected while the mode is active. May be empty (injects nothing). A mode name must not shadow a reserved subcommand (`status`, `list`, `add`, `clear`, `reload`). |

## Modes

A mode injects a fixed, session-long behavioral contract (e.g. a Socratic "learning" persona) that stays compaction-proof for the whole session.

```
/bedrock learn        Bind the "learn" mode to the current session
```

Semantics:

- A mode can only be bound while the session is **empty** (no user/assistant turns yet). Re-binding a different mode while still empty just overwrites the choice.
- After the **first turn**, the mode is **locked** for the session's lifetime — there is no deactivation.
- On a session that already has history, activation is refused; start a fresh session with `/new`, then bind the mode.
- The bound mode is stored as a session entry (not in LLM context) and restored on `/reload` and `/resume`.

## Commands

```
/bedrock              Show status
/bedrock status       Show status
/bedrock list         List configured core/project/ephemeral context
/bedrock add <text>   Add a session-scoped ephemeral note
/bedrock clear        Clear all ephemeral notes
/bedrock reload       Re-read config from disk
/bedrock <mode>       Bind a configured session mode (empty session only)
```

## Indicators

`/bedrock list` uses the following symbols to show file state:

| Symbol | Meaning |
|--------|--------------------------------------------------|
| `●` | **Loaded** — file exists and is actively injected |
| `○` | **Not loaded** — file exists but project is inactive |
| `?` | **Missing** — file is configured but not found on disk |

## License

MIT
