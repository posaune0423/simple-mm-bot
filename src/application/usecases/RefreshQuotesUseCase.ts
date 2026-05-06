import { randomUUID } from "node:crypto";

import type { QuoteEngine } from "../../domain/QuoteEngine.ts";
import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";
import type { MetricsRecorder } from "../MetricsRecorder.ts";
import { logger } from "../../utils/logger.ts";

export class RefreshQuotesUseCase {
  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly quoteEngine: QuoteEngine,
    private readonly metrics?: MetricsRecorder,
  ) {}

  async execute(): Promise<void> {
    const [snapshot, position] = await Promise.all([
      this.marketFeed.getSnapshot(),
      this.positionRepository.get(),
    ]);

    const quote = this.quoteEngine.compute(snapshot, position);
    logger.info(
      `refresh_quotes.quote_created market=${snapshot.market} bid=${quote.bid} ask=${quote.ask} bidSize=${quote.bidSize} askSize=${quote.askSize} policy=${quote.policy} positionQty=${position.qty}`,
    );
    await this.metrics?.recordQuote(snapshot, position.qty, quote);
    await this.orderGateway.cancelAll();
    const bidOrder = await this.orderGateway.place({
      market: snapshot.market,
      side: "buy",
      price: quote.bid,
      qty: quote.bidSize,
      reduceOnly: false,
      timeInForce: quote.policy,
      clientOrderId: randomUUID(),
      intent: "quote",
    });
    const askOrder = await this.orderGateway.place({
      market: snapshot.market,
      side: "sell",
      price: quote.ask,
      qty: quote.askSize,
      reduceOnly: false,
      timeInForce: quote.policy,
      clientOrderId: randomUUID(),
      intent: "quote",
    });
    logger.info(
      `refresh_quotes.orders_submitted market=${snapshot.market} bidOrderId=${bidOrder.id} bidStatus=${bidOrder.status} askOrderId=${askOrder.id} askStatus=${askOrder.status}`,
    );
  }
}
