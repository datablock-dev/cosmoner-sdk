<?php

declare(strict_types=1);

namespace Cosmoner\Sdk;

use InvalidArgumentException;

/**
 * Reads the invoices issued to a project. Needs a key with `billing:read`.
 *
 * Amounts are in minor units of `currency`: `4900` is USD 49.00. The links are
 * null while an invoice is a draft.
 *
 * @phpstan-type Invoice array{
 *     id: string,
 *     number: ?string,
 *     created: string,
 *     amountDue: int,
 *     currency: string,
 *     status: ?string,
 *     hostedInvoiceUrl: ?string,
 *     invoicePdfUrl: ?string,
 *     project: null,
 *     ...
 * }
 * @phpstan-type InvoicePage array{
 *     data: list<Invoice>,
 *     hasMore: bool,
 *     nextCursor: ?string,
 * }
 */
class InvoicesService
{
    /** Binds the namespace to the client's transport and resolved configuration. */
    public function __construct(
        private readonly Transport $transport,
        private readonly Config $config,
    ) {
    }

    /**
     * Lists one page of the project's invoices, newest first, at every stage.
     *
     * @param ?string $status        One of draft, open, paid, uncollectible, void.
     * @param ?string $createdGte    Inclusive lower bound: an ISO date or date-time.
     * @param ?string $createdLte    Inclusive upper bound: an ISO date or date-time.
     * @param ?int    $limit         1–100; the API defaults to 10.
     * @param ?string $startingAfter `nextCursor` from the previous page.
     *
     * @return array{success: true, data: InvoicePage}
     *
     * @throws CosmonerError On API errors.
     */
    public function list(
        ?string $status = null,
        ?string $createdGte = null,
        ?string $createdLte = null,
        ?int $limit = null,
        ?string $startingAfter = null,
        ?string $projectId = null,
    ): array {
        $query = self::filterQuery($status, $createdGte, $createdLte);
        if ($limit !== null) {
            $query['limit'] = $limit;
        }
        if ($startingAfter !== null && $startingAfter !== '') {
            $query['starting_after'] = $startingAfter;
        }

        /** @var array{success: true, data: InvoicePage} */
        return $this->transport->request('GET', $this->basePath($projectId), null, $query);
    }

    /**
     * Every invoice matching the filters in one response, newest first.
     *
     * At most 1,000: narrow the date range to reach further back. Rate-limited,
     * unlike `list()`.
     *
     * @return array{success: true, data: list<Invoice>}
     *
     * @throws CosmonerError On API errors.
     */
    public function export(
        ?string $status = null,
        ?string $createdGte = null,
        ?string $createdLte = null,
        ?string $projectId = null,
    ): array {
        $query = self::filterQuery($status, $createdGte, $createdLte);

        /** @var array{success: true, data: list<Invoice>} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/export', null, $query);
    }

    /**
     * Reads one invoice by the id `list()` returns.
     *
     * @return array{success: true, data: Invoice}
     *
     * @throws CosmonerError On API errors.
     * @throws InvalidArgumentException On invalid input.
     */
    public function get(string $invoiceId, ?string $projectId = null): array
    {
        if ($invoiceId === '') {
            throw new InvalidArgumentException('invoiceId is required');
        }

        /** @var array{success: true, data: Invoice} */
        return $this->transport->request('GET', $this->basePath($projectId) . '/' . rawurlencode($invoiceId));
    }

    /** Builds the collection route for the resolved project. */
    private function basePath(?string $projectId): string
    {
        return '/v1/projects/' . $this->config->resolveProjectId($projectId) . '/billing/invoices';
    }

    /**
     * The filters `list()` and `export()` share, leaving out the absent ones.
     *
     * @return array<string, string>
     */
    private static function filterQuery(?string $status, ?string $createdGte, ?string $createdLte): array
    {
        $query = [];
        if ($status !== null) {
            $query['status'] = $status;
        }
        if ($createdGte !== null && $createdGte !== '') {
            $query['created_gte'] = $createdGte;
        }
        if ($createdLte !== null && $createdLte !== '') {
            $query['created_lte'] = $createdLte;
        }

        return $query;
    }
}
