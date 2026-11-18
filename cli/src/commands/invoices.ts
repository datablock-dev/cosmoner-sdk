/**
 * `cosmoner invoices` — read a project's invoices, export them for
 * bookkeeping, and save one as a PDF.
 *
 * Not one of the products in read/products.ts: those list everything and pick
 * an item out of the listing, and an invoice list is paged, filtered by date and
 * status, and exported as a spreadsheet. The verbs and output follow the
 * products' all the same — `get` with no reference lists, `--format json` prints
 * the API's objects.
 *
 * CSV is written here rather than asked of the API. The API answers in JSON,
 * the one format every caller can read, and the control panel builds its CSV
 * from the same objects; keeping the conversion at the edge means the columns
 * can change without an API version.
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { NotFoundError, type Cosmoner, type Invoice, type InvoiceFilterParams, type InvoiceStatus } from "@cosmoner/sdk";

import { readChoice, readValue, rejectUnknownFlags, UsageError, type ParsedArgs } from "../args";
import { makeClient } from "../credentials";
import { day, explain, renderTable } from "./config-entries";

export const INVOICES_HELP = `cosmoner invoices <get|list|export|download> [<invoice>] [options]

Reads the invoices issued to a project, newest first, at every stage: drafts
still being prepared, open invoices awaiting payment, and settled ones.

  cosmoner invoices get                          The latest invoices.
  cosmoner invoices get <invoice>                One invoice, by id or number.
  cosmoner invoices export --from 2026-01-01 --to 2026-03-31 > q1.csv
  cosmoner invoices download <invoice>           Save it as <number>.pdf.

get with no <invoice> lists the latest ones; list is the same. export writes
every invoice matching the filters, up to 1,000, as CSV; it is rate-limited, so
reach for get for a quick look.

Options
  --status <status>    draft, open, paid, uncollectible or void.
  --from <date>        Invoices on or after this ISO date or date-time.
  --to <date>          Invoices on or before it.
  --limit <n>          get and list: how many, from 1 to 100. Default 25.
  --format <format>    get and list: text (default) or json. export: csv
                       (default) or json.
  --out <file>         download: where to save the PDF. Defaults to the
                       invoice number, as <number>.pdf, in this directory.
  --project <project>  Project to read, by slug or id. Defaults to
                       COSMONER_PROJECT_ID, then the one set with cosmoner use.

Amounts are in the invoice's currency. A draft has no number and no PDF yet.

Environment
  COSMONER_API_KEY     API key to use instead of cosmoner login. Needs
                       billing:read.
  COSMONER_PROJECT_ID  Project to use when --project is not given.
  COSMONER_API_URL     API base URL. Defaults to https://api.cosmoner.com.

Exit code is 0 on success, 1 when the API refused or the invoice was not
found, and 2 when the command itself was wrong.`;

/** Flags taking a separate value. */
export const INVOICES_VALUE_FLAGS = ["status", "from", "to", "limit", "format", "out", "project"];
const INVOICES_FLAGS = [...INVOICES_VALUE_FLAGS, "help"];

const VERBS = ["get", "list", "export", "download"] as const;
type Verb = (typeof VERBS)[number];

const READ_FORMATS = ["text", "json"] as const;
const EXPORT_FORMATS = ["csv", "json"] as const;

/** How many invoices `get` lists when --limit is not given. */
const DEFAULT_LIMIT = 25;

/** The most pages `get <number>` walks looking for an invoice number, the API's export cap. */
const MAX_SEARCH_PAGES = 10;

/** An invoice id: the characters the API accepts in the path. Anything else is a number. */
const INVOICE_ID = /^[A-Za-z0-9_]+$/;

/** Runs `cosmoner invoices`, returning the exit code. */
export async function runInvoices(args: ParsedArgs, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  rejectUnknownFlags(args, INVOICES_FLAGS);

  const [verb, ref, ...extra] = args.positional;
  if (verb === undefined) throw new UsageError("Name what to do: cosmoner invoices get");
  if (!(VERBS as readonly string[]).includes(verb)) {
    throw new UsageError(`Unknown subcommand "cosmoner invoices ${verb}"`);
  }
  if (extra.length > 0) throw new UsageError(`Unexpected argument "${extra[0]}"`);

  const plan = readPlan(verb as Verb, ref, args, cwd);
  const client = await makeClient(args, env, "billing:read");

  try {
    switch (plan.verb) {
      case "list":
        return await list(client, plan.filters, plan.limit, plan.format);
      case "get":
        return await show(client, plan.ref, plan.format);
      case "export":
        return await exportInvoices(client, plan.filters, plan.format);
      case "download":
        return await download(client, plan.ref, plan.out, cwd);
    }
  } catch (err) {
    console.error(explain(err));
    return 1;
  }
}

