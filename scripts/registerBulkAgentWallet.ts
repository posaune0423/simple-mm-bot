import { BulkClient, type AgentWalletParams } from "bulk-ts-sdk";

import { stringifyError } from "../src/utils/errors.ts";
import { logger } from "../src/utils/logger.ts";

export const MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER = "paste main wallet private key here";
export const AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER = "paste agent wallet public key here";

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

export function validateRegistrationConstants(input: {
  mainWalletPrivateKey: string;
  agentWalletPublicKey: string;
}): void {
  if (
    input.mainWalletPrivateKey === MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER ||
    input.agentWalletPublicKey === AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER ||
    input.mainWalletPrivateKey.trim() === "" ||
    input.agentWalletPublicKey.trim() === ""
  ) {
    throw new Error(
      "Set BULK_MAIN_WALLET_PRIVATE_KEY and BULK_AGENT_WALLET_PUBLIC_KEY before running this script.",
    );
  }
}

function readRequiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function readBooleanEnv(name: string): boolean {
  const value = Bun.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function maskPublicKey(publicKey: string): string {
  return `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}`;
}

async function main(): Promise<void> {
  const mainWalletPrivateKey = readRequiredEnv("BULK_MAIN_WALLET_PRIVATE_KEY");
  const agentWalletPublicKey = readRequiredEnv("BULK_AGENT_WALLET_PUBLIC_KEY");
  const removeAgentWallet = readBooleanEnv("BULK_REMOVE_AGENT_WALLET");
  validateRegistrationConstants({ mainWalletPrivateKey, agentWalletPublicKey });

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
    remove: removeAgentWallet,
  });

  logger.info(
    `bulk_agent_wallet.${removeAgentWallet ? "remove" : "register"}.start main=${maskPublicKey(mainWalletPublicKey)} agent=${maskPublicKey(params.agent)} timeoutMs=${REQUEST_TIMEOUT_MS}`,
  );

  const response = await client.trade.manageAgentWallet(params, {
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  logger.log(JSON.stringify(response, null, 2));
  logger.info(
    `bulk_agent_wallet.${removeAgentWallet ? "remove" : "register"}.complete main=${maskPublicKey(mainWalletPublicKey)} agent=${maskPublicKey(params.agent)}`,
  );
}

if (import.meta.main) {
  void main().catch((error) => {
    logger.error(stringifyError(error));
    process.exitCode = 1;
  });
}
