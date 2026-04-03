import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { ApiError, apiPost, withNoDbRecovery } from "../src/api";

interface FetchResult {
  status: number;
  ok: boolean;
  body: string;
}

function okJson(body: unknown): FetchResult {
  return { status: 200, ok: true, body: JSON.stringify(body) };
}

function errJson(status: number, error: string, message: string): FetchResult {
  return {
    status,
    ok: false,
    body: JSON.stringify({ detail: { error, message } }),
  };
}

describe("withNoDbRecovery", () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("retourne le résultat directement quand fn réussit", async () => {
    const fn = vi.fn(async () => "ok");
    const out = await withNoDbRecovery(fn);
    expect(out).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("réessaie une fois après NO_DB et init_corpus_db réussi", async () => {
    invokeMock
      .mockResolvedValueOnce(errJson(503, "NO_DB", "corpus.db introuvable"))
      .mockResolvedValueOnce(okJson({ created: true, path: "/tmp/corpus.db" }))
      .mockResolvedValueOnce(okJson({ done: true }));

    const out = await withNoDbRecovery(() => apiPost<{ done: boolean }>("/query", { term: "hello" }));
    expect(out).toEqual({ done: true });

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST", url: expect.stringContaining("/query") });
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      url: expect.stringContaining("/project/init_corpus_db"),
    });
    expect(invokeMock.mock.calls[2]?.[1]).toMatchObject({ method: "POST", url: expect.stringContaining("/query") });
  });

  it("relance l'erreur NO_DB originale si init_corpus_db échoue", async () => {
    invokeMock
      .mockResolvedValueOnce(errJson(503, "NO_DB", "corpus.db introuvable"))
      .mockResolvedValueOnce(errJson(500, "INIT_FAIL", "boom"));

    await expect(
      withNoDbRecovery(() => apiPost<{ done: boolean }>("/query", { term: "hello" })),
    ).rejects.toMatchObject<ApiError>({
      errorCode: "NO_DB",
      message: "corpus.db introuvable",
    });

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({
      url: expect.stringContaining("/project/init_corpus_db"),
    });
  });

  it("ne tente pas init_corpus_db pour une erreur non NO_DB", async () => {
    invokeMock.mockResolvedValueOnce(errJson(400, "INVALID_SCOPE", "scope invalide"));

    await expect(
      withNoDbRecovery(() => apiPost<{ done: boolean }>("/query", { term: "hello" })),
    ).rejects.toMatchObject<ApiError>({
      errorCode: "INVALID_SCOPE",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]?.[1]).toMatchObject({ url: expect.stringContaining("/query") });
  });

  it("propage l'erreur du retry après une init réussie", async () => {
    invokeMock
      .mockResolvedValueOnce(errJson(503, "NO_DB", "corpus.db introuvable"))
      .mockResolvedValueOnce(okJson({ created: true, path: "/tmp/corpus.db" }))
      .mockResolvedValueOnce(errJson(422, "EMPTY_TERM", "Le terme est vide."));

    await expect(
      withNoDbRecovery(() => apiPost<{ done: boolean }>("/query", { term: "   " })),
    ).rejects.toMatchObject<ApiError>({
      errorCode: "EMPTY_TERM",
      message: "Le terme est vide.",
    });

    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({
      url: expect.stringContaining("/project/init_corpus_db"),
    });
  });
});
