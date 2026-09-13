import { describe, expect, it } from "vitest";

import {
  createReverieErrorBase,
  ReverieError,
} from "@reverie/core";
import type {
  CodedError,
  ErrorCodeCatalog,
  ErrorDefinition,
  NativeErrorConstructor,
  ReverieErrorBaseConstructor,
  ReverieErrorConstructor,
  TemplateArguments,
} from "@reverie/core";

const CUSTOM_ERROR_DEFINITION = {
  code: "EC_EXTENSION_0001",
  template: "Extension `$name` failed.",
} as const satisfies ErrorDefinition<
  "EC_EXTENSION_0001",
  "Extension `$name` failed."
>;

type CustomErrorCode = typeof CUSTOM_ERROR_DEFINITION.code;

const NativeCustomError: NativeErrorConstructor<TypeError> = TypeError;
const CustomErrorBase: ReverieErrorBaseConstructor<CustomErrorCode> =
  createReverieErrorBase<CustomErrorCode>(NativeCustomError, "CustomError");

class CustomError extends CustomErrorBase {}

describe("public Reverie error API", () => {
  it("exports the general ReverieError class from the core entry point", () => {
    const error = new ReverieError("EC_TILE_0002", "Duplicate tile.");

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ReverieError);
    expect(error).toMatchObject({
      code: "EC_TILE_0002",
      message: "[EC_TILE_0002] Duplicate tile.",
      name: "ReverieError",
    });
  });

  it("lets another package build a native coded error from a definition", () => {
    const templateArguments: TemplateArguments<
      typeof CUSTOM_ERROR_DEFINITION.template
    > = [{ name: "renderer" }];
    const constructor: ReverieErrorConstructor<CustomErrorCode, CustomError> =
      CustomError;
    const directlyConstructed = new constructor(
      "EC_EXTENSION_0001",
      "Direct construction.",
    );
    const error: CodedError<CustomErrorCode> = CustomError.from(
      CUSTOM_ERROR_DEFINITION,
      ...templateArguments,
    );

    expect(directlyConstructed).toBeInstanceOf(CustomError);
    expect(error).toBeInstanceOf(CustomError);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toMatchObject({
      code: "EC_EXTENSION_0001",
      message: "[EC_EXTENSION_0001] Extension `renderer` failed.",
      name: "CustomError",
    });
  });

  it("publishes the catalog helper type for package-owned definitions", () => {
    type CustomCatalog = ErrorCodeCatalog<{
      readonly EXTENSION: {
        readonly FAILED: typeof CUSTOM_ERROR_DEFINITION;
      };
    }>;
    const codes: CustomCatalog = {
      EXTENSION: { FAILED: "EC_EXTENSION_0001" },
    };

    expect(codes.EXTENSION.FAILED).toBe("EC_EXTENSION_0001");
  });
});
