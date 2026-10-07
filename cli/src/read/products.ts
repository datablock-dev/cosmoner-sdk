/**
 * Every product `cosmoner <product> get` can read, and how each one is shown.
 *
 * A product here is a listing call, a rule for which listed item a reference
 * names, an optional call for one item's full detail, and the columns of its
 * table. Everything else — flags, output, redaction, errors — is shared in
 * resource.ts, so the commands behave the same whichever product an agent
 * reads.
 */

import { APP_ACTIONS, DOMAIN_ACTIONS, SSH_KEY_ACTIONS, WEBHOOK_ACTIONS } from "../write/actions";
import {
  APP_ORDER_ACTIONS,
  BUCKET_ORDER_ACTIONS,
  DATABASE_ORDER_ACTIONS,
  HOSTING_ORDER_ACTIONS,
  REDIS_ORDER_ACTIONS,
  REGISTRY_ORDER_ACTIONS,
  SERVER_ORDER_ACTIONS,
} from "../write/create";
import { EMAIL_CREDENTIAL_ACTIONS, IAM_CREDENTIAL_ACTIONS, SSH_KEY_GENERATE_ACTIONS } from "../write/credentials";
import { DATABASE_ACTIONS, EMAIL_DOMAIN_ACTIONS, PROJECT_ACTIONS, SERVER_ACTIONS } from "../write/lifecycle";
import type { ReadableResource } from "./resource";

/** True when `ref` is any of the given identifiers, compared exactly. */
function isOneOf(ref: string, ...ids: Array<string | null | undefined>): boolean {
  return ids.some((id) => id !== null && id !== undefined && id === ref);
}

/** The date part of an ISO timestamp, for table columns. */
function day(timestamp: unknown): string {
  return typeof timestamp === "string" ? timestamp.slice(0, 10) : "-";
}

/** A project's resource counts, which the API names `_count`. */
function counts(row: Row): Record<string, number> {
  return row["_count"] ?? {};
}

