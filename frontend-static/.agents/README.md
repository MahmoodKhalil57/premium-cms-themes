# Agent context

`skills/<name>/SKILL.md` files here are loaded by the PremiumCMS issue agent
(and by any Agent-Skills-compatible tool) on every run against this repository.
Each skill is a Markdown file with `name` / `description` frontmatter; add
resources next to it and reference them from the skill. `../.mcp.json` lists
extra remote MCP servers (`{"mcpServers": {"<name>": {"url": "https://…"}}}`);
only HTTP servers can be reached from the agent — no local `command` servers,
and never commit secrets.
