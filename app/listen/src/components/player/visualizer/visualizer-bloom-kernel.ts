export const BLOOM_BLUR_GAUSSIAN_WEIGHTS = [
  0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216,
] as const;

export interface PairedBloomBlurTap {
  weight: number;
  offset: number;
}

function pairLinearBlurTaps(weights: readonly number[]): PairedBloomBlurTap[] {
  const taps: PairedBloomBlurTap[] = [];

  for (let index = 1; index < weights.length; index += 2) {
    const firstWeight = weights[index]!;
    const secondWeight = weights[index + 1]!;
    const combinedWeight = firstWeight + secondWeight;

    taps.push({
      weight: combinedWeight,
      offset:
        (index * firstWeight + (index + 1) * secondWeight) / combinedWeight,
    });
  }

  return taps;
}

export const BLOOM_BLUR_PAIRED_TAPS = pairLinearBlurTaps(
  BLOOM_BLUR_GAUSSIAN_WEIGHTS,
);
