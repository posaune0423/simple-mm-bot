import type { QuoteEngine } from "../../domain/QuoteEngine.ts";
import type { IMarketFeed } from "../../domain/ports/IMarketFeed.ts";
import type { IOrderGateway } from "../../domain/ports/IOrderGateway.ts";
import type { IPositionRepository } from "../../domain/ports/IPositionRepository.ts";

export class RefreshQuotesUseCase {
  constructor(
    private readonly marketFeed: IMarketFeed,
    private readonly orderGateway: IOrderGateway,
    private readonly positionRepository: IPositionRepository,
    private readonly quoteEngine: QuoteEngine,
  ) {}

  async execute(): Promise<void> {
    const [snapshot, position] = await Promise.all([
      this.marketFeed.getSnapshot(),
      this.positionRepository.get(),
    ]);

    const quote = this.quoteEngine.compute(snapshot, position);
    await this.orderGateway.cancelAll();
    await this.orderGateway.place({
      market: snapshot.market,
      side: "buy",
      price: quote.bid,
      qty: quote.bidSize,
      reduceOnly: false,
      timeInForce: quote.policy,
    });
    await this.orderGateway.place({
      market: snapshot.market,
      side: "sell",
      price: quote.ask,
      qty: quote.askSize,
      reduceOnly: false,
      timeInForce: quote.policy,
    });
  }
}
