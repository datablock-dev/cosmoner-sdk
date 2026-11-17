import pytest

from cosmoner import AsyncCosmoner, Cosmoner

BASE = "https://api.test.dev/v1/projects/proj-1/billing/invoices"

INVOICE = {
    "id": "in_1",
    "number": "DB-0001",
    "created": "2026-02-01T09:15:00.000Z",
    "amountDue": 4900,
    "currency": "USD",
    "status": "paid",
    "hostedInvoiceUrl": "https://invoices.test/in_1",
    "invoicePdfUrl": "https://invoices.test/in_1/pdf",
    "project": None,
}

PAGE = {"data": [INVOICE], "hasMore": False, "nextCursor": None}


@pytest.fixture()
def client():
    """Provide a Cosmoner client configured for testing, with retries disabled."""
    return Cosmoner(
        api_key="key-123",
        project_id="proj-1",
        base_url="https://api.test.dev",
        max_retries=0,
    )


class TestInvoicesValidation:
    """Tests for client-side argument validation."""

    def test_rejects_an_empty_invoice_id(self, client):
        with pytest.raises(ValueError, match="invoice_id is required"):
            client.invoices.get("")

    def test_requires_a_project_id_when_the_client_has_no_default(self):
        scopeless = Cosmoner(api_key="key-123", max_retries=0)

        with pytest.raises(ValueError, match="project_id is required"):
            scopeless.invoices.list()


class TestInvoices:
    """Tests for invoice reads via mocked HTTP."""

    def test_lists_a_page_with_no_query_by_default(self, client, httpx_mock):
        httpx_mock.add_response(url=BASE, json={"success": True, "data": PAGE})

        result = client.invoices.list()

        assert result["data"] == PAGE
        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert request.url.query == b""

    def test_sends_the_filters_and_cursor(self, client, httpx_mock):
        httpx_mock.add_response(json={"success": True, "data": PAGE})

        client.invoices.list(
            status="open",
            created_gte="2026-01-01",
            created_lte="2026-06-30",
            limit=50,
            starting_after="in_9",
        )

        request = httpx_mock.get_request()
        assert request.url.path == "/v1/projects/proj-1/billing/invoices"
        assert dict(request.url.params) == {
            "status": "open",
            "created_gte": "2026-01-01",
            "created_lte": "2026-06-30",
            "limit": "50",
            "starting_after": "in_9",
        }

    def test_exports_without_paging(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/export?status=paid&created_gte=2026-01-01",
            json={"success": True, "data": [INVOICE]},
        )

        result = client.invoices.export(status="paid", created_gte="2026-01-01")

        assert result["data"] == [INVOICE]

    def test_reads_one_invoice(self, client, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}/in_1", json={"success": True, "data": INVOICE}
        )

        result = client.invoices.get("in_1")

        assert result["data"]["invoicePdfUrl"] == "https://invoices.test/in_1/pdf"

    def test_encodes_the_invoice_id_as_one_segment(self, client, httpx_mock):
        httpx_mock.add_response(json={"success": True, "data": INVOICE})

        client.invoices.get("in/../x")

        assert httpx_mock.get_request().url.raw_path == (
            b"/v1/projects/proj-1/billing/invoices/in%2F..%2Fx"
        )

    def test_targets_another_project_per_call(self, client, httpx_mock):
        httpx_mock.add_response(
            url="https://api.test.dev/v1/projects/proj-2/billing/invoices/in_1",
            json={"success": True, "data": INVOICE},
        )

        client.invoices.get("in_1", project_id="proj-2")


class TestAsyncInvoices:
    """Tests for the async invoices namespace."""

    async def test_lists_exports_and_reads(self, httpx_mock):
        httpx_mock.add_response(
            url=f"{BASE}?limit=5", json={"success": True, "data": PAGE}
        )
        httpx_mock.add_response(
            url=f"{BASE}/export?status=open", json={"success": True, "data": [INVOICE]}
        )
        httpx_mock.add_response(
            url=f"{BASE}/in_1", json={"success": True, "data": INVOICE}
        )

        async with AsyncCosmoner(
            api_key="key-123",
            project_id="proj-1",
            base_url="https://api.test.dev",
            max_retries=0,
        ) as client:
            page = await client.invoices.list(limit=5)
            exported = await client.invoices.export(status="open")
            one = await client.invoices.get("in_1")

        assert page["data"] == PAGE
        assert exported["data"] == [INVOICE]
        assert one["data"] == INVOICE

    async def test_rejects_an_empty_invoice_id(self):
        async with AsyncCosmoner(
            api_key="key-123", project_id="proj-1", max_retries=0
        ) as client:
            with pytest.raises(ValueError, match="invoice_id is required"):
                await client.invoices.get("")
