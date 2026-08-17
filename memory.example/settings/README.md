# Settings — one value per file, first line wins

| File | What it controls | Default |
|------|-----------------|---------|
| `owner.txt` | Your name — who "Me" is in call notes and digests | `the user` |
| `git-author.txt` | Regex matching your git identities in project scans | your `git config user.name` |
| `autorecord.txt` | `on`/`off` — record detected calls automatically. Leave OFF until you have consent habits sorted. | `off` |
| `retention-days.txt` | Days to keep call audio before purge | `7` |
| `whisper-model.txt` | Whisper size: `base` (fast) / `small` / `medium` (best for mixed-language calls, ~1.5 GB) | `base` |
| `call-languages.txt` | Languages your calls mix, e.g. `en hi` — last one is the retry fallback | `en` |
| `brain-dir.txt` | Where Jarvis's knowledge vault lives (Obsidian-compatible markdown) | `brain/` in the repo |
| `projects-vault.txt` | Optional vault with one page per project (Projects tab) | the brain |
| `code-root.txt` | Optional folder code-workers may roam (e.g. `~/Projects`) | none |
| `ui.json` | UI prefs (voice mode etc.) — managed from the ⚙ Settings page | on-demand |
