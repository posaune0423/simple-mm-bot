export function detectTestnet(httpUrl: string): boolean {
  return !httpUrl.includes("api.hyperliquid.xyz");
}
