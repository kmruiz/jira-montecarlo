import type { WeightedRandomSpecification } from './weighted-random';
import type { Days, FinishedTask, Task } from '../task/';
import { weightedRandom } from './weighted-random';

type SimulationQuantile = { days: Days, finishBy: Date };

type SimulationResult = {
    "99%": SimulationQuantile,
    "95%": SimulationQuantile,
    "90%": SimulationQuantile,
    "70%": SimulationQuantile,
    "60%": SimulationQuantile,
};

function asc(array: number[]): void {
    array.sort((a, b) => a - b);
}

export function quantile(sorted: number[], q: number): number {
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return Math.ceil(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
    } else {
        return Math.ceil(sorted[base]);
    }
}

export function weightSpecFromHistory(history: FinishedTask[]): WeightedRandomSpecification {
    const weightSpec: WeightedRandomSpecification = {};
    for (const issue of history) {
        weightSpec[issue.estimation] = weightSpec[issue.estimation] || [];
        weightSpec[issue.estimation].push(issue.duration);
    }

    return weightSpec;
}

export function montecarlo(history: FinishedTask[], scope: Task[], iterations: number = 1000, parallel: number = 1): SimulationResult {
    const random = weightedRandom(weightSpecFromHistory(history));

    const results = [];
    for (let i = 0; i < iterations; i++) {
        const backlogEstimation = scope.reduce((a, b) => {
            return a + random(b.estimation);
        }, 0);

        results.push(Math.max(1, Math.ceil(backlogEstimation / parallel)));
    }

    asc(results);

    const start = new Date();

    const q99 = quantile(results, .99);
    const q95 = quantile(results, .95);
    const q90 = quantile(results, .90);
    const q70 = quantile(results, .70);
    const q60 = quantile(results, .60);

    const q99end = new Date(start.getTime() + (q99 * 24 * 60 * 60 * 1000));
    const q95end = new Date(start.getTime() + (q95 * 24 * 60 * 60 * 1000));
    const q90end = new Date(start.getTime() + (q90 * 24 * 60 * 60 * 1000));
    const q70end = new Date(start.getTime() + (q70 * 24 * 60 * 60 * 1000));
    const q60end = new Date(start.getTime() + (q60 * 24 * 60 * 60 * 1000));

    return {
        "99%": { days: q99, finishBy: q99end },
        "95%": { days: q95, finishBy: q95end },
        "90%": { days: q90, finishBy: q90end },
        "70%": { days: q70, finishBy: q70end },
        "60%": { days: q60, finishBy: q60end },
    }
}