/** What one command line asks for, checked in full before any request is sent. */
type Plan =
  | { verb: "list"; filters: InvoiceFilterParams; limit: number; format: "text" | "json" }
  | { verb: "get"; ref: string; format: "text" | "json" }
  | { verb: "export"; filters: InvoiceFilterParams; format: "csv" | "json" }
  | { verb: "download"; ref: string; out: string | undefined };

/**
 * Reads the command line into a plan, refusing flags that do not apply to the
 * verb, so `export --limit 5` is a usage error rather than a silently full
 * export.
 */
function readPlan(verb: Verb, ref: string | undefined, args: ParsedArgs, cwd: string): Plan {
  const allowed: Record<Verb, readonly string[]> = {
    get: ref === undefined ? ["status", "from", "to", "limit", "format", "project"] : ["format", "project"],
    list: ["status", "from", "to", "limit", "format", "project"],
    export: ["status", "from", "to", "format", "project"],
    download: ["out", "project"],
  };
  for (const name of args.flags.keys()) {
    if (name !== "help" && !allowed[verb].includes(name)) {
      const which = verb === "get" && ref !== undefined ? "get <invoice>" : verb;
      throw new UsageError(`--${name} does not apply to cosmoner invoices ${which}`);
    }
  }

  if (verb === "list" && ref !== undefined) {
    throw new UsageError("cosmoner invoices list takes no invoice; use get <invoice>");
  }
  if (verb === "export" && ref !== undefined) {
    throw new UsageError(`Unexpected argument "${ref}"`);
  }

  if (verb === "download") {
    if (ref === undefined) throw new UsageError("Name the invoice: cosmoner invoices download <invoice>");
    const out = readValue(args, "out");
    if (out !== undefined && existsSync(resolve(cwd, out))) {
      throw new UsageError(`${out} already exists; choose another --out`);
    }
    return { verb, ref, out };
  }
  if (verb === "export") {
    return { verb, filters: readFilters(args), format: readChoice(args, "format", EXPORT_FORMATS, "csv") };
  }

  const format = readChoice(args, "format", READ_FORMATS, "text");
  if (verb === "get" && ref !== undefined) return { verb: "get", ref, format };
  return { verb: "list", filters: readFilters(args), limit: readLimit(args), format };
}

/** The status and date filters `get`, `list` and `export` share. */
function readFilters(args: ParsedArgs): InvoiceFilterParams {
  return {
    // Checked by the API, so a status it adds later needs no CLI release.
    status: readValue(args, "status") as InvoiceStatus | undefined,
    createdGte: readValue(args, "from"),
    createdLte: readValue(args, "to"),
  };
}

/** --limit as a whole number from 1 to 100, the API's page size. */
function readLimit(args: ParsedArgs): number {
  const raw = readValue(args, "limit");
  if (raw === undefined) return DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || limit < 1 || limit > 100) {
    throw new UsageError("--limit must be a whole number from 1 to 100");
  }
  return limit;
}

/** `get` with no invoice: the newest page, and a pointer to export when there is more. */
async function list(
  client: Cosmoner,
  filters: InvoiceFilterParams,
  limit: number,
  format: "text" | "json"
): Promise<number> {
  const { data: page } = await client.invoices.list({ ...filters, limit });

  if (format === "json") {
    console.log(JSON.stringify(page.data, null, 2));
  } else if (page.data.length === 0) {
    console.log("No invoices.");
  } else {
    console.log(
      renderTable(
        ["NUMBER", "DATE", "STATUS", "AMOUNT", "ID"],
        page.data.map((invoice) => [
          invoice.number ?? "-",
          day(invoice.created),
          invoice.status ?? "-",
          formatAmount(invoice.amountDue, invoice.currency),
          invoice.id,
        ])
      )
    );
  }
  // On stderr, so a script reading the JSON array is not handed a sentence.
  if (page.hasMore) {
    console.error(`More invoices than these ${page.data.length}: raise --limit, or cosmoner invoices export for all of them.`);
  }
  return 0;
}

