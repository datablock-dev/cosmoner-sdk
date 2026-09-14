/**
 * Validation of `.cosmoner/deployment.yaml`, the one file customers write by
 * hand for Cosmoner.
 *
 * Entirely local: no API key, no network, nothing about it that needs a
 * `Cosmoner` client. It is here rather than only in the CLI so the same check
 * can run inside a script that generates the file.
 *
 * What it reports is what the platform will do with the file, which is not the
 * same as what the file says. The platform's parser is deliberately lenient —
 * an unknown key is dropped so that a file written for a newer field still
 * applies its known settings against an older deploy — so an unknown key here
 * is a warning naming the consequence, and `template` comes back holding the
 * settings that will actually arrive.
 */

import { parse as parseYaml } from "yaml";

import {
  ENV_FIELDS,
  MAX_DEPLOYMENT_BYTES,
  ROOT_FIELDS,
  SERVICE_FIELDS,
  type FieldSpec,
  type FieldTable,
} from "./spec";
import type {
  DeploymentIssue,
  DeploymentTemplate,
  DeploymentValidationResult,
  ValidateDeploymentOptions,
} from "./types";

/** Mapping-or-not, excluding arrays, which YAML also gives us as objects. */
function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Renders a location the way the conformance suite and the CLI both expect it. */
function formatPath(path: (string | number)[]): string {
  return path.length === 0 ? "(root)" : path.join(".");
}

/** Collects findings in the order they are produced. */
class Issues {
  public readonly all: DeploymentIssue[] = [];

  public error(path: (string | number)[], message: string): void {
    this.all.push({ path: formatPath(path), message, severity: "error" });
  }

  public warn(path: (string | number)[], message: string): void {
    this.all.push({ path: formatPath(path), message, severity: "warning" });
  }
}

/**
 * Checks one value against its spec.
 *
 * Returns the value to carry into the parsed template, or `undefined` when it
 * failed — which also takes it out of the cross-field rules below. A `port`
 * that is not a number has nothing useful to say about whether it conflicts
 * with `http_port`, and saying it anyway buries the one message worth reading.
 */
function checkValue(
  value: unknown,
  spec: FieldSpec,
  path: (string | number)[],
  issues: Issues
): unknown {
  switch (spec.kind) {
    case "string": {
      if (typeof value !== "string") {
        issues.error(path, "Expected a string");
        return undefined;
      }
      if (spec.enum && !spec.enum.includes(value)) {
        issues.error(path, `Must be one of: ${spec.enum.join(", ")}`);
        return undefined;
      }
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        issues.error(path, "Must not be empty");
        return undefined;
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        issues.error(path, `Must be at most ${spec.maxLength} characters`);
        return undefined;
      }
      if (spec.pattern && !spec.pattern.test(value)) {
        issues.error(path, spec.patternMessage ?? `Must match ${spec.pattern.source}`);
        return undefined;
      }
      return value;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.error(path, "Expected an integer");
        return undefined;
      }
      if (value < spec.minimum || value > spec.maximum) {
        issues.error(path, `Must be between ${spec.minimum} and ${spec.maximum}`);
        return undefined;
      }
      return value;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        issues.error(path, "Expected a boolean");
        return undefined;
      }
      return value;
    }
    case "const": {
      if (value !== spec.value) {
        issues.error(path, spec.message);
        return undefined;
      }
      return value;
    }
    case "object": {
      if (!isMapping(value)) {
        issues.error(path, "Expected a mapping");
        return undefined;
      }
      const parsed = checkMapping(value, spec.fields, path, issues);
      CROSS_FIELD_RULES.get(spec.fields)?.(parsed, value, path, issues);
      return parsed;
    }
    case "array": {
      if (!Array.isArray(value)) {
        issues.error(path, "Expected a list");
        return undefined;
      }
      if (spec.minItems !== undefined && value.length < spec.minItems) {
        issues.error(
          path,
          spec.minItemsMessage ?? `Must have at least ${spec.minItems} items`
        );
        return undefined;
      }
      if (spec.maxItems !== undefined && value.length > spec.maxItems) {
        issues.error(path, `Must have at most ${spec.maxItems} items`);
        return undefined;
      }
      return value.map((item, index) => checkValue(item, spec.item, [...path, index], issues));
    }
  }
}

