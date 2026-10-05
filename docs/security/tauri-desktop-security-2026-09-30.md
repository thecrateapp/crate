# Tauri branch backend security scan — 2026-09-30

## Scope and revision

- Branch: `feat/tauri-desktop-app`
- Scanned revision: `b7b57222` (based on `59ddb5d5`)
- Scanner: Bandit 1.9.4
- Scope: the 14 Python files under `app/crate/` changed against `origin/main`, 9,759 lines of code.
- Machine-readable report: [`tauri-desktop-bandit-2026-09-30.json`](tauri-desktop-bandit-2026-09-30.json)

## Results and triage

The scan reports no high-confidence findings at medium or high severity. Its
seven remaining results are:

| Rule | Count | Severity / confidence | Assessment                                                                                                                                                                                                                                          |
| ---- | ----: | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B105 |     3 | Low / medium          | Fixed strings: the `X-Forward-Auth-Secret` header name and Google/Apple OAuth token endpoint URLs. These same constants exist on `main`; none is a credential value.                                                                                |
| B608 |     4 | Medium / low          | SQL construction flagged because the query includes `playable_track_clause(...)`. Its table aliases are fixed literals in these calls, while track, album, playlist, and path inputs are bound parameters. The query text is unchanged from `main`. |

Bandit also flagged Last.fm's MD5 API signatures as high severity before
remediation. Last.fm requires this digest format for request authentication;
it is not used to protect stored credentials or application data. Calls now
pass `usedforsecurity=False`, preserving the protocol digest while making that
purpose explicit. The Last.fm tests assert the exact signature values.

## Reproduction and CI gate

The local gate used the changed Python files and this threshold:

```bash
bandit -q --severity-level medium --confidence-level high <changed-python-files>
```

It exits successfully. The `security scan (changed Python)` job in
`.github/workflows/test-backend.yml` repeats the scan on every matching pull
request, including drafts. It uploads the complete Bandit JSON report and fails
when a changed file has a medium/high severity finding with high confidence.

Focused regression tests passed on this revision:

```text
41 passed
```

Coverage included native OAuth and Last.fm linking, Last.fm signatures and
retry classification, plus radio seed query behavior.
