export class VolatilityEstimator {
  private previousPrice: number | null = null;
  private variance = 0;

  constructor(private readonly alpha = 0.2) {}

  update(price: number): number {
    if (this.previousPrice === null || this.previousPrice <= 0 || price <= 0) {
      this.previousPrice = price;
      return Math.sqrt(this.variance);
    }

    const logReturn = Math.log(price / this.previousPrice);
    this.variance = this.alpha * logReturn ** 2 + (1 - this.alpha) * this.variance;
    this.previousPrice = price;
    return Math.sqrt(this.variance);
  }
}
