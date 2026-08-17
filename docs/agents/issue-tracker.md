# Issue tracker: GitHub

Issues and specs for this repo live in `Open-LLM-VTuber/Open-LLM-VTuber` GitHub Issues. Use the `gh` CLI with `--repo Open-LLM-VTuber/Open-LLM-VTuber` for all operations so fork remotes cannot redirect a write.

## Conventions

- **Create an issue**: `gh issue create --repo Open-LLM-VTuber/Open-LLM-VTuber --title "..." --body-file "..."`.
- **Read an issue**: `gh issue view <number> --repo Open-LLM-VTuber/Open-LLM-VTuber --comments`.
- **List issues**: use `gh issue list --repo Open-LLM-VTuber/Open-LLM-VTuber` with appropriate state and label filters.
- **Comment on an issue**: `gh issue comment <number> --repo Open-LLM-VTuber/Open-LLM-VTuber --body "..."`.
- **Apply or remove labels**: use `gh issue edit <number> --repo Open-LLM-VTuber/Open-LLM-VTuber --add-label "..."` or `--remove-label "..."`.
- **Close an issue**: `gh issue close <number> --repo Open-LLM-VTuber/Open-LLM-VTuber --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says "publish to the issue tracker"

Create an issue in `Open-LLM-VTuber/Open-LLM-VTuber`.

## When a skill says "fetch the relevant ticket"

Read the requested issue and its comments from `Open-LLM-VTuber/Open-LLM-VTuber`.
