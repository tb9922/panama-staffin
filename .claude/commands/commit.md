---
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git diff:*), Bash(git log:*), Bash(git commit:*), Bash(git push:*)
description: Commit all changes and push to GitHub
---

## Pre-computed context

```bash
$ git status --short
```

```bash
$ git diff --stat
```

```bash
$ git log --oneline -5
```

## Your task

Commit the current changes and push to GitHub. The git status, diff, and log are above — use them to understand what changed and match the commit style.

1. Stage the relevant changed files by name (not `git add -A`)
2. Write a concise commit message (1 line, no emojis, no co-author tags)
3. Commit and push to origin

Rules:
- Never add co-author tags
- Never use `git add -A` or `git add .` — add files by name
- Skip files that look like secrets, temp files, or test artifacts
- If there are no changes, say so and stop
