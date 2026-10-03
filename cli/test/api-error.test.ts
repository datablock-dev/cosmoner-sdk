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
});
