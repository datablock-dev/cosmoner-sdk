/* eslint-disable require-await -- Kept `async` like every other service method,
   so callers get one promise contract. */

/**
 * Catalog service namespace — the sizes, plans and regions paid resources are
 * ordered with. Account-level: it never uses the client's default project.
 */

import type { Transport } from "../transport";

/** A server size. */
export interface ServerSize {
  slug: string;
  description: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  transferTb: number;
  /** Whole dollars. */
  priceMonthly: number;
  priceHourly: number;
}

/** A region a resource can be created in. */
export interface CatalogRegion {
  slug: string;
  name: string;
  features?: string[];
}

/** A Redis plan. */
export interface RedisPlan {
  slug: string;
  name: string;
  provider: string;
  engine: string;
  planType: string;
  memoryMb: number;
  throughputOps: number | null;
  cpuMilli: number | null;
  supportsReplication: boolean;
  supportsPersistence: boolean;
  /** Dollars. */
  priceMonthly: number;
}

/** A dedicated database size. */
export interface DatabaseSize {
  slug: string;
  description: string;
  nodeClass: string;
  vcpus: number;
  memoryMb: number;
  diskGb: number;
  /** Dollars. */
  priceMonthly: number;
  numNodes: number;
}

/** What dedicated databases can be created with. */
export interface DatabaseCatalog {
  provider: string;
  sizes: DatabaseSize[];
  engines: Array<{ engine: string; versions: string[] }>;
  regions: CatalogRegion[];
  storage: unknown;
}

/** An app size, with the API's own snake_case keys. */
export interface AppSize {
  name: string;
  slug: string;
  tier_slug: string;
  cpu_type: string;
  cpus: string | number;
  memory_bytes: string | number;
  bandwidth_allowance_gib?: string | number;
  /** Dollars, as a string. */
  usd_per_month: string;
}

interface Envelope<T> {
  success: true;
  data: T;
}

export type ListServerSizesResponse = Envelope<ServerSize[]>;
export type ListRegionsResponse = Envelope<CatalogRegion[]>;
export type ListServerImagesResponse = Envelope<Array<Record<string, unknown>>>;
export type ListRedisPlansResponse = Envelope<RedisPlan[]>;
export type GetDatabaseCatalogResponse = Envelope<DatabaseCatalog>;
export type ListAppSizesResponse = Envelope<AppSize[]>;
export type ListAppRegionsResponse = Envelope<Array<Record<string, unknown>>>;

/** Read-only lookups of what can be ordered. Any credential may call them. */
export class CatalogService {
  constructor(private readonly transport: Transport) {}

  /** Lists server sizes and their prices. */
  async serverSizes(): Promise<ListServerSizesResponse> {
    return this.transport.request<ListServerSizesResponse>("GET", "/v1/catalog/servers/sizes");
  }

  /** Lists the regions servers can be created in. */
  async serverRegions(): Promise<ListRegionsResponse> {
    return this.transport.request<ListRegionsResponse>("GET", "/v1/catalog/servers/regions");
  }

  /** Lists the one-click images a server can be created from. */
  async serverImages(): Promise<ListServerImagesResponse> {
    return this.transport.request<ListServerImagesResponse>("GET", "/v1/catalog/servers/1-clicks");
  }

  /** Lists Redis plans and their prices. */
  async redisPlans(): Promise<ListRedisPlansResponse> {
    return this.transport.request<ListRedisPlansResponse>("GET", "/v1/catalog/redis/plans");
  }

  /** Lists the regions Redis can be created in. */
  async redisRegions(): Promise<ListRegionsResponse> {
    return this.transport.request<ListRegionsResponse>("GET", "/v1/catalog/redis/regions");
  }

  /** Lists dedicated database sizes, engines with their versions, and regions. */
  async databases(): Promise<GetDatabaseCatalogResponse> {
    return this.transport.request<GetDatabaseCatalogResponse>("GET", "/v1/catalog/databases");
  }

  /** Lists app sizes and their prices. */
  async appSizes(): Promise<ListAppSizesResponse> {
    return this.transport.request<ListAppSizesResponse>("GET", "/v1/catalog/apps/sizes");
  }

  /** Lists the regions apps can be created in. */
  async appRegions(): Promise<ListAppRegionsResponse> {
    return this.transport.request<ListAppRegionsResponse>("GET", "/v1/catalog/apps/regions");
  }
}
