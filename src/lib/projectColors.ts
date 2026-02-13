const PASTEL_PROJECT_PALETTE = [
  "#DD9999",
  "#9BC5AA",
  "#BCA4CC",
  "#E4C2A8",
  "#94BDC8",
  "#E7D98C",
] as const;

function hashText(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function getProjectBaseColor(projectName: string): string {
  const normalized = projectName.trim().toLowerCase();
  if (!normalized || normalized === "no project") return "#CBD5E1";
  return PASTEL_PROJECT_PALETTE[hashText(normalized) % PASTEL_PROJECT_PALETTE.length];
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return { r, g, b };
}

export function getProjectSurfaceColors(projectName: string): { borderColor: string; backgroundColor: string } {
  const rgb = hexToRgb(getProjectBaseColor(projectName));
  if (!rgb) {
    return {
      borderColor: "rgb(148 163 184 / 0.80)",
      backgroundColor: "rgb(241 245 249 / 0.90)",
    };
  }
  return {
    borderColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.80)`,
    backgroundColor: `rgb(${rgb.r} ${rgb.g} ${rgb.b} / 0.28)`,
  };
}
