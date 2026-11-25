import { describe, expect, it } from "vitest";
import { ApiError } from "../../api/client";
import { describeFailedUpload } from "./conversation";

const shot = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });

describe("describeFailedUpload", () => {
  it("passes on the API's own reason", () => {
    const err = new ApiError("POST x failed: 400", 400, {
      message: "Content type image/bmp is not allowed",
    });
    expect(describeFailedUpload(shot, err)).toBe(
      "shot.png (Content type image/bmp is not allowed)",
    );
  });

  it("names a storage fault when the API gives no reason", () => {
    expect(describeFailedUpload(shot, new ApiError("x", 500, null))).toBe(
      "shot.png (server couldn't store it (500))",
    );
  });

  it("names a refused size", () => {
    expect(describeFailedUpload(shot, new ApiError("x", 413, null))).toBe(
      "shot.png (file is too large)",
    );
  });

  it("calls a fetch that never reached the API a network error", () => {
    expect(describeFailedUpload(shot, new TypeError("Failed to fetch"))).toBe(
      "shot.png (network error)",
    );
  });
});
