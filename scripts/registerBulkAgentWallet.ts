import { BulkClient, type AgentWalletParams } from "bulk-ts-sdk";

import { stringifyError } from "../src/utils/errors.ts";
import { logger } from "../src/utils/logger.ts";

export const MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER = "paste main wallet private key here";
export const AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER = "paste agent wallet public key here";

// Human-only edit point:
// 1. Paste the main wallet private key here immediately before running this script.
// 2. Paste the agent wallet public key here.
// 3. Restore the placeholders after execution; do not commit real keys.
const MAIN_WALLET_PRIVATE_KEY = MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER;
const AGENT_WALLET_PUBLIC_KEY = AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER;
const REMOVE_AGENT_WALLET: boolean = false;

const BULK_HTTP_URL = "https://exchange-api.bulk.trade/api/v1";
const BULK_WS_URL = "wss://exchange-ws1.bulk.trade";
const REQUEST_TIMEOUT_MS = 30_000;

interface BuildParamsOptions {
  agentWalletPublicKey: string;
  remove: boolean;
}

export function buildManageAgentWalletParams(options: BuildParamsOptions): AgentWalletParams {
  return {
    agent: options.agentWalletPublicKey.trim(),
    remove: options.remove,
  };
}

function maskPublicKey(publicKey: string): string {
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}`;
}

async function main(): Promise<void> {
  const mainWalletPrivateKey = MAIN_WALLET_PRIVATE_KEY!;
  const agentWalletPublicKey = AGENT_WALLET_PUBLIC_KEY!;

  const client = new BulkClient({
    httpUrl: BULK_HTTP_URL,
    wsUrl: BULK_WS_URL,
    privateKey: mainWalletPrivateKey,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const mainWalletPublicKey = client.accountPublicKey;
  if (mainWalletPublicKey === undefined) {
    throw new Error("Could not derive main wallet public key from MAIN_WALLET_PRIVATE_KEY.");
  }

  const params = buildManageAgentWalletParams({
    agentWalletPublicKey,
    remove: REMOVE_AGENT_WALLET,
  });

  logger.info(
    `bulk_agent_wallet.${REMOVE_AGENT_WALLET ? "remove" : "register"}.start main=${maskPublicKey(mainWalletPublicKey)} agent=${maskPublicKey(params.agent)} timeoutMs=${REQUEST_TIMEOUT_MS}`,
  );

  const response = await client.trade.manageAgentWallet(params, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  logger.log(JSON.stringify(response, null, 2));
  logger.info(
    `bulk_agent_wallet.${REMOVE_AGENT_WALLET ? "remove" : "register"}.complete main=${maskPublicKey(mainWalletPublicKey)} agent=${maskPublicKey(params.agent)}`,
  );
}

if (import.meta.main) {
  void main().catch((error) => {
    logger.error(stringifyError(error));
    process.exitCode = 1;
  });
}
