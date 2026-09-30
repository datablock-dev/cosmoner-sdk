/** Shapes and rules shared by the `secrets` and `variables` namespaces. */

/**
 * Which environment an entry resolves against.
 *
 * `default` applies everywhere unless an environment-specific entry of the
 * same name exists, which then wins.
 */
export type ProjectEnvironment = "default" | "development" | "staging" | "production";

/** Every environment the API accepts. */
export const PROJECT_ENVIRONMENTS: readonly ProjectEnvironment[] = [
  "default",
  "development",
  "staging",
  "production",
];

/** A project member, as embedded in the audit fields of a secret or variable. */
export interface Actor {
  id: string;
  name: string;
  email: string;
}

/** The name rule the API enforces, mirrored here to save a round trip. */
const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/** Longest name and value the API stores. */
const MAX_NAME_LENGTH = 100;
const MAX_VALUE_LENGTH = 10_000;

/** Rejects a name the API would reject, using the message the API would send. */
export function requireEntryName(name: string): void {
  if (!name) throw new Error("name is required");
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      "Name must be uppercase letters, numbers, or underscores, and start with a letter (e.g. DB_PASSWORD)"
    );
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }
}

/** Rejects a value the API would reject. */
export function requireEntryValue(value: string): void {
  if (!value) throw new Error("value is required");
  if (value.length > MAX_VALUE_LENGTH) {
    throw new Error(`value must be at most ${MAX_VALUE_LENGTH} characters`);
  }
}