/** `get <invoice>`: one invoice, every field. */
async function show(client: Cosmoner, ref: string, format: "text" | "json"): Promise<number> {
  const invoice = await find(client, ref);
  if (!invoice) return 1;

  if (format === "json") {
    console.log(JSON.stringify(invoice, null, 2));
    return 0;
  }
  const fields: Array<[string, string]> = [
    ["number", invoice.number ?? "-"],
    ["id", invoice.id],
    ["date", day(invoice.created)],
    ["status", invoice.status ?? "-"],
    ["amount", formatAmount(invoice.amountDue, invoice.currency)],
    ["invoice", invoice.hostedInvoiceUrl ?? "-"],
    ["pdf", invoice.invoicePdfUrl ?? "-"],
  ];
  const width = Math.max(...fields.map(([key]) => key.length));
  console.log(fields.map(([key, value]) => `${`${key}:`.padEnd(width + 2)}${value}`).join("\n"));
  return 0;
}

/** `export`: every matching invoice, as CSV or as the API's array. */
async function exportInvoices(
  client: Cosmoner,
  filters: InvoiceFilterParams,
  format: "csv" | "json"
): Promise<number> {
  const { data } = await client.invoices.export(filters);
  console.log(format === "json" ? JSON.stringify(data, null, 2) : invoicesToCsv(data));
  return 0;
}

/** `download`: saves an issued invoice's PDF. */
async function download(client: Cosmoner, ref: string, out: string | undefined, cwd: string): Promise<number> {
  const invoice = await find(client, ref);
  if (!invoice) return 1;
  if (!invoice.invoicePdfUrl) {
    console.error(`Invoice "${ref}" has no PDF yet: it is still a draft.`);
    return 1;
  }

  const target = resolve(cwd, out ?? `${safeFileName(invoice.number ?? invoice.id)}.pdf`);
  if (out === undefined && existsSync(target)) {
    console.error(`${target} already exists; choose a path with --out`);
    return 1;
  }

  // A plain fetch, not the SDK's transport: the link is a signed download
  // that needs no credential, and the API key must not travel to another host.
  const response = await fetch(invoice.invoicePdfUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok || !isPdf(bytes)) {
    console.error(`Could not download the PDF for invoice "${ref}" (HTTP ${response.status}).`);
    return 1;
  }

  writeFileSync(target, bytes, { flag: "wx" });
  console.log(`✓ Saved ${invoice.number ?? invoice.id} to ${target}`);
  return 0;
}

/**
 * Finds an invoice by id or by its number.
 *
 * An id goes straight to the API. A number — or an id the API does not know —
 * is looked for page by page, since the API reads invoices by id only.
 */
async function find(client: Cosmoner, ref: string): Promise<Invoice | undefined> {
  if (INVOICE_ID.test(ref)) {
    try {
      return (await client.invoices.get(ref)).data;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }
  }

  let startingAfter: string | undefined;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const { data } = await client.invoices.list({ limit: 100, startingAfter });
    const match = data.data.find((invoice) => invoice.number === ref);
    if (match) return match;
    if (!data.hasMore || !data.nextCursor) break;
    startingAfter = data.nextCursor;
  }

  console.error(`No invoice "${ref}" in this project.`);
  return undefined;
}

/** CSV columns: the control panel's export, then the PDF link. */
const CSV_COLUMNS = ["Invoice", "Date", "Status", "Amount", "Currency", "Invoice URL", "PDF URL"] as const;

/** Renders invoices as CSV, one row per invoice, with CRLF line endings. */
export function invoicesToCsv(invoices: Invoice[]): string {
  const rows = invoices.map((invoice) =>
    [
      invoice.number ?? invoice.id,
      // ISO dates sort correctly as text and do not depend on the reader's locale.
      day(invoice.created),
      invoice.status ?? "",
      toDecimal(invoice.amountDue, invoice.currency),
      invoice.currency,
      invoice.hostedInvoiceUrl ?? "",
      invoice.invoicePdfUrl ?? "",
    ]
      .map(csvCell)
      .join(",")
  );
  return [CSV_COLUMNS.map(csvCell).join(","), ...rows].join("\r\n");
}

/**
 * Quotes a value for CSV. A leading `=`, `+`, `-` or `@` gets a single quote in
 * front: spreadsheets otherwise read those cells as formulas, which is how a
 * text field becomes code on someone else's machine.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Digits after the decimal point in a currency: 2 for USD, 0 for JPY. */
function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Minor units as a plain decimal, so a spreadsheet reads the column as numbers. */
function toDecimal(minorUnits: number, currency: string): string {
  const digits = fractionDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

/** Minor units as an amount with its currency, for the terminal: `49.00 USD`. */
function formatAmount(minorUnits: number, currency: string): string {
  return `${toDecimal(minorUnits, currency)} ${currency}`;
}

/** An invoice number as a file name: anything but letters, digits, `-` and `_` becomes `_`. */
function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Whether the bytes start with the PDF signature, so an error page is never saved as a PDF. */
function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}
