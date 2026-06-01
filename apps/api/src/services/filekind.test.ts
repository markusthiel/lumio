import { describe, it, expect } from "vitest";
import { detectFileKind } from "./filekind.js";

/**
 * Tests fürs Kind-Detection. Wir prüfen die vier Klassen + den HEIC-Sonderfall,
 * und vor allem die Reihenfolge der Heuristiken: Extension schlägt MIME, weil
 * Browser-MIME-Types unzuverlässig sind (insbesondere bei RAW und HEIC).
 */
describe("detectFileKind", () => {
  describe("by extension", () => {
    it("classifies common JPEG/PNG as image", () => {
      expect(detectFileKind("photo.jpg")).toBe("image");
      expect(detectFileKind("photo.jpeg")).toBe("image");
      expect(detectFileKind("photo.PNG")).toBe("image"); // case-insensitive
      expect(detectFileKind("photo.webp")).toBe("image");
    });

    it("classifies HEIC family separately from image", () => {
      expect(detectFileKind("IMG_0001.heic")).toBe("heic");
      expect(detectFileKind("IMG_0001.HEIC")).toBe("heic");
      expect(detectFileKind("frame.heif")).toBe("heic");
      // Live-Photo + Sequence-Container
      expect(detectFileKind("burst.heics")).toBe("heic");
      expect(detectFileKind("burst.heifs")).toBe("heic");
    });

    it("classifies RAW formats correctly across vendors", () => {
      expect(detectFileKind("IMG_1234.CR2")).toBe("raw");
      expect(detectFileKind("DSC_5678.NEF")).toBe("raw");
      expect(detectFileKind("A7_001.arw")).toBe("raw");
      expect(detectFileKind("DJI_001.dng")).toBe("raw");
    });

    it("classifies videos by extension", () => {
      expect(detectFileKind("clip.mp4")).toBe("video");
      expect(detectFileKind("clip.MOV")).toBe("video");
      expect(detectFileKind("clip.webm")).toBe("video");
    });

    it("classifies PDFs by extension and MIME", () => {
      expect(detectFileKind("album.pdf")).toBe("pdf");
      expect(detectFileKind("ALBUM.PDF")).toBe("pdf");
      expect(detectFileKind("file.unknown", "application/pdf")).toBe("pdf");
    });

    it("falls through to 'other' for unknown extensions", () => {
      expect(detectFileKind("notes.txt")).toBe("other");
      expect(detectFileKind("archive.zip")).toBe("other");
      expect(detectFileKind("")).toBe("other");
    });
  });

  describe("by MIME type (fallback when extension unknown)", () => {
    it("recognizes HEIC mime even with misleading filename", () => {
      // Cloud-Sync-Apps benennen HEIC manchmal auf .jpg um, behalten
      // aber den korrekten MIME-Type
      expect(detectFileKind("foo.unknown", "image/heic")).toBe("heic");
      expect(detectFileKind("foo.unknown", "image/heif")).toBe("heic");
      expect(detectFileKind("foo.unknown", "image/heic-sequence")).toBe("heic");
    });

    it("falls back to generic image for image/*", () => {
      expect(detectFileKind("foo.unknown", "image/jpeg")).toBe("image");
      expect(detectFileKind("foo.unknown", "image/png")).toBe("image");
    });

    it("falls back to video for video/*", () => {
      expect(detectFileKind("foo.unknown", "video/quicktime")).toBe("video");
    });

    it("extension wins over MIME when both are known", () => {
      // Dies sollte heic gewinnen, weil .heic eindeutig ist und MIME
      // nicht widerspricht. Der eigentliche Test: wenn die Extension klar
      // ein Bild ist (jpg), interpretieren wir das nicht als HEIC, selbst
      // wenn der MIME-Type lügt.
      expect(detectFileKind("photo.jpg", "image/heic")).toBe("image");
    });
  });
});
