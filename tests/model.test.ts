/**
 * Tests unitaires — model.ts (MX-004)
 *
 * Couvre :
 * - docId / parseDocId
 * - resolveLanguage
 * - resolveDocRole (cas 1: transcript+srt, cas 2: srt-only, cas 3: transcript seul)
 * - episodeSourceToDoc
 * - deriveDocRelations (cas 1/2/3)
 * - episodesToDocs (filtre available)
 * - isValidSourceKey
 * - resolveSrtPivot
 */

import { describe, it, expect } from "vitest";
import {
  docId,
  parseDocId,
  resolveLanguage,
  resolveDocRole,
  episodeSourceToDoc,
  deriveDocRelations,
  episodesToDocs,
  isValidSourceKey,
  resolveSrtPivot,
} from "../src/model";
import type { Episode, EpisodeSource, EpisodesResponse } from "../src/api";

// ── Fixtures ──────────────────────────────────────────────────────────────

function mkSource(
  source_key: string,
  available = true,
  overrides: Partial<EpisodeSource> = {},
): EpisodeSource {
  return {
    source_key,
    available,
    state: "raw",
    language: source_key.startsWith("srt_") ? source_key.slice(4) : undefined,
    ...overrides,
  };
}

function mkEpisode(
  episode_id: string,
  sources: EpisodeSource[],
  overrides: Partial<Episode> = {},
): Episode {
  return {
    episode_id,
    season: 1,
    episode: 1,
    title: "Pilot",
    sources,
    ...overrides,
  };
}

// ── docId / parseDocId ─────────────────────────────────────────────────────

describe("docId", () => {
  it("construit le composite episode:source", () => {
    expect(docId("S01E01", "transcript")).toBe("S01E01:transcript");
    expect(docId("S01E01", "srt_en")).toBe("S01E01:srt_en");
  });
});

describe("parseDocId", () => {
  it("décode un doc_id valide", () => {
    expect(parseDocId("S01E01:transcript")).toEqual({
      episodeKey: "S01E01",
      sourceKey: "transcript",
    });
    expect(parseDocId("S02E10:srt_fr")).toEqual({
      episodeKey: "S02E10",
      sourceKey: "srt_fr",
    });
  });

  it("retourne null sur format invalide", () => {
    expect(parseDocId("nocolon")).toBeNull();
    expect(parseDocId(":source")).toBeNull();
    expect(parseDocId("episode:")).toBeNull();
  });
});

// ── resolveLanguage ────────────────────────────────────────────────────────

describe("resolveLanguage", () => {
  it("utilise le champ language si présent", () => {
    expect(resolveLanguage(mkSource("srt_en", true, { language: "en" }))).toBe("en");
  });

  it("dérive la langue depuis srt_<lang>", () => {
    const src = mkSource("srt_fr");
    delete src.language;
    expect(resolveLanguage(src)).toBe("fr");
  });

  it("retourne chaîne vide pour transcript sans language", () => {
    const src = mkSource("transcript");
    delete src.language;
    expect(resolveLanguage(src)).toBe("");
  });
});

// ── resolveDocRole ─────────────────────────────────────────────────────────

describe("resolveDocRole — cas 1 : transcript + srt", () => {
  const sources = [
    mkSource("transcript"),
    mkSource("srt_en"),
    mkSource("srt_fr"),
  ];

  it("transcript → original", () => {
    expect(resolveDocRole(sources[0], sources)).toBe("original");
  });

  it("srt_en → translation (transcript présent)", () => {
    expect(resolveDocRole(sources[1], sources)).toBe("translation");
  });

  it("srt_fr → translation (transcript présent)", () => {
    expect(resolveDocRole(sources[2], sources)).toBe("translation");
  });
});

describe("resolveDocRole — cas 2 : srt-only", () => {
  const sources = [mkSource("srt_en"), mkSource("srt_fr")];

  it("premier SRT disponible → standalone (pivot)", () => {
    expect(resolveDocRole(sources[0], sources)).toBe("standalone");
  });

  it("second SRT → translation", () => {
    expect(resolveDocRole(sources[1], sources)).toBe("translation");
  });
});

describe("resolveDocRole — cas 3 : transcript seul", () => {
  const sources = [mkSource("transcript")];

  it("transcript seul → original", () => {
    expect(resolveDocRole(sources[0], sources)).toBe("original");
  });
});

describe("resolveDocRole — transcript unavailable ne compte pas", () => {
  it("transcript available=false → SRT traité comme srt-only pivot", () => {
    const sources = [
      mkSource("transcript", false), // absent
      mkSource("srt_en"),
      mkSource("srt_fr"),
    ];
    expect(resolveDocRole(sources[1], sources)).toBe("standalone");
    expect(resolveDocRole(sources[2], sources)).toBe("translation");
  });
});

// ── episodeSourceToDoc ─────────────────────────────────────────────────────

describe("episodeSourceToDoc", () => {
  it("projette transcript en HimycDoc original", () => {
    const ep = mkEpisode("S01E01", [mkSource("transcript"), mkSource("srt_en")]);
    const doc = episodeSourceToDoc(ep, ep.sources[0]);

    expect(doc.doc_id).toBe("S01E01:transcript");
    expect(doc.episode_key).toBe("S01E01");
    expect(doc.source_key).toBe("transcript");
    expect(doc.doc_role).toBe("original");
    expect(doc.state).toBe("raw");
  });

  it("projette srt_en en HimycDoc translation", () => {
    const ep = mkEpisode("S01E01", [mkSource("transcript"), mkSource("srt_en")]);
    const doc = episodeSourceToDoc(ep, ep.sources[1]);

    expect(doc.doc_id).toBe("S01E01:srt_en");
    expect(doc.doc_role).toBe("translation");
    expect(doc.language).toBe("en");
  });

  it("respecte le champ state de la source", () => {
    const src = mkSource("transcript", true, { state: "segmented" });
    const ep = mkEpisode("S01E01", [src]);
    const doc = episodeSourceToDoc(ep, src);
    expect(doc.state).toBe("segmented");
  });

  it("transmet nb_cues et format", () => {
    const src = mkSource("srt_en", true, { nb_cues: 42, format: "srt" });
    const ep = mkEpisode("S01E01", [src]);
    const doc = episodeSourceToDoc(ep, src);
    expect(doc.nb_cues).toBe(42);
    expect(doc.format).toBe("srt");
  });
});

