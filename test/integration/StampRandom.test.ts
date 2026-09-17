import { describe, expect, it } from "vitest";

import {
  deriveStrokeSeed,
  ErrorCodes,
  ReverieRangeError,
  sampleStampRandom,
  STAMP_RANDOM_CHANNELS,
} from "@reverie/core";

describe("deterministic stamp random channels", () => {
  // Computed independently with BigInt multiplication and modulo 2^32 arithmetic.
  it.each([
    [0, 0, 1, 1348811757],
    [0, 0, 2, 2243369076],
    [0, 0, 3, 1828163012],
    [0x80000000, 0, 1, 1557000769],
    [0xffffffff, 0xffffffff, 0xffffffff, 3459073689],
    [0xffffffff, 0x80000000, 3, 1531754595],
    [123456789, 42, 2, 1008661571],
    [0, 0xffffffff, 0, 0],
    [1364076727, 0xffffffff, 1, 0],
  ])(
    "preserves the uint32 vector (%s, %s, %s)",
    (seed, index, channel, word) => {
      expect(sampleStampRandom(seed, index, channel)).toBe(word / 0x100000000);
      expect(sampleStampRandom(seed, index, channel)).toBe(word / 0x100000000);
    },
  );

  it("keeps independently addressed channels stable across unrelated calls", () => {
    expect(STAMP_RANDOM_CHANNELS).toEqual({
      size: 1,
      rotation: 2,
      opacity: 3,
      scatterAlong: 4,
      scatterAcross: 5,
      spacing: 6,
    });
    expect(Object.isFrozen(STAMP_RANDOM_CHANNELS)).toBe(true);
    const size = sampleStampRandom(0xffffffff, 7, STAMP_RANDOM_CHANNELS.size);
    const rotation = sampleStampRandom(
      0xffffffff,
      7,
      STAMP_RANDOM_CHANNELS.rotation,
    );
    const opacity = sampleStampRandom(
      0xffffffff,
      7,
      STAMP_RANDOM_CHANNELS.opacity,
    );

    sampleStampRandom(0xffffffff, 7, 0xdeadbeef);
    sampleStampRandom(5, 100, STAMP_RANDOM_CHANNELS.size);

    expect(
      sampleStampRandom(0xffffffff, 7, STAMP_RANDOM_CHANNELS.opacity),
    ).toBe(opacity);
    expect(sampleStampRandom(0xffffffff, 7, STAMP_RANDOM_CHANNELS.size)).toBe(
      size,
    );
    expect(
      sampleStampRandom(0xffffffff, 7, STAMP_RANDOM_CHANNELS.rotation),
    ).toBe(rotation);
    expect(new Set([size, rotation, opacity]).size).toBe(3);
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [0x80000000, 3],
  ])("does not exchange the seed %s and channel %s roles", (seed, channel) => {
    for (let index = 0; index < 16; index += 1) {
      expect(sampleStampRandom(seed, index, channel)).not.toBe(
        sampleStampRandom(channel, index, seed),
      );
    }
  });

  it("does not alias published channels across seeds differing by a channel ID", () => {
    for (let index = 0; index < 16; index += 1) {
      expect(
        sampleStampRandom(0, index, STAMP_RANDOM_CHANNELS.rotation),
      ).not.toBe(sampleStampRandom(1, index, STAMP_RANDOM_CHANNELS.opacity));
      expect(sampleStampRandom(1, index, STAMP_RANDOM_CHANNELS.size)).not.toBe(
        sampleStampRandom(0, index, 0),
      );
    }
  });

  it("produces finite unsigned and signed samples across indices and channels", () => {
    const samples = new Set<number>();
    for (let index = 0; index < 512; index += 1) {
      for (const channel of Object.values(STAMP_RANDOM_CHANNELS)) {
        const sample = sampleStampRandom(0x80000000, index, channel);
        const signed = sample * 2 - 1;
        expect(Number.isFinite(sample)).toBe(true);
        expect(sample).toBeGreaterThanOrEqual(0);
        expect(sample).toBeLessThan(1);
        expect(signed).toBeGreaterThanOrEqual(-1);
        expect(signed).toBeLessThan(1);
        samples.add(sample);
      }
    }
    expect(samples.size).toBe(512 * 6);
  });

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "rejects invalid uint32 input %s in every argument",
    (invalid) => {
      for (const sample of [
        () => sampleStampRandom(invalid, 0, 1),
        () => sampleStampRandom(0, invalid, 1),
        () => sampleStampRandom(0, 0, invalid),
      ]) {
        expect(sample).toThrow(ReverieRangeError);
        expect(sample).toThrow(`[${ErrorCodes.RANDOM.INVALID_UINT32}]`);
      }
    },
  );

  it("rejects nonnumeric seeds instead of coercing JavaScript input", () => {
    // @ts-expect-error Runtime validation protects JavaScript callers.
    expect(() => sampleStampRandom("0", 0, 1)).toThrow(
      `[${ErrorCodes.RANDOM.INVALID_UINT32}]`,
    );
  });
});

describe("deterministic stroke seed derivation", () => {
  it.each([
    [0, 0, 2462723854],
    [0, 1, 1020716019],
    [0x80000000, 0, 3172115818],
    [0xffffffff, 0xffffffff, 2180083513],
    [0xffffffff, 0x80000000, 849629901],
    [123456789, 42, 2728667898],
  ])(
    "preserves the uint32 derivation vector (%s, %s)",
    (seed, sequence, expected) => {
      expect(deriveStrokeSeed(seed, sequence)).toBe(expected);
      expect(deriveStrokeSeed(seed, sequence)).toBe(expected);
    },
  );

  it("changes the seed for each recorded stroke sequence", () => {
    const seeds = new Set<number>();
    for (let sequence = 0; sequence < 512; sequence += 1) {
      const seed = deriveStrokeSeed(0xffffffff, sequence);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
      seeds.add(seed);
    }
    expect(seeds.size).toBe(512);
    expect(deriveStrokeSeed(0, 0)).not.toBe(deriveStrokeSeed(1, 0));
  });

  it.each([-1, 0.5, 0x100000000, Number.NaN, Infinity, -Infinity])(
    "rejects invalid base seed or sequence %s",
    (invalid) => {
      expect(() => deriveStrokeSeed(invalid, 0)).toThrow(
        `[${ErrorCodes.RANDOM.INVALID_UINT32}]`,
      );
      expect(() => deriveStrokeSeed(0, invalid)).toThrow(
        `[${ErrorCodes.RANDOM.INVALID_UINT32}]`,
      );
    },
  );
});
