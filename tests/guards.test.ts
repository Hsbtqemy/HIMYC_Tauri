/**
 * Tests unitaires — guards.ts (MX-008)
 *
 * Couvre :
 * - guardNormalizeTranscript (absent, raw, normalized, segmented, ready)
 * - guardSegmentTranscript   (absent, raw, normalized, segmented)
 * - guardNormalizeSrt        (absent, raw, normalized)
 * - guardImportTranscript    (absent, présent → warning)
 * - guardImportSrt           (absent, présent → warning)
 * - guardBatchNormalize      (liste vide, aucun éligible, éligibles)
 * - guardAlignEpisode        (transcript seul, transcript+srt états divers, srt-only)
 * - guardedAction            (allowed, bloqué)
 */

import { describe, it, expect, vi } from "vitest";
import {
  guardNormalizeTranscript,
  guardSegmentTranscript,
  guardNormalizeSrt,
  guardImportTranscript,
  guardImportSrt,
  guardBatchNormalize,
  guardAlignEpisode,
  guardedAction,
  getAlignPreconditions,
  formatJobError,
} from "../src/guards";
import type { Episode, EpisodeSource } from "../src/api";

// ── Fixtures ──────────────────────────────────────────────────────────────

function mkSrc(
  source_key: string,
  state = "raw",
  available = true,
): EpisodeSource {
  return { source_key, available, state, has_clean: state !== "raw" };
}

function mkEp(sources: EpisodeSource[]): Episode {
  return { episode_id: "S01E01", season: 1, episode: 1, title: "Pilot", sources };
}

// ── guardNormalizeTranscript ───────────────────────────────────────────────

describe("guardNormalizeTranscript", () => {
  it("undefined → bloqué", () => {
    expect(guardNormalizeTranscript(undefined).allowed).toBe(false);
  });

  it("unavailable → bloqué", () => {
    expect(guardNormalizeTranscript(mkSrc("transcript", "raw", false)).allowed).toBe(false);
  });

  it("state=raw → autorisé", () => {
    expect(guardNormalizeTranscript(mkSrc("transcript", "raw")).allowed).toBe(true);
  });

  it("state=unknown → autorisé", () => {
    expect(guardNormalizeTranscript(mkSrc("transcript", "unknown")).allowed).toBe(true);
  });

  it("state=normalized → bloqué avec guidance", () => {
    const r = guardNormalizeTranscript(mkSrc("transcript", "normalized"));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/segmentation/i);
  });

  it("state=segmented → bloqué", () => {
    expect(guardNormalizeTranscript(mkSrc("transcript", "segmented")).allowed).toBe(false);
  });

  it("state=ready_for_alignment → bloqué", () => {
    expect(guardNormalizeTranscript(mkSrc("transcript", "ready_for_alignment")).allowed).toBe(false);
  });
});

// ── guardSegmentTranscript ─────────────────────────────────────────────────

describe("guardSegmentTranscript", () => {
  it("undefined → bloqué", () => {
    expect(guardSegmentTranscript(undefined).allowed).toBe(false);
  });

  it("unavailable → bloqué", () => {
    expect(guardSegmentTranscript(mkSrc("transcript", "normalized", false)).allowed).toBe(false);
  });

  it("state=raw → bloqué avec guidance normaliser", () => {
    const r = guardSegmentTranscript(mkSrc("transcript", "raw"));
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/normalis/i);
  });

  it("state=unknown → bloqué", () => {
    expect(guardSegmentTranscript(mkSrc("transcript", "unknown")).allowed).toBe(false);
  });

  it("state=normalized → autorisé", () => {
    expect(guardSegmentTranscript(mkSrc("transcript", "normalized")).allowed).toBe(true);
  });

  it("state=segmented → bloqué", () => {
    expect(guardSegmentTranscript(mkSrc("transcript", "segmented")).allowed).toBe(false);
  });

  it("state=ready_for_alignment → bloqué", () => {
    expect(guardSegmentTranscript(mkSrc("transcript", "ready_for_alignment")).allowed).toBe(false);
  });
});

// ── guardNormalizeSrt ──────────────────────────────────────────────────────

describe("guardNormalizeSrt", () => {
  it("undefined → bloqué", () => {
    expect(guardNormalizeSrt(undefined).allowed).toBe(false);
  });

  it("unavailable → bloqué", () => {
    expect(guardNormalizeSrt(mkSrc("srt_en", "raw", false)).allowed).toBe(false);
  });

  it("state=raw → autorisé", () => {
    expect(guardNormalizeSrt(mkSrc("srt_en", "raw")).allowed).toBe(true);
  });

  it("state=normalized → bloqué", () => {
    expect(guardNormalizeSrt(mkSrc("srt_en", "normalized")).allowed).toBe(false);
  });
});

// ── guardImportTranscript ──────────────────────────────────────────────────

