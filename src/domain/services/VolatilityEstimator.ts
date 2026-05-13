export class VolatilityEstimator {
  private previousPrice: number | null = null;
  private previousTs: number | null = null;
  private variancePerSec = 0;

  constructor(private readonly alpha = 0.2) {}

  update(price: number, timestamp = Date.now()): number {
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) {
      return Math.sqrt(this.variancePerSec);
    }

    if (this.previousPrice === null || this.previousPrice <= 0) {
      this.previousPrice = price;
      this.previousTs = timestamp;
      return Math.sqrt(this.variancePerSec);
    }

    if (this.previousTs !== null && timestamp <= this.previousTs) {
      return Math.sqrt(this.variancePerSec);
    }

    const dtSec = (timestamp - this.previousTs!) / 1000;
    const logReturn = Math.log(price / this.previousPrice);
    const instantVariancePerSec = logReturn ** 2 / dtSec;
    this.variancePerSec =
      this.alpha * instantVariancePerSec + (1 - this.alpha) * this.variancePerSec;
    this.previousPrice = price;
    this.previousTs = timestamp;
    return Math.sqrt(this.variancePerSec);
  }
}
