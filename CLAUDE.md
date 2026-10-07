@AGENTS.md

## Claude Code

Scoped `AGENTS.md` files are imported by the `CLAUDE.md` next to them, so they load when you
read or edit files in that directory.

### Skills (`.claude/skills/`)

| Skill                                                                  | When to use                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `python-backend`                                                       | FastAPI endpoints, SQLAlchemy, async patterns, backend testing |
| `react-best-practices`                                                 | Writing or refactoring React, re-renders, bundle size          |
| `composition-patterns`                                                 | Component APIs, compound components, context providers         |
| `react-view-transitions`                                               | Page transitions, shared element and enter/exit animations     |
| `web-design-guidelines`                                                | UI, accessibility and UX reviews                               |
| `explore-codebase`, `debug-issue`, `review-changes`, `refactor-safely` | Graph-backed navigation, debugging, review and refactors       |

### MCP tools: code-review-graph

This project has a knowledge graph. Use the code-review-graph MCP tools before Grep/Glob/Read
to explore the codebase: they are cheaper and return structural context (callers, dependents,
test coverage).

| Tool                        | Use when                                        |
| --------------------------- | ----------------------------------------------- |
| `detect_changes`            | Reviewing code changes (risk-scored)            |
| `get_review_context`        | Source snippets for a review                    |
| `get_impact_radius`         | Blast radius of a change                        |
| `get_affected_flows`        | Execution paths impacted by a change            |
| `query_graph`               | Callers, callees, imports, `tests_for`          |
| `semantic_search_nodes`     | Finding functions or classes by name or keyword |
| `get_architecture_overview` | High-level structure                            |
| `refactor_tool`             | Planning renames, finding dead code             |

The graph updates on file changes via hooks. Fall back to Grep/Glob/Read only when it does not
cover what you need.