describe("guardImportTranscript", () => {
  it("undefined → autorisé sans warning", () => {
    const r = guardImportTranscript(undefined);
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("unavailable → autorisé sans warning", () => {
    const r = guardImportTranscript(mkSrc("transcript", "raw", false));
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("available → autorisé avec warning écrasement", () => {
    const r = guardImportTranscript(mkSrc("transcript", "raw", true));
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/écras/i);
  });
});

// ── guardImportSrt ─────────────────────────────────────────────────────────

describe("guardImportSrt", () => {
  it("lang absent → autorisé sans warning", () => {
    const ep = mkEp([mkSrc("transcript")]);
    const r = guardImportSrt(ep, "en");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("srt_en présent → autorisé avec warning", () => {
    const ep = mkEp([mkSrc("srt_en")]);
    const r = guardImportSrt(ep, "en");
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/écras/i);
  });

  it("srt_en unavailable → autorisé sans warning", () => {
    const ep = mkEp([mkSrc("srt_en", "raw", false)]);
    const r = guardImportSrt(ep, "en");
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});

// ── guardBatchNormalize ────────────────────────────────────────────────────

describe("guardBatchNormalize", () => {
  it("liste vide → bloqué", () => {
    expect(guardBatchNormalize([]).allowed).toBe(false);
  });

  it("aucun transcript disponible → bloqué", () => {
    const ep = mkEp([mkSrc("transcript", "raw", false)]);
    expect(guardBatchNormalize([ep]).allowed).toBe(false);
  });

  it("tous déjà normalisés → bloqué", () => {
    const ep = mkEp([mkSrc("transcript", "normalized")]);
    expect(guardBatchNormalize([ep]).allowed).toBe(false);
  });

  it("au moins un raw → autorisé avec count", () => {
    const ep1 = mkEp([mkSrc("transcript", "raw")]);
    const ep2 = mkEp([mkSrc("transcript", "normalized")]);
    const r = guardBatchNormalize([ep1, ep2]);
    expect(r.allowed).toBe(true);
    expect(r.reason).toMatch(/1/);
  });
});

// ── guardAlignEpisode ──────────────────────────────────────────────────────

describe("guardAlignEpisode — transcript+srt", () => {
  it("transcript raw → bloqué (normaliser d'abord)", () => {
    const ep = mkEp([mkSrc("transcript", "raw"), mkSrc("srt_en")]);
    const r = guardAlignEpisode(ep);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/normalis/i);
  });

  it("transcript normalized → bloqué (segmenter d'abord)", () => {
    const ep = mkEp([mkSrc("transcript", "normalized"), mkSrc("srt_en")]);
    const r = guardAlignEpisode(ep);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/segment/i);
  });

  it("transcript segmented + srt → autorisé", () => {
    const ep = mkEp([mkSrc("transcript", "segmented"), mkSrc("srt_en")]);
    expect(guardAlignEpisode(ep).allowed).toBe(true);
  });

  it("transcript segmented, aucun SRT → bloqué", () => {
    const ep = mkEp([mkSrc("transcript", "segmented")]);
    const r = guardAlignEpisode(ep);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/srt/i);
  });
});

describe("guardAlignEpisode — srt-only", () => {
  it("1 seul SRT → bloqué (besoin 2+)", () => {
    const ep = mkEp([mkSrc("srt_en")]);
    const r = guardAlignEpisode(ep);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/2 pistes/i);
  });

  it("2 SRT disponibles → autorisé", () => {
    const ep = mkEp([mkSrc("srt_en"), mkSrc("srt_fr")]);
    expect(guardAlignEpisode(ep).allowed).toBe(true);
  });
});

// ── guardedAction ──────────────────────────────────────────────────────────

describe("guardedAction", () => {
  it("allowed=true → exécute fn()", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const onBlocked = vi.fn();
    const result = await guardedAction({ allowed: true }, fn, onBlocked);
    expect(fn).toHaveBeenCalledOnce();
    expect(onBlocked).not.toHaveBeenCalled();
    expect(result).toBe("ok");
  });

  it("allowed=false → appelle onBlocked, ne pas exécuter fn()", async () => {
    const fn = vi.fn();
    const onBlocked = vi.fn();
    const result = await guardedAction(
      { allowed: false, reason: "bloqué pour test" },
      fn,
      onBlocked,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalledWith("bloqué pour test");
    expect(result).toBeUndefined();
  });

  it("allowed=false sans reason → message par défaut", async () => {
    const onBlocked = vi.fn();
    await guardedAction({ allowed: false }, vi.fn(), onBlocked);
    expect(onBlocked).toHaveBeenCalledWith(expect.stringContaining("autorisée"));
  });
});

// ── getAlignPreconditions ─────────────────────────────────────────────────

describe("getAlignPreconditions — transcript-first", () => {
  it("transcript raw → transcript_available=true, normalized=false, segmented=false", () => {
    const ep = mkEp([mkSrc("transcript", "raw"), mkSrc("srt_en")]);
    const precs = getAlignPreconditions(ep);
    expect(precs).toHaveLength(4);
    expect(precs.find((p) => p.id === "transcript_available")?.met).toBe(true);
    expect(precs.find((p) => p.id === "transcript_normalized")?.met).toBe(false);
    expect(precs.find((p) => p.id === "transcript_segmented")?.met).toBe(false);
    expect(precs.find((p) => p.id === "srt_available")?.met).toBe(true);
  });

  it("transcript normalized → normalized=true, segmented=false avec hint segmenter", () => {
    const ep = mkEp([mkSrc("transcript", "normalized"), mkSrc("srt_en")]);
    const precs = getAlignPreconditions(ep);
    const seg = precs.find((p) => p.id === "transcript_segmented")!;
    expect(seg.met).toBe(false);
    expect(seg.hint).toMatch(/segment/i);
    expect(seg.hint).not.toMatch(/normalis/i); // pas besoin de normaliser
  });

  it("transcript raw → segmented hint mentionne normaliser ET segmenter", () => {
    const ep = mkEp([mkSrc("transcript", "raw"), mkSrc("srt_en")]);
    const precs = getAlignPreconditions(ep);
    const seg = precs.find((p) => p.id === "transcript_segmented")!;
    expect(seg.hint).toMatch(/normalis/i);
    expect(seg.hint).toMatch(/segment/i);
  });

  it("transcript segmented, aucun SRT → srt_available=false avec hint", () => {
    const ep = mkEp([mkSrc("transcript", "segmented")]);
    const precs = getAlignPreconditions(ep);
    const srt = precs.find((p) => p.id === "srt_available")!;
    expect(srt.met).toBe(false);
    expect(srt.hint).toMatch(/srt/i);
  });

  it("all met → tous met=true, aucun hint", () => {
    const ep = mkEp([mkSrc("transcript", "segmented"), mkSrc("srt_en")]);
    const precs = getAlignPreconditions(ep);
    expect(precs.every((p) => p.met)).toBe(true);
    expect(precs.every((p) => p.hint === undefined)).toBe(true);
  });
});

describe("getAlignPreconditions — srt-only", () => {
  it("1 SRT → 1 précondition, met=false avec hint", () => {
    const ep = mkEp([mkSrc("srt_en")]);
    const precs = getAlignPreconditions(ep);
    expect(precs).toHaveLength(1);
    expect(precs[0].id).toBe("srt_count");
    expect(precs[0].met).toBe(false);
    expect(precs[0].hint).toMatch(/2 pistes/i);
  });

  it("2 SRT → met=true, pas de hint", () => {
    const ep = mkEp([mkSrc("srt_en"), mkSrc("srt_fr")]);
    const precs = getAlignPreconditions(ep);
    expect(precs).toHaveLength(1);
    expect(precs[0].met).toBe(true);
    expect(precs[0].hint).toBeUndefined();
  });
});

// ── formatJobError ────────────────────────────────────────────────────────

describe("formatJobError", () => {
  it("null → message générique logs", () => {
    expect(formatJobError(null)).toMatch(/logs/i);
  });

  it("undefined → message générique logs", () => {
    expect(formatJobError(undefined)).toMatch(/logs/i);
  });

  it("'RAW introuvable' → message importez transcript", () => {
    expect(formatJobError("RAW introuvable")).toMatch(/transcript/i);
  });

  it("'No raw text' → message importez transcript", () => {
    expect(formatJobError("No raw text found")).toMatch(/transcript/i);
  });

  it("'normalisé introuvable' → message normalisez", () => {
    expect(formatJobError("normalisé introuvable")).toMatch(/normalis/i);
  });

  it("'has_episode_clean' → message normalisez", () => {
    expect(formatJobError("has_episode_clean failed")).toMatch(/normalis/i);
  });

  it("'SRT introuvable' → message importez SRT", () => {
    expect(formatJobError("SRT introuvable pour cet épisode")).toMatch(/srt/i);
  });

  it("'No segments' → message segmentez", () => {
    expect(formatJobError("No segments found")).toMatch(/segment/i);
  });

  it("'Cancelled' → 'Job annulé'", () => {
    expect(formatJobError("Cancelled")).toBe("Job annulé.");
  });

  it("'Profile not found' → message profil", () => {
    expect(formatJobError("Profile not found: normalize_profile")).toMatch(/profil/i);
  });

  it("message clair sans traceback → retourné tel quel", () => {
    const msg = "Aucune correspondance trouvée.";
    expect(formatJobError(msg)).toBe(msg);
  });

  it("traceback Python → message générique interne", () => {
    const tb = "Traceback (most recent call last):\n  File \"foo.py\", line 42, in bar\nValueError: oops";
    expect(formatJobError(tb)).toMatch(/interne/i);
  });
});
