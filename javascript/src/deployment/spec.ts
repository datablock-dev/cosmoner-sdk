/**
 * Field table for `.cosmoner/deployment.yaml`.
 *
 * The platform defines this format as a Zod schema and publishes the compiled
 * JSON Schema at {@link APP_SCHEMA_URL}. This table is the third description of
 * it, and the reason it exists rather than an off-the-shelf JSON Schema
 * validator is in `schemas/README.md`: the rules worth catching in this file
 * are cross-field ones that JSON Schema cannot state.
 *
 * Keywords are named exactly as JSON Schema names them — `minLength`,
 * `maxLength`, `pattern`, `enum`, `minimum`, `maximum`, `minItems`, `maxItems`,
 * `required`, `deprecated` — so `spec.drift.test.ts` can walk this table and the
 * published document side by side and fail on the first difference. Renaming a
 * key here to something more natural would cost that check, which is the only
 * thing keeping this file honest.
 */

/** Where the platform serves the JSON Schema this table mirrors. */
export const APP_SCHEMA_URL = "https://cosmoner.com/schemas/app.schema.json";

/**
 * The format version this SDK reads.
 *
 * A file may state its version, and one stating a version we do not know is
 * refused rather than partially understood.
 */
export const DEPLOYMENT_VERSION = 1;

/** Files larger than this are refused rather than parsed, as the platform does. */
export const MAX_DEPLOYMENT_BYTES = 64 * 1024;

/**
 * Where the platform looks for the file, in order, when a repository is
 * selected in the deploy wizard. The first one that exists is the one that
 * counts — a second copy further down this list is never read.
 *
 * `.datablock/app.*` is the original location. It is still read and still last,
 * so apps already filled from it keep working; new files should not use it.
 */
export const DEPLOYMENT_FILE_PATHS = [
  ".cosmoner/deployment.yaml",
  ".cosmoner/deployment.yml",
  "deployment.yaml",
  "deployment.yml",
  ".datablock/app.yaml",
  ".datablock/app.yml",
] as const;

/** Properties shared by every entry in a field table. */
interface FieldBase {
  /** Absent is an error rather than "not set". */
  required?: boolean;
  /** Still read, but reported as a warning pointing at {@link replacedBy}. */
  deprecated?: boolean;
  /** The field that supersedes a deprecated one. Named in the warning. */
  replacedBy?: string;
  /** What the platform reads when the field is absent. */
  default?: string | number;
}

/** One field's type and constraints. */
export type FieldSpec = FieldBase &
  (
    | {
        kind: "string";
        minLength?: number;
        maxLength?: number;
        pattern?: RegExp;
        /**
         * Shown instead of a restatement of the pattern. A regex is not
         * something to put in front of someone who mistyped a service name.
         */
        patternMessage?: string;
        enum?: readonly string[];
      }
    | { kind: "integer"; minimum: number; maximum: number }
    | { kind: "boolean" }
    /** A single accepted value, with its own message — see `version`. */
    | { kind: "const"; value: number; message: string }
    | { kind: "object"; fields: FieldTable }
    | {
        kind: "array";
        minItems?: number;
        maxItems?: number;
        /** Replaces the generic "at least N" wording. */
        minItemsMessage?: string;
        item: FieldSpec;
      }
  );

/** A mapping's fields, in the order they are validated and reported. */
export type FieldTable = Record<string, FieldSpec>;

/** How a variable's name may be written in the app's own environment. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * How a stored secret or variable is named. Stricter than `ENV_KEY_PATTERN`
 * because it is not this file's rule: it is what the vault accepts, so a
 * reference that could not name an existing secret is a typo worth catching
 * before the push rather than at deploy time.
 */
const REF_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Fields of one entry under a service's `envs`. */
export const ENV_FIELDS: FieldTable = {
  key: {
    kind: "string",
    required: true,
    minLength: 1,
    maxLength: 256,
    pattern: ENV_KEY_PATTERN,
    patternMessage:
      "Env var keys must start with a letter or underscore and contain only letters, numbers, or underscores",
  },
  value: { kind: "string" },
  secret: { kind: "boolean" },
  from_variable: {
    kind: "string",
    minLength: 1,
    maxLength: 100,
    pattern: REF_PATTERN,
    patternMessage: "from_variable must name a project variable, e.g. PUBLIC_API_URL",
  },
  from_secret: {
    kind: "string",
    minLength: 1,
    maxLength: 100,
    pattern: REF_PATTERN,
    patternMessage: "from_secret must name a stored secret, e.g. DATABASE_PASSWORD",
  },
};

/** Fields of a service's `build` mapping. */
export const BUILD_FIELDS: FieldTable = {
  strategy: { kind: "string", enum: ["nixpacks", "docker"] },
  command: { kind: "string", maxLength: 1024 },
  output_dir: { kind: "string", maxLength: 512 },
};

/** Fields of one entry under `services`. */
export const SERVICE_FIELDS: FieldTable = {
  name: {
    kind: "string",
    required: true,
    minLength: 1,
    maxLength: 32,
    pattern: /^[a-z0-9][a-z0-9-]*$/,
    patternMessage:
      "Service names must be lowercase letters, numbers, or hyphens, and start with a letter or number",
  },
  type: { kind: "string", enum: ["service", "static"], default: "service" },
  source_dir: { kind: "string", maxLength: 512 },
  build: { kind: "object", fields: BUILD_FIELDS },
  run_command: { kind: "string", maxLength: 1024 },
  port: { kind: "integer", minimum: 1, maximum: 65535 },
  http_port: { kind: "integer", minimum: 1, maximum: 65535, deprecated: true, replacedBy: "port" },
  internal_port: { kind: "integer", minimum: 1, maximum: 65535, deprecated: true, replacedBy: "port" },
  instance_size: { kind: "string", maxLength: 64 },
  instances: { kind: "integer", minimum: 1, maximum: 10 },
  autodeploy: { kind: "boolean" },
  envs: { kind: "array", maxItems: 100, item: { kind: "object", fields: ENV_FIELDS } },
};

/** Fields of the document itself. */
export const ROOT_FIELDS: FieldTable = {
  $schema: { kind: "string" },
  version: {
    kind: "const",
    value: DEPLOYMENT_VERSION,
    message: `Unsupported file version — this platform reads version ${DEPLOYMENT_VERSION} files`,
    default: DEPLOYMENT_VERSION,
  },
  name: { kind: "string", maxLength: 100 },
  region: { kind: "string", maxLength: 32 },
  environment: {
    kind: "string",
    enum: ["default", "development", "staging", "production"],
  },
  services: {
    kind: "array",
    required: true,
    minItems: 1,
    minItemsMessage: "At least one service is required",
    maxItems: 10,
    item: { kind: "object", fields: SERVICE_FIELDS },
  },
};
