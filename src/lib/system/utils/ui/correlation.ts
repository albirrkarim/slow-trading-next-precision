/**
 * Correlation helpers for sparse step-function series such as the recorded
 * `priceNormalized` feature stream: each sample's value holds from its
 * timestamp until the next record. Co-movement is measured with a
 * time-weighted Pearson — each aligned interval counts by its duration, so
 * a brief divergence cannot outweigh a long shared plateau.
 */

/** One step sample: value `v` holds from `t` until the next sample. */
export interface StepSample {
    t: number;
    v: number;
}

/** Correlation result of one series against an anchor step series. */
export interface StepCorrelation {
    /** Aligned change points where both series carried a value. */
    samples: number;
    /**
     * Time-weighted Pearson r in [-1, 1]; undefined when either side is
     * flat or the series never overlap.
     */
    r?: number;
}

function weightedPearson(
    points: Array<{ x: number; y: number }>,
    weights: number[],
): StepCorrelation {
    let wSum = 0;
    for (const w of weights) wSum += w;
    if (wSum <= 0) return { samples: points.length };

    let meanX = 0;
    let meanY = 0;
    for (let k = 0; k < points.length; k++) {
        meanX += weights[k] * points[k].x;
        meanY += weights[k] * points[k].y;
    }
    meanX /= wSum;
    meanY /= wSum;

    let cov = 0;
    let varX = 0;
    let varY = 0;
    for (let k = 0; k < points.length; k++) {
        const dx = points[k].x - meanX;
        const dy = points[k].y - meanY;
        cov += weights[k] * dx * dy;
        varX += weights[k] * dx * dx;
        varY += weights[k] * dy * dy;
    }
    if (varX <= 0 || varY <= 0) return { samples: points.length };
    return { r: cov / Math.sqrt(varX * varY), samples: points.length };
}

/**
 * Aligns two ascending step series and returns the time-weighted Pearson of
 * their carried values. Sampling happens at the union of change times where
 * both series are defined (i.e. from `max(firstA.t, firstB.t)`); every
 * aligned point is weighted by the duration until the next change, with the
 * last segment running to `windowEndMs`.
 */
export function stepCorrelation(
    a: StepSample[],
    b: StepSample[],
    windowEndMs?: number,
): StepCorrelation {
    if (a.length === 0 || b.length === 0) return { samples: 0 };
    const start = Math.max(a[0].t, b[0].t);
    const times = new Set<number>();
    for (const p of a) if (p.t >= start) times.add(p.t);
    for (const p of b) if (p.t >= start) times.add(p.t);
    if (times.size === 0) return { samples: 0 };

    const aligned: Array<{ t: number; x: number; y: number }> = [];
    let i = 0;
    let j = 0;
    for (const t of [...times].sort((x, y) => x - y)) {
        while (i + 1 < a.length && a[i + 1].t <= t) i++;
        while (j + 1 < b.length && b[j + 1].t <= t) j++;
        aligned.push({ t, x: a[i].v, y: b[j].v });
    }

    const weights = aligned.map((point, k) => {
        const next =
            k + 1 < aligned.length
                ? aligned[k + 1].t
                : (windowEndMs ?? point.t);
        return Math.max(0, next - point.t);
    });
    return weightedPearson(aligned, weights);
}

const correlation = { stepCorrelation };

export default correlation;
