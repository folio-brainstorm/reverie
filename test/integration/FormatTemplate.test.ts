import { describe, expect, it } from "vitest";

import { formatTemplate } from "../../core/src/utils/string/FormatTemplate";

describe("formatTemplate", () => {
  it("replaces every named placeholder", () => {
    expect(formatTemplate(
      "x = $x, y = $y, label = $label",
      { x: 10, y: 20, label: "origin" },
    )).toBe("x = 10, y = 20, label = origin");
  });

  it("replaces repeated placeholders", () => {
    expect(formatTemplate("$value + $value", { value: 2 })).toBe("2 + 2");
  });

  it("ignores dollar signs that do not begin a valid placeholder", () => {
    expect(formatTemplate("cost: $10", {})).toBe("cost: $10");
  });

  if (false) {
    // @ts-expect-error `last` is required because `$last` occurs in the template.
    formatTemplate("Hello $first $last", { first: "Ada" });

    // @ts-expect-error Object literals may only contain keys found in the template.
    formatTemplate("Hello $name", { name: "Ada", age: 36 });
  }
});
