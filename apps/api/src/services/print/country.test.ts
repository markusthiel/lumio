import { describe, it, expect } from "vitest";
import { inferCountryFromName } from "./country.js";

describe("inferCountryFromName", () => {
  it("reads an ISO code", () => {
    expect(inferCountryFromName("IT")).toBe("IT");
    expect(inferCountryFromName(" de ")).toBe("DE");
  });

  it("reads the usual spellings in the project's languages", () => {
    expect(inferCountryFromName("Italia")).toBe("IT");
    expect(inferCountryFromName("Italy")).toBe("IT");
    expect(inferCountryFromName("Deutschland")).toBe("DE");
    expect(inferCountryFromName("Österreich")).toBe("AT");
    expect(inferCountryFromName("Schweiz")).toBe("CH");
    expect(inferCountryFromName("Suomi")).toBe("FI");
    expect(inferCountryFromName("frankreich")).toBe("FR");
    expect(inferCountryFromName("Czech Republic")).toBe("CZ");
    expect(inferCountryFromName("United Kingdom")).toBe("GB");
  });

  it("leaves what it does not recognise unresolved", () => {
    expect(inferCountryFromName("Narnia")).toBeNull();
    expect(inferCountryFromName("United States")).toBeNull();
    expect(inferCountryFromName("")).toBeNull();
    expect(inferCountryFromName(null)).toBeNull();
    expect(inferCountryFromName(undefined)).toBeNull();
  });
});
