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
    const normalizedExplicit = rawExplicit.toUpperCase();
    if (PALETTE_SET.has(normalizedExplicit)) {
      return normalizedExplicit;
    }
  }
  const normalized = projectName.trim().toLowerCase();
  if (!normalized || normalized === "no project") return "#CBD5E1";
  const hashed = PROJECT_PASTEL_HEX[hashText(normalized) % PROJECT_PASTEL_HEX.length];
  return PALETTE_SET.has(hashed.toUpperCase()) ? hashed : DEFAULT_PROJECT_COLOR;
}

type UniqueColorProject = {
  key: string;
  name: string;
  color?: string | null;
};

function normalizePaletteColor(color?: string | null): string | null {
  const raw = color?.trim() ?? "";
  if (!/^#[0-9a-fA-F]{6}$/.test(raw)) return null;
  const normalized = raw.toUpperCase();
  if (!PALETTE_SET.has(normalized)) return null;
  return normalized;
}

// Assign each project a stable, unique pastel color (when project count <= palette size).
export function assignUniquePastelColors(projects: UniqueColorProject[]): Map<string, string> {
  const palette = [...PROJECT_PASTEL_HEX].map((item) => item.toUpperCase());
  const sorted = [...projects].sort((a, b) => {
    const aName = a.name.trim().toLowerCase();
    const bName = b.name.trim().toLowerCase();
    if (aName === bName) return a.key.localeCompare(b.key);
    return aName.localeCompare(bName);
  });

  const used = new Set<string>();
  const result = new Map<string, string>();

  // Keep explicit palette colors only if unique.
  for (const project of sorted) {
    const explicit = normalizePaletteColor(project.color);
    if (!explicit || used.has(explicit)) continue;
    result.set(project.key, explicit);
    used.add(explicit);
  }

  // Fill remaining projects with deterministic unique colors.
  for (const project of sorted) {
    if (result.has(project.key)) continue;
    if (palette.length === 0) {
      result.set(project.key, DEFAULT_PROJECT_COLOR.toUpperCase());
      continue;
    }
    const seed = `${project.name.trim().toLowerCase()}::${project.key}`;
    const startIndex = hashText(seed) % palette.length;
    let picked: string | null = null;
    for (let offset = 0; offset < palette.length; offset += 1) {
      const candidate = palette[(startIndex + offset) % palette.length];
      if (!used.has(candidate)) {
        picked = candidate;
        break;
      }
    }
    // If projects exceed palette size, reuse deterministic fallback.
    if (!picked) picked = palette[startIndex];
    result.set(project.key, picked);
    used.add(picked);
  }

  return result;
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
  const base = getProjectBaseColor(projectName, explicitColor);
  const rgb = hexToRgb(base);
  if (!rgb) {
    return {
      borderColor: "rgb(148 163 184 / 0.80)",
      backgroundColor: "rgb(241 245 249 / 0.90)",
    };
  }
  return {
    // Keep calendar and project colors visually identical.
    borderColor: base,
    backgroundColor: base,
  };
}