/**
 * Checks a mapping's keys against a field table.
 *
 * Unknown keys are reported first so that a typo appears above the fields it
 * sits among, then the known fields in table order, so output reads down the
 * file rather than in whatever order the rules happen to fire.
 */
function checkMapping(
  value: Record<string, unknown>,
  table: FieldTable,
  path: (string | number)[],
  issues: Issues
): Record<string, unknown> {
  for (const key of Object.keys(value)) {
    if (!(key in table)) {
      issues.warn([...path, key], `Unknown field "${key}" — it will be ignored`);
    }
  }

  const parsed: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(table)) {
    const fieldPath = [...path, key];
    if (!(key in value) || value[key] === undefined || value[key] === null) {
      if (spec.required) issues.error(fieldPath, "Required");
      else if (spec.default !== undefined) parsed[key] = spec.default;
      continue;
    }
    if (spec.deprecated && spec.replacedBy) {
      issues.warn(fieldPath, `${key} is deprecated — use ${spec.replacedBy}`);
    }
    const checked = checkValue(value[key], spec, fieldPath, issues);
    if (checked !== undefined) parsed[key] = checked;
  }
  return parsed;
}

/**
 * Rules spanning more than one field of an `envs` entry.
 *
 * A variable takes its value from exactly one place. Two sources is not a merge
 * with a winner — it is a file whose author believed something the platform
 * does not do — so it is refused rather than quietly resolved.
 *
 * Which sources were given is read from `raw`, not from the checked values: a
 * `from_variable` that failed its pattern is still a source the author
 * supplied, and answering a typo in it with "set one of value, secret,
 * from_variable, or from_secret" buries the message that would fix the file.
 */
function checkEnvVar(
  env: Record<string, unknown>,
  raw: Record<string, unknown>,
  path: (string | number)[],
  issues: Issues
): void {
  const sources = (["value", "secret", "from_variable", "from_secret"] as const).filter((key) =>
    key === "secret" ? raw.secret === true : raw[key] !== undefined && raw[key] !== null
  );

  if (sources.length === 0) {
    issues.error([...path, "value"], "Set one of value, secret, from_variable, or from_secret");
    return;
  }
  if (sources.length > 1) {
    issues.error(
      [...path, sources[1]],
      `A variable takes its value from one place only — remove ${sources.slice(1).join(", ")}`
    );
  }
  // `secret: true` with a value is the mistake this check exists for: a
  // credential committed to the repository. Said plainly and separately, so the
  // author knows to rotate it rather than just to delete a line.
  if (env.secret === true && env.value !== undefined) {
    issues.error(
      [...path, "value"],
      "A secret value must not be committed — remove value, or link a stored secret with from_secret"
    );
  }
}

/** Rules spanning more than one field of a service. */
function checkService(
  service: Record<string, unknown>,
  _raw: Record<string, unknown>,
  path: (string | number)[],
  issues: Issues
): void {
  const isStatic = service.type === "static";
  const build = isMapping(service.build) ? service.build : undefined;

  if (isStatic && service.run_command !== undefined) {
    issues.error([...path, "run_command"], "Static sites cannot define a run_command");
  }
  if (!isStatic && build?.output_dir !== undefined) {
    issues.error([...path, "build", "output_dir"], "output_dir only applies to static sites");
  }
  // A static site not built from its own Dockerfile runs the platform's image,
  // whose port is not the customer's to choose.
  if (isStatic && build?.strategy !== "docker" && service.port !== undefined) {
    issues.error(
      [...path, "port"],
      "port does not apply to a static site — the platform serves it"
    );
  }

  const legacyPorts = (["http_port", "internal_port"] as const).filter(
    (key) => service[key] !== undefined
  );
  if (service.port !== undefined && legacyPorts.length > 0) {
    issues.error(
      [...path, legacyPorts[0]],
      `port replaces ${legacyPorts.join(" and ")} — remove ${legacyPorts.length === 1 ? "it" : "them"}`
    );
  }

  if (Array.isArray(service.envs)) {
    const seen = new Set<string>();
    service.envs.forEach((env, index) => {
      if (!isMapping(env) || typeof env.key !== "string") return;
      if (seen.has(env.key)) {
        issues.error(
          [...path, "envs", index, "key"],
          `Duplicate environment variable "${env.key}"`
        );
      }
      seen.add(env.key);
    });
  }
}

