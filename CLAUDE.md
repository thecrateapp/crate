@AGENTS.md

## Claude Code

Scoped `AGENTS.md` files are imported by the `CLAUDE.md` next to them, so they load when you
read or edit files in that directory.

### Skills (`.claude/skills/`)

| Skill                    | When to use                                                    |
| ------------------------ | -------------------------------------------------------------- |
| `python-backend`         | FastAPI endpoints, SQLAlchemy, async patterns, backend testing |
| `react-best-practices`   | Writing or refactoring React, re-renders, bundle size          |
| `composition-patterns`   | Component APIs, compound components, context providers         |
| `react-view-transitions` | Page transitions, shared element and enter/exit animations     |
| `web-design-guidelines`  | UI, accessibility and UX reviews                               |

### Knowledge graph: graphify

The graphify rules live in the `## graphify` section of `AGENTS.md`. `.claude/settings.json`
registers graphify's PreToolUse guard (`graphify hook-guard`), which points Bash, Grep, Read and
Glob calls at the graph when `graphify-out/graph.json` exists.
