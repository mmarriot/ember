<!-- One line that says what the change does for the user, then: -->

**What changed and why:**

**How it was checked** (commands run and their result; for viewer changes, which screenshots were looked at):

- [ ] `python3 -m pytest tests`
- [ ] `cd viewer && npm run typecheck && npm test`
- [ ] browser checks (`e2e/smoke.mjs`), for viewer changes
- [ ] `zensical build --strict`, for documentation changes
- [ ] the documentation says what changed, if a user would notice
