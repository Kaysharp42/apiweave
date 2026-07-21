import { randomBytes } from "node:crypto";

export interface ClockProvider {
  now(): Date;
  isoNow(): string;
}

export interface RngProvider {
  next(): number;
  bytes(size: number): Uint8Array;
}

export class WallClockProvider implements ClockProvider {
  now(): Date {
    return new Date();
  }

  isoNow(): string {
    return this.now().toISOString();
  }
}

export class CryptoRandomProvider implements RngProvider {
  next(): number {
    return randomBytes(4).readUInt32BE(0) / 0x100000000;
  }

  bytes(size: number): Uint8Array {
    return randomBytes(size);
  }
}

export class FixedClockProvider implements ClockProvider {
  private readonly fixed: Date;

  constructor(isoTimestamp: string) {
    this.fixed = new Date(isoTimestamp);
  }

  now(): Date {
    return new Date(this.fixed.getTime());
  }

  isoNow(): string {
    return this.fixed.toISOString();
  }
}

export class SeededRandomProvider implements RngProvider {
  private state: number;

  constructor(seed: string | number) {
    this.state = normalizeSeed(seed);
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  bytes(size: number): Uint8Array {
    const out = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      out[index] = Math.floor(this.next() * 256);
    }
    return out;
  }
}

function normalizeSeed(seed: string | number): number {
  if (typeof seed === "number") {
    return seed >>> 0;
  }
  const parsed = Number.parseInt(seed, seed.startsWith("0x") ? 16 : 10);
  if (Number.isFinite(parsed)) {
    return parsed >>> 0;
  }
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
