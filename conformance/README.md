# Conformance suite

One set of `.cosmoner/deployment.yaml` fixtures and expected results, run by the
JavaScript, Python and PHP test suites alike.

Three hand-written validators for one file format will agree on the easy cases
and diverge on the ones that matter — whether a warning or an error comes first,
whether a malformed `build:` still reports the `port:` under it, which of two
conflicting keys gets the squiggle. A customer who validates in CI with the CLI
and again in a script with the Python SDK should not get two different answers,
so the fixtures are shared and the assertions are exact: same issues, same
paths, same messages, same order.

## Layout

- `cases/<name>.yaml` — the file as an author would write it.
- `cases.json` — what every implementation must report for it.

```json
{ "name": "static-port", "valid": false, "issues": [
  { "path": "services.0.port", "severity": "error", "message": "port does not apply to a static site — the platform serves it" }
] }
```

`path` is dot-joined with numeric list indices, `(root)` for the document
itself. `issues` is compared in order. `message` is compared exactly;
`messageStartsWith` is the escape hatch for the one case whose text comes from
the underlying YAML parser and so differs per language.

## Adding a case

Write the fixture, add the entry, run all three suites. If one of them disagrees
the case has done its job — but decide which behaviour is right before making
the other two match it, because the expectation here is also what the CLI prints
and what the README promises.

## YAML dialects

The platform reads these files with a YAML 1.2 parser, so `autodeploy: yes` is
the string `"yes"` and not a boolean. `yaml-12-booleans` pins that, because it
is the one place the three languages do not agree for free: the JavaScript and
PHP parsers are 1.2 already, and PyYAML is 1.1, where `yes`, `no`, `on` and
`off` are booleans. The Python SDK narrows its resolver to match rather than
telling a customer a file is fine that the platform will read differently.

## Ordering

Issues come out in a fixed order rather than a sorted one, so that CLI output
reads down the file. Within each mapping: unknown keys first, then the known
fields in the order they are declared in the validator's field table, then the
rules that span more than one field. Lists are walked in index order.
