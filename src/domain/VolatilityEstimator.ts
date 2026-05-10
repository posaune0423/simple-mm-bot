export class VolatilityEstimator {
  private previousPrice: number | null = null;
  private previousTs: number | null = null;
  private variancePerSec = 0;

  constructor(private readonly alpha = 0.2) {}

  update(price: number, timestamp = Date.now()): number {
    if (this.previousPrice === null || this.previousPrice <= 0 || price <= 0) {
      this.previousPrice = price;
      this.previousTs = timestamp;
      return Math.sqrt(this.variancePerSec);
    }

    const dtSec =
      this.previousTs === null ? 1 : Math.max((timestamp - this.previousTs) / 1000, 0.001);
    const logReturn = Math.log(price / this.previousPrice);
    const instantVariancePerSec = logReturn ** 2 / dtSec;
    this.variancePerSec =
      this.alpha * instantVariancePerSec + (1 - this.alpha) * this.variancePerSec;
    this.previousPrice = price;
    this.previousTs = timestamp;
    return Math.sqrt(this.variancePerSec);
  }
}
