# cosmoner-sdk

Four packages in one repo: the JavaScript, Python and PHP SDKs for the Cosmoner
API, and the `cosmoner` CLI. They are hand-written and deliberately kept in
step with each other.

## The rule that shapes everything

**A namespace ships in all three languages at once** — JavaScript, Python
(sync *and* async) and PHP. Adding one to a single language is how the three
drift, and the drift is invisible until someone switches languages. The same
goes for a new method on an existing namespace.

Only wrap endpoints that carry an API-key scope. An endpoint with no scope is
dashboard-only and stays out of the SDKs; `API_KEY_RESOURCES` in the platform
repo is the list.

## Layout

```
javascript/  @cosmoner/sdk      src/services/<name>.ts + colocated <name>.test.ts
python/      cosmoner-sdk       src/cosmoner/<name>.py + tests/test_<name>.py
php/         cosmoner/sdk       src/<Name>Service.php + tests/<Name>ServiceTest.php
cli/         @cosmoner/cli      src/commands/<name>.ts + test/commands/<name>.test.ts
schemas/     vendored copy of the platform's published JSON Schema
conformance/ fixtures every language's deployment validator is held to
```

Tests are colocated in `javascript/`, and in a `tests/` directory everywhere
else — including the CLI, where they live in `cli/test/`, not beside the source.

## Conventions per language

- **JavaScript** — a service class takes `(transport, config)`, builds routes
  through `resolveProjectId`, and validates arguments before touching the
  transport. Every method is `async` even when nothing is awaited, so a bad
  argument rejects instead of throwing synchronously; that is what the
  file-level `eslint-disable require-await` is for. `Envelope<T>` and
  `ProjectScopedParams` are redeclared per service file rather than shared, and
  `ProjectScopedParams` is deliberately not re-exported from `src/index.ts`,
  which is what lets each file own its own.
- **Python** — two classes per module, `XService` and `AsyncXService`, with
  identical bodies apart from `async`/`await`. Shared validation goes in
  module-level `_require_*` helpers so the duplication cannot drift. Responses
  stay `dict[str, Any]`: there are no models for API payloads, and mypy runs
  strict, which is why every method assigns through an annotated local before
  returning.
- **PHP** — services return the decoded envelope as a documented array shape,
  with the inline `/** @var */` before each return that phpstan needs. Value
  objects exist only for the offline deployment validator. Public methods
  first, private helpers last.
- **CLI** — credentials come from the environment (`COSMONER_API_KEY`,
  `COSMONER_PROJECT_ID`, `COSMONER_API_URL`) or the key `cosmoner login`
  saved, and never from a flag, so a key cannot land in shell history or a CI
  log. The environment key always wins over the saved one, and commands build
  their client through `makeClient` in `src/credentials.ts` so that order holds
  everywhere. Exit codes mean one thing each: `0`
  success, `1` the operation failed, `2` the command line itself was wrong
  (`UsageError`). `run()` returns the code rather than calling `process.exit`,
  so tests drive the real entry point.

## Things that will bite you

- **The CLI bundles `javascript/src` directly**, through a `paths` alias in
  `cli/tsconfig.json`, a `resolve.alias` in `cli/vitest.config.mts` and tsup.
  It does not depend on the published package. So a change under `javascript/`
  runs the CLI's checks too and releases a new CLI, and a new namespace is
  usable from the CLI the moment it is exported from `javascript/src/index.ts`.
- **A 204 has no body.** All three transports return early on one
  (`undefined` / `None` / `[]`); an empty body on any *other* successful status
  is still an error, because that means a truncated response. Keep that
  distinction if you touch `decode`.
- **Never hand-edit a version.** Releases run from conventional-commit messages
  (`feat:` → minor) via per-package tags in `.github/workflows/release.yml`.
  JavaScript has a second version location, `javascript/src/version.ts`, which
  CI rewrites — leave it alone.
- **There is no codegen.** `schemas/app-schema.json` is a vendored copy of the
  published schema, used only by the drift tests that check the hand-written
  deployment validators still match it. There is no OpenAPI spec in this repo,
  so every type is written by hand.
- **Secrets are write-only.** The API returns a secret's plaintext exactly once,
  by the call that sets it, and no route decrypts one afterwards. The CLI must
  never print a plaintext value, in any format — the caller already has it, and
  printing it writes it into a CI log.
- **Writes to secrets and variables need an owner or admin**, checked
  independently of the key's scopes. A 403 on a key that plainly carries
  `secrets:write` is this, not a bug.

## Checks

Every pull request runs lint, type checks and tests for each package directory
it touches:

```bash
cd javascript && npm ci && npm run lint && npm run typecheck && npm test
cd python && pip install -e ".[test,lint]" && ruff check . && ruff format --check . && mypy && pytest
cd php && composer install && composer run lint && composer run analyse && composer run test
cd cli && npm ci && npm run lint && npm run typecheck && npm test   # after javascript/
```

Python is formatted by `ruff format` at a 90-column limit, and ruff will not
reflow a long docstring or comment — shorten those by hand.

## Pull Requests

Never include references to AI generation in PR bodies — no "Generated with
Claude Code", no `Co-authored-by:` trailers, no similar attribution lines.