/**
 * Rules spanning more than one field of the document itself.
 */
function checkRoot(
  document: Record<string, unknown>,
  path: (string | number)[],
  issues: Issues
): void {
  if (!Array.isArray(document.services)) return;

  const seen = new Set<string>();
  document.services.forEach((service, index) => {
    if (!isMapping(service) || typeof service.name !== "string") return;
    if (seen.has(service.name)) {
      issues.error([...path, "services", index, "name"], `Duplicate service name "${service.name}"`);
    }
    seen.add(service.name);
  });
}

/**
 * The cross-field rule attached to each mapping, keyed by its field table.
 *
 * Keyed by the table rather than named in `spec.ts` so that the spec stays what
 * it claims to be — a description of the fields, comparable line for line
 * against the published JSON Schema — instead of also carrying behaviour.
 */
const CROSS_FIELD_RULES = new Map<
  FieldTable,
  (
    value: Record<string, unknown>,
    raw: Record<string, unknown>,
    path: (string | number)[],
    issues: Issues
  ) => void
>([
  // The root's own rule is invoked directly by validateDeploymentDocument,
  // which is where the document is walked from, so it is not listed here.
  [ENV_FIELDS, checkEnvVar],
  [SERVICE_FIELDS, checkService],
]);

/**
 * Validates an already-parsed document.
 *
 * Use this when the file did not come from disk — generated from a template, or
 * read out of a repository through some other client. {@link validateDeployment}
 * is the same check with the YAML parsing in front of it.
 */
export function validateDeploymentDocument(
  document: unknown,
  options: ValidateDeploymentOptions = {}
): DeploymentValidationResult {
  const issues = new Issues();

  if (document === null || document === undefined) {
    issues.error([], "File is empty");
    return result(issues, null, options);
  }
  if (!isMapping(document)) {
    issues.error([], "Expected a mapping at the top level of the file");
    return result(issues, null, options);
  }

  const parsed = checkMapping(document, ROOT_FIELDS, [], issues);
  checkRoot(parsed, [], issues);

  return result(issues, parsed as unknown as DeploymentTemplate, options);
}

/**
 * Reads and validates the contents of a deployment file.
 *
 * `source` is the file as written — the raw text, not a parsed object.
 */
export function validateDeployment(
  source: string,
  options: ValidateDeploymentOptions = {}
): DeploymentValidationResult {
  const issues = new Issues();

  if (new TextEncoder().encode(source).length > MAX_DEPLOYMENT_BYTES) {
    issues.error([], `File exceeds the ${MAX_DEPLOYMENT_BYTES / 1024} KiB limit`);
    return result(issues, null, options);
  }

  let document: unknown;
  try {
    document = parseYaml(source);
  } catch (err) {
    issues.error([], `Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
    return result(issues, null, options);
  }

  return validateDeploymentDocument(document, options);
}

/**
 * Assembles the result.
 *
 * `template` follows the errors rather than `valid`: it is what the platform
 * would read, which `strict` does not change — strict is about what this
 * caller is willing to let through, not about what the platform does.
 */
function result(
  issues: Issues,
  template: DeploymentTemplate | null,
  options: ValidateDeploymentOptions
): DeploymentValidationResult {
  const hasErrors = issues.all.some((issue) => issue.severity === "error");
  const blocking = options.strict ? issues.all.length > 0 : hasErrors;
  return {
    valid: !blocking,
    issues: issues.all,
    template: hasErrors ? null : template,
  };
}
