/** What the API quotes before a paid resource is ordered or resized. */

/**
 * The price of a new resource. Amounts are integers in the currency's minor
 * units (cents for USD).
 *
 * `monthly` is exact. `dueToday` is exact for a project's first paid
 * resource; for a project that already has a subscription it is an estimate,
 * because the real charge is prorated onto that subscription.
 */
export interface CheckoutPreview {
  subtotal: number;
  /** Null when the tax location could not be resolved. */
  tax: number | null;
  creditApplied: number;
  dueToday: number;
  /** The recurring monthly price, before tax. */
  monthly: number;
  /** Upper-case ISO code, e.g. `USD`. */
  currency: string;
  /** When the next invoice is drawn, as an ISO timestamp. */
  nextBillingDate: string;
}

/** The price of moving an existing resource to another plan or size. */
export interface PlanChangePreview extends CheckoutPreview {
  direction: "upgrade" | "downgrade";
  /** Credit returned for the unused time on the current plan. */
  creditBack: number;
  currentMonthly: number;
}
