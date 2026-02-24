---
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git diff:*), Bash(git log:*), Bash(git commit:*), Bash(git push:*)
description: Commit all changes and push to GitHub
---

## Your task

Commit the current changes and push to GitHub. Follow these steps exactly:

1. Run `git status` and `git diff --stat` to see what changed
2. Run `git log --oneline -5` to see recent commit message style
3. Stage the relevant changed files by name (not `git add -A`)
4. Write a concise commit message (1 line, no emojis, no co-author tags)
5. Commit and push to origin

Rules:
- Never add co-author tags
- Never use `git add -A` or `git add .` — add files by name
- Skip files that look like secrets, temp files, or test artifacts
- If there are no changes, say so and stop
