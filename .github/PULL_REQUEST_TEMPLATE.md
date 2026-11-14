<!-- One line that says what the change does for the user, then: -->

**What changed and why:**

**How it was checked** (commands run and their result; for viewer changes, which screenshots were looked at):

- [ ] `ruff format --check .`, `ruff check .` and `python3 -m pytest tests`
- [ ] `cd viewer && npm run format:check && npm run typecheck && npm test`
- [ ] browser checks (`e2e/smoke.mjs`), for viewer changes
- [ ] `zensical build --strict`, for documentation changes
- [ ] the documentation says what changed, if users would notice
