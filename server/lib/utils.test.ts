import { describe, expect, it, vi } from "vitest";
import { handleError } from "./utils.js";
import { RequestError } from "./request-error.js";

const response = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe("handleError", () => {
  it("answers a RequestError with its own status and message", () => {
    const res = response();
    handleError(res, new RequestError(404, "Project not found"), "Failed to create note");
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Project not found" });
  });

  it("keeps hiding the details of any other error behind 500", () => {
    const res = response();
    handleError(res, new Error("connection refused at 10.0.0.5"), "Failed to create note");
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Failed to create note" });
  });
});
