export const PROJECT_PASTEL_HEX = [
  "#A9E8E8",
  "#83CCD2",
  "#F5E29E",
  "#E2CF88",
  "#D2CCF2",
  "#BEB9E2",
  "#E8B7CA",
  "#D8B0C8",
  "#F68BA2",
  "#DFCFF3",
  "#ADE1EF",
  "#C6EAEE",
  "#B2EAD3",
  "#B1E8ED",
  "#EDBDD5",
  "#C8EBEF",
  "#C0F3EA",
  "#F5F4D6",
] as const;

export const DEFAULT_PROJECT_COLOR = PROJECT_PASTEL_HEX[0];
const PALETTE_SET = new Set(PROJECT_PASTEL_HEX.map((color) => color.toUpperCase()));

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getProjectBaseColor(projectName: string, explicitColor?: string | null): string {
  const rawExplicit = explicitColor?.trim() ?? "";
  if (/^#[0-9a-fA-F]{6}$/.test(rawExplicit)) {
    return rawExplicit.toUpperCase();
  }
  const normalized = projectName.trim().toLowerCase();
  if (!normalized || normalized === "no project") return "#CBD5E1";
  const hashed = PROJECT_PASTEL_HEX[hashText(normalized) % PROJECT_PASTEL_HEX.length];
  return PALETTE_SET.has(hashed.toUpperCase()) ? hashed : DEFAULT_PROJECT_COLOR;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

export function getProjectSurfaceColors(projectName: string, explicitColor?: string | null): { borderColor: string; backgroundColor: string } {
  const rgb = hexToRgb(getProjectBaseColor(projectName, explicitColor));
  if (!rgb) {
    return {
      borderColor: "rgb(148 163 184 / 0.80)",
      backgroundColor: "rgb(241 245 249 / 0.90)",
    };
  }
  return {
    borderColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.88)`,
    backgroundColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.52)`,
  };
}
