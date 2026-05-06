type Attrs = Record<string, string | number | undefined>;

export function svgEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderAttrs(attrs: Attrs): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(attrs)) {
    if (raw === undefined) continue;
    const value = typeof raw === "number" ? formatNumber(raw) : svgEscape(raw);
    parts.push(`${key}="${value}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Number.isInteger(value)) return String(value);
  return Number(value.toFixed(3)).toString();
}

export function svgRoot(width: number, height: number, children: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(width)} ${formatNumber(height)}" width="${formatNumber(width)}" height="${formatNumber(height)}">`,
    children.join(""),
    "</svg>",
  ].join("");
}

export function g(attrs: Attrs, children: string[]): string {
  return `<g${renderAttrs(attrs)}>${children.join("")}</g>`;
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  attrs: Attrs = {},
): string {
  return `<rect${renderAttrs({ x, y, width, height, ...attrs })} />`;
}

export function line(x1: number, y1: number, x2: number, y2: number, attrs: Attrs = {}): string {
  return `<line${renderAttrs({ x1, y1, x2, y2, ...attrs })} />`;
}

export function text(x: number, y: number, content: string, attrs: Attrs = {}): string {
  return `<text${renderAttrs({ x, y, ...attrs })}>${svgEscape(content)}</text>`;
}

export function path(d: string, attrs: Attrs = {}): string {
  return `<path${renderAttrs({ d, ...attrs })} />`;
}

export function circle(cx: number, cy: number, r: number, attrs: Attrs = {}): string {
  return `<circle${renderAttrs({ cx, cy, r, ...attrs })} />`;
}

export function polyline(
  points: ReadonlyArray<readonly [number, number]>,
  attrs: Attrs = {},
): string {
  const coords = points.map(([x, y]) => `${formatNumber(x)},${formatNumber(y)}`).join(" ");
  return `<polyline${renderAttrs({ points: coords, ...attrs })} />`;
}
