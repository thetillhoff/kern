import { expect, test } from "bun:test";
import { currentModelId } from "./decision.ts";

test("prefers the live model id over the configured default", () => {
  expect(currentModelId({ id: "haiku" }, "sonnet")).toBe("haiku");
});

test("falls back to the configured default when no live model", () => {
  expect(currentModelId(undefined, "sonnet")).toBe("sonnet");
});

test("returns 'unknown' when nothing is available", () => {
  expect(currentModelId(undefined, null)).toBe("unknown");
});
