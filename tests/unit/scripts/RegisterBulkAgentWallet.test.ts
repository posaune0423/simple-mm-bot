import { describe, expect, test } from "bun:test";

import {
  AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER,
  MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER,
  buildManageAgentWalletParams,
  validateRegistrationConstants,
} from "../../../scripts/registerBulkAgentWallet.ts";

describe("registerBulkAgentWallet", () => {
  test("rejects placeholder constants before any signed request can be sent", () => {
    expect(() =>
      validateRegistrationConstants({
        mainWalletPrivateKey: MAIN_WALLET_PRIVATE_KEY_PLACEHOLDER,
        agentWalletPublicKey: AGENT_WALLET_PUBLIC_KEY_PLACEHOLDER,
      }),
    ).toThrow("Edit scripts/registerBulkAgentWallet.ts");
  });

  test("builds an add-agent action from explicit script constants", () => {
    const params = buildManageAgentWalletParams({
      agentWalletPublicKey: "AgentWallet111111111111111111111111111111111",
      remove: false,
    });

    expect(params).toEqual({
      agent: "AgentWallet111111111111111111111111111111111",
      remove: false,
    });
  });

  test("supports remove mode without changing the agent public key", () => {
    const params = buildManageAgentWalletParams({
      agentWalletPublicKey: "AgentWallet111111111111111111111111111111111",
      remove: true,
    });

    expect(params).toEqual({
      agent: "AgentWallet111111111111111111111111111111111",
      remove: true,
    });
  });
});
