# Domain Docs

How engineering skills consume this repo's domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- Relevant ADRs under `docs/adr/`, when that directory exists.

If a document does not exist, proceed silently. Domain terms and decisions are created lazily through the domain-modeling workflow.

## Layout

This is a single-context repository:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

## Vocabulary

Use the canonical terms defined in `CONTEXT.md` in issues, specs, tests, hypotheses, and implementation notes. Avoid synonyms that the glossary explicitly rejects.

## ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
