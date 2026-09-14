/** The shape of a `.cosmoner/deployment.yaml` once it has been read. */

/** Severity of a single finding. */
export type DeploymentIssueSeverity = "error" | "warning";

/**
 * One problem found in a deployment file.
 *
 * Warnings are things the platform tolerates and an author probably did not
 * mean: a misspelled key that will be silently ignored, a field that still
 * works but has been superseded. They do not make a file invalid, because a
 * file written against a newer platform than this SDK knows about would
 * otherwise fail for saying something perfectly correct.
 */
export interface DeploymentIssue {
  /** Dot-joined location, with list indices — `services.0.envs.1.key`. `(root)` for the document. */
  path: string;
  message: string;
  severity: DeploymentIssueSeverity;
}

/** One entry under a service's `envs`. */
export interface DeploymentEnvVar {
  key: string;
  /** Literal value, committed with the file. Only for non-sensitive configuration. */
  value?: string;
  /** Sensitive, with the value supplied in the wizard rather than committed. */
  secret?: boolean;
  /** Name of a project variable to link. */
  from_variable?: string;
  /** Name of a stored secret to link. The value never enters this file. */
  from_secret?: string;
}

/** How a service is built. */
export interface DeploymentBuild {
  strategy?: "nixpacks" | "docker";
  command?: string;
  /** Where a static build writes the site. Static sites only. */
  output_dir?: string;
}

/** One service defined by the file. Each deploy sets up one of them. */
export interface DeploymentService {
  name: string;
  /** Defaulted to `service` when the file does not say. */
  type: "service" | "static";
  source_dir?: string;
  build?: DeploymentBuild;
  run_command?: string;
  port?: number;
  /** @deprecated Superseded by `port`, still read. */
  http_port?: number;
  /** @deprecated Superseded by `port`, still read. */
  internal_port?: number;
  instance_size?: string;
  instances?: number;
  autodeploy?: boolean;
  envs?: DeploymentEnvVar[];
}

/**
 * A deployment file as the platform reads it: defaults applied, unknown keys
 * dropped. Comparing this against what was written is the point — it is the
 * settings that will actually arrive, not the ones in the file.
 */
export interface DeploymentTemplate {
  $schema?: string;
  version: number;
  name?: string;
  region?: string;
  environment?: "default" | "development" | "staging" | "production";
  services: DeploymentService[];
}

/** What {@link validateDeployment} reports. */
export interface DeploymentValidationResult {
  /**
   * No errors were found. Warnings do not clear this flag unless the check ran
   * with `strict`.
   */
  valid: boolean;
  /** Every finding, in document order. */
  issues: DeploymentIssue[];
  /** The parsed file, or `null` when it could not be read as one. */
  template: DeploymentTemplate | null;
}

/** Options for {@link validateDeployment}. */
export interface ValidateDeploymentOptions {
  /** Treat warnings as errors, for a CI check that should not let typos through. */
  strict?: boolean;
}
