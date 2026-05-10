import type { Quote, QuoteContext } from "../../entities/Quote.ts";
import type { IQuotingStrategy } from "../IQuotingStrategy.ts";
import type { AvellanedaStoikovParams } from "./AvellanedaStoikovParams.ts";

export class AvellanedaStoikovStrategy implements IQuotingStrategy {
  readonly name = "avellaneda-stoikov";

  constructor(private readonly params: AvellanedaStoikovParams) {}

  computeQuote(context: QuoteContext): Quote {
    // Avellaneda-Stoikov decomposes quoting into:
    // - spread: how wide the market should be
    // - skew: how much inventory should shift the reservation price
    const spread = this.computeSpread(context);
    const skew = this.computeSkew(context);
    const reservationPrice = context.fairPrice - skew;
    const policy =
      context.marginRatio !== null && context.marginRatio < context.slideMarginThreshold
        ? "IOC"
        : context.defaultTimeInForce;

    return {
      bid: Math.max(0, reservationPrice - spread / 2),
      ask: Math.max(0, reservationPrice + spread / 2),
      bidSize: context.quoteSize,
      askSize: context.quoteSize,
      policy,
      fairPrice: context.fairPrice,
      sigma: context.sigma,
    };
  }

  private computeSpread(context: QuoteContext): number {
    const { gamma, kappa } = this.params;
    const varianceTerm = context.sigma ** 2 * context.timeHorizonSec;
    const minSpread =
      context.minSpreadBps === undefined ? 0 : context.fairPrice * (context.minSpreadBps / 10_000);

    if (gamma === 0) {
      // gamma=0 is our fixed-spread fallback mode.
      return Math.max(2 / kappa, minSpread);
    }

    // Wider spreads are justified by higher risk aversion and higher variance.
    return Math.max(gamma * varianceTerm + (2 / gamma) * Math.log(1 + gamma / kappa), minSpread);
  }

  private computeSkew(context: QuoteContext): number {
    // Inventory is normalized through tanh so skew saturates smoothly instead
    // of exploding for large positions.
    const normalizedInventory = Math.tanh(context.positionQty / context.inventoryScale);
    return (
      normalizedInventory * this.params.kInv * context.sigma * Math.sqrt(context.timeHorizonSec)
    );
  }
}
