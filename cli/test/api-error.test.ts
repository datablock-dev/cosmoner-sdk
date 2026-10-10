import { describe, expect, it } from "vitest";

import { CosmonerError } from "@cosmoner/sdk";

import { describeApiError } from "../src/api-error";

describe("describeApiError", () => {
  it("is the message and code alone when the API sent no docs link", () => {
    const err = new CosmonerError(404, "NOT_FOUND", "App not found");

    expect(describeApiError(err)).toBe("App not found (NOT_FOUND)");
  });

  it("adds the docs link on a line of its own", () => {
    const err = new CosmonerError(422, "VALIDATION_ERROR", "Invalid input", {
      docsUrl: "https://cosmoner.com/docs#validation_error",
    });

    expect(describeApiError(err)).toBe(
      "Invalid input (VALIDATION_ERROR)\nSee https://cosmoner.com/docs#validation_error"
    );
  });

  // A project key acts as a service account; the API refuses the few actions
  // that need a person, and the CLI says which credential to switch to.
  it("says how to switch credential when a project key's service account is refused", () => {
    const err = new CosmonerError(403, "SERVICE_ACCOUNT_NOT_ALLOWED", "Support tickets need a person to reply to.");

    expect(describeApiError(err)).toBe(
      "Support tickets need a person to reply to. (SERVICE_ACCOUNT_NOT_ALLOWED)\n" +
        "This needs a person, not a project API key: unset COSMONER_API_KEY and run cosmoner login, or set it to a personal access token."
    );
  });

  it("puts the hint before the docs link", () => {
    const err = new CosmonerError(403, "SERVICE_ACCOUNT_NOT_ALLOWED", "Needs a person.", {
      docsUrl: "https://cosmoner.com/docs#service_account_not_allowed",
    });

    expect(describeApiError(err).split("\n")).toEqual([
      "Needs a person. (SERVICE_ACCOUNT_NOT_ALLOWED)",
      expect.stringContaining("cosmoner login"),
      "See https://cosmoner.com/docs#service_account_not_allowed",
    ]);
  });
});
