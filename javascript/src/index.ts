/** Public entry point for the Cosmoner SDK. */

export { Cosmoner } from "./client";
export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  type CosmonerConfig,
} from "./config";
export {
  AuthenticationError,
  ConflictError,
  CosmonerConnectionError,
  CosmonerError,
  CosmonerTimeoutError,
  InsufficientScopeError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from "./errors";
export {
  EmailService,
  type SendEmailParams,
  type SendEmailResponse,
} from "./services/email";
export { VERSION } from "./version";

import { Cosmoner } from "./client";

export default Cosmoner;
