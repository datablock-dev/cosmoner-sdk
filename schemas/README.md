# Vendored schemas

## `app-schema.json`

The JSON Schema for `.cosmoner/deployment.yaml`, copied verbatim from
<https://cosmoner.com/schemas/app.schema.json>.

It is **not** shipped inside `@cosmoner/sdk`, `cosmoner-sdk` or `cosmoner/sdk`.
Those three validate the file with a hand-written validator instead, because the
rules that matter most in this format are ones JSON Schema cannot express — that
an environment variable takes its value from exactly one place, that a committed
`value` alongside `secret: true` is a leaked credential, that `port` and the
deprecated `http_port` contradict each other. A JSON Schema validator would pass
every one of those files and then report the structural problems it *can* see
with worse messages than a purpose-written checker.

What this copy is for is holding those hand-written validators to the platform's
definition. Each language's test suite reads this file and asserts that the
field names, types, lengths, ranges, patterns, enums and deprecations its
validator enforces are the ones the schema states. Add a field upstream and
three test suites fail until three validators learn about it.

That only works while the copy is current, so `.github/workflows/ci.yml` has a
`schema-drift` job that re-fetches the published document and fails when it
differs from this file. A failure there is not a merge conflict to resolve — it
means the platform's format changed and the SDKs have not caught up yet.

The CLI does ship it, at `cli/dist/app-schema.json`, copied in at build time by
`cli/scripts/copy-schema.mjs`. `cosmoner schema` prints it so an author can
write it next to their file and point an offline editor at it.

### Updating

```bash
curl -fsSL https://cosmoner.com/schemas/app.schema.json -o schemas/app-schema.json
```

Then run the three test suites. Whatever they report is the work the change
actually requires.