// ── deriveDocRelations ─────────────────────────────────────────────────────

describe("deriveDocRelations — cas 1 : transcript + srt", () => {
  it("génère une relation translation_of par SRT", () => {
    const ep = mkEpisode("S01E01", [
      mkSource("transcript"),
      mkSource("srt_en"),
      mkSource("srt_fr"),
    ]);
    const relations = deriveDocRelations(ep);

    expect(relations).toHaveLength(2);
    expect(relations[0]).toEqual({
      doc_id: "S01E01:srt_en",
      relation_type: "translation_of",
      target_doc_id: "S01E01:transcript",
    });
    expect(relations[1]).toEqual({
      doc_id: "S01E01:srt_fr",
      relation_type: "translation_of",
      target_doc_id: "S01E01:transcript",
    });
  });

  it("ignore les SRT unavailable", () => {
    const ep = mkEpisode("S01E01", [
      mkSource("transcript"),
      mkSource("srt_en"),
      mkSource("srt_fr", false), // absent
    ]);
    const relations = deriveDocRelations(ep);
    expect(relations).toHaveLength(1);
    expect(relations[0].doc_id).toBe("S01E01:srt_en");
  });
});

describe("deriveDocRelations — cas 2 : srt-only", () => {
  it("srt_en pivot + srt_fr translation", () => {
    const ep = mkEpisode("S01E01", [mkSource("srt_en"), mkSource("srt_fr")]);
    const relations = deriveDocRelations(ep);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toEqual({
      doc_id: "S01E01:srt_fr",
      relation_type: "translation_of",
      target_doc_id: "S01E01:srt_en",
    });
  });

  it("SRT unique → 0 relation", () => {
    const ep = mkEpisode("S01E01", [mkSource("srt_en")]);
    expect(deriveDocRelations(ep)).toHaveLength(0);
  });
});

describe("deriveDocRelations — cas 3 : transcript seul", () => {
  it("0 relation", () => {
    const ep = mkEpisode("S01E01", [mkSource("transcript")]);
    expect(deriveDocRelations(ep)).toHaveLength(0);
  });
});

// ── episodesToDocs ─────────────────────────────────────────────────────────

describe("episodesToDocs", () => {
  it("ne retourne que les sources available=true", () => {
    const response: EpisodesResponse = {
      series_title: "Test",
      episodes: [
        mkEpisode("S01E01", [
          mkSource("transcript"),
          mkSource("srt_en", false), // absent
          mkSource("srt_fr"),
        ]),
      ],
    };
    const docs = episodesToDocs(response);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.source_key)).toEqual(["transcript", "srt_fr"]);
  });

  it("retourne [] sur liste d'épisodes vide", () => {
    const response: EpisodesResponse = { series_title: null, episodes: [] };
    expect(episodesToDocs(response)).toHaveLength(0);
  });

  it("parcourt plusieurs épisodes", () => {
    const response: EpisodesResponse = {
      series_title: "Test",
      episodes: [
        mkEpisode("S01E01", [mkSource("transcript")]),
        mkEpisode("S01E02", [mkSource("transcript"), mkSource("srt_en")]),
      ],
    };
    const docs = episodesToDocs(response);
    expect(docs).toHaveLength(3);
  });
});

// ── isValidSourceKey ───────────────────────────────────────────────────────

describe("isValidSourceKey", () => {
  it("accepte les clés canoniques", () => {
    expect(isValidSourceKey("transcript")).toBe(true);
    expect(isValidSourceKey("srt_en")).toBe(true);
    expect(isValidSourceKey("srt_fr")).toBe(true);
    expect(isValidSourceKey("srt_zh")).toBe(true);
    expect(isValidSourceKey("srt_ptbr")).toBe(true);
  });

  it("refuse les clés invalides", () => {
    expect(isValidSourceKey("invalid_key")).toBe(false);
    expect(isValidSourceKey("srt_")).toBe(false);
    expect(isValidSourceKey("srt_UPPER")).toBe(false);
    expect(isValidSourceKey("SRT_en")).toBe(false);
    expect(isValidSourceKey("")).toBe(false);
    expect(isValidSourceKey("srt_toolongkey")).toBe(false);
  });
});

// ── resolveSrtPivot ────────────────────────────────────────────────────────

describe("resolveSrtPivot", () => {
  it("retourne null si transcript présent (pas srt-only)", () => {
    const ep = mkEpisode("S01E01", [mkSource("transcript"), mkSource("srt_en")]);
    expect(resolveSrtPivot(ep)).toBeNull();
  });

  it("retourne la première langue SRT disponible", () => {
    const ep = mkEpisode("S01E01", [mkSource("srt_en"), mkSource("srt_fr")]);
    expect(resolveSrtPivot(ep)).toBe("srt_en");
  });

  it("retourne null si aucune source SRT disponible", () => {
    const ep = mkEpisode("S01E01", [mkSource("srt_en", false)]);
    expect(resolveSrtPivot(ep)).toBeNull();
  });
});