/** `n` with a unit, or a dash when the value is missing. */
function sized(value: unknown, unit: string): string {
  return typeof value === "number" ? `${value} ${unit}` : "-";
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- API objects are shown, not typed, here.

export const PRODUCTS: Record<string, ReadableResource<Row>> = {
  projects: {
    command: "projects",
    noun: "project",
    refHelp: "slug, id or name",
    scope: "projects:read",
    projectScoped: false,
    list: async (client) => (await client.projects.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.slug, row.name),
    fetch: async (client, row) => (await client.projects.get(row.id)).data,
    columns: [
      { header: "SLUG", value: (row) => row.slug },
      { header: "NAME", value: (row) => row.name },
      { header: "APPS", value: (row) => counts(row).apps },
      { header: "SERVERS", value: (row) => counts(row).servers },
      { header: "DATABASES", value: (row) => counts(row).databaseClusters },
      { header: "MEMBERS", value: (row) => counts(row).members },
    ],
    notes: "Lists every project your login can reach; an API key sees only its own.",
    remove: (client, row) => client.projects.delete(row.id),
    removeWarning: "Owner only, and refused while it still holds resources: delete those first.",
    actions: PROJECT_ACTIONS,
  },

  apps: {
    command: "apps",
    noun: "app",
    refHelp: "name or id",
    scope: "apps:read",
    projectScoped: true,
    list: async (client) => (await client.apps.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.apps.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "STATUS", value: (row) => row.status },
      { header: "URL", value: (row) => row.url },
      { header: "SOURCE", value: (row) => row.gitRepo ?? row.containerImage },
      { header: "CREATED", value: (row) => day(row.createdAt) },
    ],
    notes:
      "Environment variables marked secret show masked. cosmoner apps logs <app> reads an app's log.",
    remove: (client, row) => client.apps.delete(row.id),
    removeWarning: "Its runtime, routing, custom domain and deployments go with it.",
    actions: { ...APP_ORDER_ACTIONS, ...APP_ACTIONS },
  },

  servers: {
    command: "servers",
    noun: "server",
    refHelp: "name or id",
    scope: "servers:read",
    projectScoped: true,
    list: async (client) => (await client.servers.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.servers.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "STATUS", value: (row) => row.status },
      { header: "TYPE", value: (row) => row.type },
      { header: "IP", value: (row) => row.ipAddress },
      { header: "REGION", value: (row) => row.region },
      { header: "SIZE", value: (row) => row.instanceType },
    ],
    remove: (client, row) => client.servers.delete(row.id),
    removeWarning: "Its disk and everything on it go with it, and its billing stops.",
    actions: { ...SERVER_ORDER_ACTIONS, ...SERVER_ACTIONS },
  },

  "ssh-keys": {
    command: "ssh-keys",
    noun: "ssh-key",
    refHelp: "name, id or fingerprint",
    scope: "servers:read",
    projectScoped: true,
    list: async (client) => (await client.sshKeys.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name, row.fingerprint),
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "FINGERPRINT", value: (row) => row.fingerprint },
      { header: "CREATED", value: (row) => day(row.createdAt) },
    ],
    notes: "Only public keys are stored.",
    remove: (client, row) => client.sshKeys.delete(row.id),
    removeWarning: "Servers it was already installed on keep accepting it.",
    writeScope: "servers:write",
    actions: { ...SSH_KEY_ACTIONS, ...SSH_KEY_GENERATE_ACTIONS },
  },

  databases: {
    command: "databases",
    noun: "database",
    refHelp: "name or id",
    scope: "databases:read",
    projectScoped: true,
    list: async (client) => (await client.databases.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) =>
      row.kind === "DEDICATED"
        ? (await client.databases.getDedicated(row.id)).data
        : (await client.databases.getShared(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "KIND", value: (row) => (row.kind === "DEDICATED" ? "dedicated" : "shared") },
      { header: "ENGINE", value: (row) => row.engine },
      { header: "VERSION", value: (row) => row.version },
      { header: "STATUS", value: (row) => row.status },
      { header: "PLAN", value: (row) => row.plan },
      { header: "REGION", value: (row) => row.region },
    ],
    notes: "A dedicated database's connection URI is hidden; it carries the password.",
    remove: (client, row) =>
      row.kind === "DEDICATED" ? client.databases.deleteDedicated(row.id) : client.databases.deleteShared(row.id),
    removeWarning: "Its data goes with it, and its billing stops.",
    actions: { ...DATABASE_ORDER_ACTIONS, ...DATABASE_ACTIONS },
  },

  redis: {
    command: "redis",
    noun: "redis",
    refHelp: "name or id",
    scope: "redis:read",
    projectScoped: true,
    list: async (client) => (await client.redis.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.redis.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "ENGINE", value: (row) => row.engine },
      { header: "STATUS", value: (row) => row.status },
      { header: "MEMORY", value: (row) => sized(row.memoryMb, "MB") },
      { header: "REGION", value: (row) => row.region },
      { header: "HOST", value: (row) => row.host },
    ],
    notes: "The password is hidden.",
    remove: (client, row) => client.redis.delete(row.id),
    removeWarning: "Its data goes with it, and its billing stops.",
    actions: REDIS_ORDER_ACTIONS,
  },

  domains: {
    command: "domains",
    noun: "domain",
    refHelp: "name (example.com) or id",
    scope: "domains:read",
    projectScoped: true,
    list: async (client) => (await client.domains.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.domains.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "TYPE", value: (row) => row.type },
      { header: "STATUS", value: (row) => row.status },
      { header: "EXPIRES", value: (row) => day(row.expiresAt) },
      { header: "AUTO-RENEW", value: (row) => (row.autoRenew ? "yes" : "no") },
      { header: "RECORDS", value: (row) => (Array.isArray(row.dnsRecords) ? row.dnsRecords.length : "-") },
    ],
    remove: (client, row) => client.domains.delete(row.id),
    removeWarning: "Its DNS records go with it. Refused while an app or email domain uses it.",
    actions: DOMAIN_ACTIONS,
  },

  buckets: {
    command: "buckets",
    noun: "bucket",
    refHelp: "name or id",
    scope: "object-storage:read",
    projectScoped: true,
    list: async (client) => (await client.buckets.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "STATUS", value: (row) => row.status },
      { header: "TIER", value: (row) => row.tier },
      { header: "REGION", value: (row) => row.region },
      { header: "PUBLIC", value: (row) => (row.publicAccess ? "yes" : "no") },
      { header: "CDN", value: (row) => (row.cdnEnabled ? row.cdnDomain ?? "yes" : "no") },
    ],
    notes: "Access keys are never listed.",
    remove: (client, row) => client.buckets.delete(row.id),
    removeWarning: "Every object in it and its access keys go with it, and its billing stops.",
    writeScope: "object-storage:write",
    actions: BUCKET_ORDER_ACTIONS,
  },

  registries: {
    command: "registries",
    noun: "registry",
    refHelp: "name or id",
    scope: "registry:read",
    projectScoped: true,
    list: async (client) => (await client.registries.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.registries.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "STATUS", value: (row) => row.status },
      { header: "REGION", value: (row) => row.region },
      { header: "REPOSITORIES", value: (row) => (Array.isArray(row.repositories) ? row.repositories.length : "-") },
      { header: "CREATED", value: (row) => day(row.createdAt) },
    ],
    remove: (client, row) => client.registries.delete(row.id),
    removeWarning: "Every repository and image in it goes with it, and its billing stops.",
    actions: REGISTRY_ORDER_ACTIONS,
  },

  email: {
    command: "email",
    noun: "domain",
    refHelp: "domain name or sending-domain id",
    scope: "email:read",
    projectScoped: true,
    list: async (client) => (await client.email.listDomains()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.domain?.name),
    fetch: async (client, row) => (await client.email.getDomain(row.id)).data,
    columns: [
      { header: "DOMAIN", value: (row) => row.domain?.name },
      { header: "STATUS", value: (row) => row.status },
      { header: "CREDENTIALS", value: (row) => (Array.isArray(row.credentials) ? row.credentials.length : "-") },
      { header: "VERIFIED", value: (row) => day(row.verifiedAt) },
    ],
    notes: "Lists sending domains. SMTP passwords are never returned.",
    remove: (client, row) => client.email.deleteDomain(row.id),
    removeWarning: "Sending from it stops. The domain itself stays in the project.",
    actions: { ...EMAIL_DOMAIN_ACTIONS, ...EMAIL_CREDENTIAL_ACTIONS },
  },

  iam: {
    command: "iam",
    noun: "credential",
    refHelp: "IAM user name or label",
    scope: "iam:read",
    projectScoped: true,
    list: async (client) => (await client.iam.list()).data.credentials,
    matches: (row, ref) => isOneOf(ref, row.iamUserName, row.label),
    fetch: async (client, row) => (await client.iam.get(row.iamUserName)).data,
    columns: [
      { header: "NAME", value: (row) => row.iamUserName },
      { header: "LABEL", value: (row) => row.label },
      { header: "FOR", value: (row) => row.origin },
      { header: "CREATED", value: (row) => day(row.createdAt) },
    ],
    notes: "Lists storage and registry access credentials. Key material is never printed.",
    remove: (client, row) => client.iam.delete(row.iamUserName),
    removeWarning: "Anything using its access keys stops working.",
    actions: IAM_CREDENTIAL_ACTIONS,
  },

  members: {
    command: "members",
    noun: "member",
    refHelp: "email or user id",
    scope: "members:read",
    projectScoped: true,
    list: async (client) => (await client.members.list()).data.members,
    matches: (row, ref) => isOneOf(ref, row.userId, row.id, row.user?.email),
    columns: [
      { header: "NAME", value: (row) => row.user?.name },
      { header: "EMAIL", value: (row) => row.user?.email },
      { header: "ROLE", value: (row) => row.role },
      { header: "JOINED", value: (row) => day(row.createdAt) },
    ],
  },

  hosting: {
    command: "hosting",
    noun: "site",
    refHelp: "name or id",
    scope: "hosting:read",
    projectScoped: true,
    list: async (client) => (await client.hosting.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.siteName),
    fetch: async (client, row) => (await client.hosting.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.siteName },
      { header: "STATUS", value: (row) => row.status },
      { header: "PHP", value: (row) => row.phpVersion },
      { header: "URL", value: (row) => row.url },
      { header: "TIER", value: (row) => row.tier },
    ],
    notes: "cosmoner upload <site> <dir> uploads to a site.",
    remove: (client, row) => client.hosting.delete(row.id),
    removeWarning: "Its files, databases and domains go with it, and its billing stops.",
    actions: HOSTING_ORDER_ACTIONS,
  },

  webhooks: {
    command: "webhooks",
    noun: "webhook",
    refHelp: "name or id",
    scope: "webhooks:read",
    projectScoped: true,
    list: async (client) => (await client.webhooks.list()).data,
    matches: (row, ref) => isOneOf(ref, row.id, row.name),
    fetch: async (client, row) => (await client.webhooks.get(row.id)).data,
    columns: [
      { header: "NAME", value: (row) => row.name },
      { header: "URL", value: (row) => row.url },
      { header: "ENABLED", value: (row) => (row.enabled ? "yes" : "no") },
      { header: "EVENTS", value: (row) => (Array.isArray(row.events) ? row.events.length : "-") },
      { header: "FAILURES", value: (row) => row.consecutiveFailures },
    ],
    notes: "The signing secret is never printed.",
    remove: (client, row) => client.webhooks.delete(row.id),
    removeWarning: "Its delivery history goes with it.",
    actions: WEBHOOK_ACTIONS,
  },
};
