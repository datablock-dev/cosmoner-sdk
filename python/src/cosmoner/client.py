"""Entry-point clients exposing the API's service namespaces."""

from __future__ import annotations

from ._config import (
    DEFAULT_BASE_URL,
    DEFAULT_MAX_RETRIES,
    DEFAULT_TIMEOUT,
    build_config,
)
from ._transport import AsyncTransport, Transport
from .apps import AppsService, AsyncAppsService
from .buckets import AsyncBucketsService, BucketsService
from .catalog import AsyncCatalogService, CatalogService
from .databases import AsyncDatabasesService, DatabasesService
from .domains import AsyncDomainsService, DomainsService
from .email import AsyncEmailService, EmailService
from .hosting import AsyncHostingService, HostingService
from .iam import AsyncIamService, IamService
from .members import AsyncMembersService, MembersService
from .projects import AsyncProjectsService, ProjectsService
from .redis import AsyncRedisService, RedisService
from .registries import AsyncRegistriesService, RegistriesService
from .secrets import AsyncSecretsService, SecretsService
from .servers import AsyncServersService, ServersService
from .ssh_keys import AsyncSshKeysService, SshKeysService
from .variables import AsyncVariablesService, VariablesService
from .webhooks import AsyncWebhooksService, WebhooksService


class Cosmoner:
    """Synchronous Cosmoner API client.

    ``project_id`` is optional: set it here to make it the default for every
    call, or omit it and pass ``project_id=`` per method to work across
    projects with one client.
    """

    def __init__(
        self,
        api_key: str,
        project_id: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        """Validates the settings and opens the connection pool the client will reuse."""
        config = build_config(api_key, project_id, base_url, timeout, max_retries)

        self.api_key = config.api_key
        self.project_id = config.project_id
        self.base_url = config.base_url
        self.timeout = config.timeout
        self.max_retries = config.max_retries

        self._config = config
        self._transport = Transport(config)

        self.apps = AppsService(self._transport, config)
        self.buckets = BucketsService(self._transport, config)
        self.catalog = CatalogService(self._transport, config)
        self.databases = DatabasesService(self._transport, config)
        self.domains = DomainsService(self._transport, config)
        self.email = EmailService(self._transport, config)
        self.hosting = HostingService(self._transport, config)
        self.iam = IamService(self._transport, config)
        self.members = MembersService(self._transport, config)
        self.projects = ProjectsService(self._transport, config)
        self.redis = RedisService(self._transport, config)
        self.registries = RegistriesService(self._transport, config)
        self.secrets = SecretsService(self._transport, config)
        self.servers = ServersService(self._transport, config)
        self.ssh_keys = SshKeysService(self._transport, config)
        self.variables = VariablesService(self._transport, config)
        self.webhooks = WebhooksService(self._transport, config)

    def close(self) -> None:
        """Releases the underlying connection pool."""
        self._transport.close()

    def __enter__(self) -> Cosmoner:
        """Enters a context that closes the connection pool on exit."""
        return self

    def __exit__(self, *_exc_info: object) -> None:
        """Closes the connection pool when leaving the context."""
        self.close()


class AsyncCosmoner:
    """Asynchronous Cosmoner API client, mirroring :class:`Cosmoner`."""

    def __init__(
        self,
        api_key: str,
        project_id: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
    ) -> None:
        """Validates the settings and opens the connection pool the client will reuse."""
        config = build_config(api_key, project_id, base_url, timeout, max_retries)

        self.api_key = config.api_key
        self.project_id = config.project_id
        self.base_url = config.base_url
        self.timeout = config.timeout
        self.max_retries = config.max_retries

        self._config = config
        self._transport = AsyncTransport(config)

        self.apps = AsyncAppsService(self._transport, config)
        self.buckets = AsyncBucketsService(self._transport, config)
        self.catalog = AsyncCatalogService(self._transport, config)
        self.databases = AsyncDatabasesService(self._transport, config)
        self.domains = AsyncDomainsService(self._transport, config)
        self.email = AsyncEmailService(self._transport, config)
        self.hosting = AsyncHostingService(self._transport, config)
        self.iam = AsyncIamService(self._transport, config)
        self.members = AsyncMembersService(self._transport, config)
        self.projects = AsyncProjectsService(self._transport, config)
        self.redis = AsyncRedisService(self._transport, config)
        self.registries = AsyncRegistriesService(self._transport, config)
        self.secrets = AsyncSecretsService(self._transport, config)
        self.servers = AsyncServersService(self._transport, config)
        self.ssh_keys = AsyncSshKeysService(self._transport, config)
        self.variables = AsyncVariablesService(self._transport, config)
        self.webhooks = AsyncWebhooksService(self._transport, config)

    async def aclose(self) -> None:
        """Releases the underlying connection pool."""
        await self._transport.aclose()

    async def __aenter__(self) -> AsyncCosmoner:
        """Enters a context that closes the connection pool on exit."""
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        """Closes the connection pool when leaving the context."""
        await self.aclose()
