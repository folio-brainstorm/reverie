/** Millisecond duration for the latest sample and a bounded rolling window. */
export interface TimingMetric {
  readonly current: number;
  readonly average: number;
  readonly max: number;
}
