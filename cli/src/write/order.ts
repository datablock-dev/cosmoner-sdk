/**
 * Ordering a paid resource: say what it costs, ask, then buy.
 *
 * Every paid create runs the same three steps — price it with the API's own
 * preview, put the price in front of the person through `confirm()`, and only
 * then place the order. The monthly price is exact. What is charged today is
 * an estimate once the project already pays for something, because the API
 * prorates the charge onto the existing subscription; the wording says
 * "about" for that reason, and must keep saying it.
 */

import type { CheckoutPreview, PlanChangePreview } from "@cosmoner/sdk";

import { UsageError, type ParsedArgs } from "../args";
import { confirm, refusal } from "./confirm";

/** An amount in minor units, formatted in its currency: 1200 USD → "$12.00". */
export function money(minor: number, currency: string): string {
  const format = new Intl.NumberFormat("en-US", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(minor / 10 ** digits);
}

/** A date as "25 Oct 2026". */
function day(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** The price of a new resource, in two sentences. */
export function priceText(quote: CheckoutPreview): string {
  const monthly = `It costs ${money(quote.monthly, quote.currency)} a month before tax, billed to the project's saved card.`;
  const today =
    quote.dueToday > 0
      ? `About ${money(quote.dueToday, quote.currency)} is charged now, prorated until ${day(quote.nextBillingDate)}.`
      : `Nothing is charged now; the first invoice is on ${day(quote.nextBillingDate)}.`;
  return `${monthly} ${today}`;
}

/** The price of a resize, in two sentences. */
export function changeText(quote: PlanChangePreview): string {
  const from = money(quote.currentMonthly, quote.currency);
  const to = money(quote.monthly, quote.currency);
  const now =
    quote.dueToday > 0
      ? `About ${money(quote.dueToday, quote.currency)} is charged now.`
      : quote.creditBack > 0
        ? `About ${money(quote.creditBack, quote.currency)} is credited back.`
        : "Nothing is charged now.";
  return `It goes from ${from} to ${to} a month before tax. ${now}`;
}

/**
 * Shows what will be ordered and its price, and asks. Returns the exit code
 * to stop with, or null to go ahead.
 */
export async function approveOrder(args: ParsedArgs, what: string, price: string, question: string): Promise<number | null> {
  return refusal(await confirm(args, `This orders ${what}.\n${price}`, question));
}

/**
 * The region to create in: the one given, checked against the catalogue, or
 * the only one there is. A choice between several is the caller's to make.
 */
export function pickRegion(given: string | undefined, regions: readonly string[], what: string): string {
  if (given !== undefined) {
    if (regions.length > 0 && !regions.includes(given)) {
      throw new UsageError(`${what} cannot be created in "${given}". Regions: ${regions.join(", ")}`);
    }
    return given;
  }
  if (regions.length === 1) return regions[0];
  if (regions.length === 0) throw new UsageError(`${what} cannot be created right now: no region is open`);
  throw new UsageError(`Pass --region. Regions: ${regions.join(", ")}`);
}

/** A slug checked against the catalogue, named in the usage error with the choices. */
export function pickSlug(given: string | undefined, slugs: readonly string[], flag: string, listCommand: string): string {
  if (given === undefined) throw new UsageError(`Pass --${flag}. ${listCommand} lists them`);
  if (slugs.length > 0 && !slugs.includes(given)) {
    throw new UsageError(`Unknown ${flag} "${given}". ${listCommand} lists them`);
  }
  return given;
}
