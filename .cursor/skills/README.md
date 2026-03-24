# Cursor Agent Skills (this repository)

Project skills live under **`.cursor/skills/<skill-name>/SKILL.md`**. Cursor loads them for this workspace so agents can follow **short, repeatable workflows** without hunting through long docs.

## Available skills

| Skill                                                                 | Purpose                                                                                                                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**translation-helps-rest-api**](translation-helps-rest-api/SKILL.md) | Use **HTTP REST** under `/api/*` instead of the **MCP** endpoint (`/api/mcp`). For scripts, `curl`, `fetch`, backends, or teams that do not use MCP. |

## For developers

- **MCP** is optional for consuming the same data: prefer this skill (or `docs/IMPLEMENTATION_GUIDE.md`) when integrating via **plain REST**.
- To add another skill, create a new folder with `SKILL.md` and YAML frontmatter (`name`, `description`). See Cursor’s skill authoring docs.

## Personal copy

To use a skill in **all** projects, copy `SKILL.md` into `~/.cursor/skills/<skill-name>/` on your machine.
