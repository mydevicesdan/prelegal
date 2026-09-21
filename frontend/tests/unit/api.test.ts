import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, UNAUTHORIZED_EVENT, api } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

const respond = (body: unknown, status = 200) =>
  vi.fn().mockResolvedValue(new Response(body === null ? null : JSON.stringify(body), { status }));

describe("api", () => {
  it("gets JSON by default, without a body or content type", async () => {
    const fetchMock = respond({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    expect(await api("/api/x")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", { method: "GET", headers: undefined, body: undefined });
  });

  it("sends a JSON body with the right content type", async () => {
    const fetchMock = respond({ id: 1 }, 201);
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/x", { method: "POST", body: { a: 1 } });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"a":1}',
    });
  });

  it("sends a body that is falsy but present", async () => {
    const fetchMock = respond({});
    vi.stubGlobal("fetch", fetchMock);
    await api("/api/x", { method: "POST", body: 0 });
    expect(fetchMock.mock.calls[0]![1].body).toBe("0");
  });

  it("resolves to undefined when there is no content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await api("/api/x", { method: "DELETE" })).toBeUndefined();
  });

  it("rejects with the server's own message and status", async () => {
    vi.stubGlobal("fetch", respond({ detail: "Incorrect email or password." }, 401));
    const error = await api("/api/x").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: "Incorrect email or password." });
  });

  it("gives a plain message for validation errors, whose detail is a list", async () => {
    vi.stubGlobal("fetch", respond({ detail: [{ msg: "bad" }] }, 422));
    await expect(api("/api/x")).rejects.toThrow("Please check the details and try again.");
  });

  it("gives a generic message when the error has no usable body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>oops</html>", { status: 500 })));
    await expect(api("/api/x")).rejects.toMatchObject({ status: 500, message: "Something went wrong. Please try again." });
  });

  it("reports an unreachable server with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(api("/api/x")).rejects.toMatchObject({ status: 0, message: expect.stringContaining("Could not reach the server") });
  });

  it("announces a 401 so the app can send the user to sign in", async () => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    vi.stubGlobal("fetch", respond({ detail: "Please sign in." }, 401));
    await api("/api/x").catch(() => undefined);
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
    expect(heard).toHaveBeenCalledOnce();
  });

  it.each([400, 403, 404, 409, 429, 500])("does not announce a %i", async (status) => {
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    vi.stubGlobal("fetch", respond({ detail: "no" }, status));
    await api("/api/x").catch(() => undefined);
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
    expect(heard).not.toHaveBeenCalled();
  });
});
