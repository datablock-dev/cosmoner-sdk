<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

/**
 * Read operations on a project's members and pending invitations.
 *
 * The API returns more fields than the shapes below declare.
 *
 * @phpstan-type Member array{
 *     id: string,
 *     userId: string,
 *     role: string,
 *     createdAt: string,
 *     user: array{name: ?string, email: string, image: ?string, ...},
 *     ...
 * }
 * @phpstan-type Invitation array{
 *     id: string,
 *     email: string,
 *     role: string,
 *     expiresAt: string,
 *     ...
 * }
 * @phpstan-type Members array{
 *     orgId: string,
 *     currentUserId: ?string,
 *     billerUserId: ?string,
 *     pendingBillerUserId: ?string,
 *     members: list<Member>,
 *     pendingInvitations: list<Invitation>,
 *     ...
 * }
 */
class MembersService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists the project's members and its pending invitations.
     *
     * @param string|null $projectId Overrides the client-level default project.
     *
     * @return array{success: true, data: Members}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(?string $projectId = null): array
    {
        $project = $this->config->resolveProjectId($projectId);

        /** @var array{success: true, data: Members} */
        return $this->transport->request('GET', "/v1/projects/{$project}/members");
    }
}
