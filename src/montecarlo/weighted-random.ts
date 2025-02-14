const DAYS_PER_POINT = 3;

export type WeightedRandomSpecification = {
    [estimation: number]: number[]
}

export function weightedRandom(spec: WeightedRandomSpecification): (estimation: number) => number {
    let tablePerSpec: { [estimation: number]: number[] } = {};
    for (const [estimation, estimationSpec ] of Object.entries(spec)) {
        const chances = [];
        let times = 1;
        for (const daysSpent of Object.values(estimationSpec)) {
            for (let i = 0; i < times; i++) {
                chances.push(+daysSpent);
            }
            times += 1;
        }

        tablePerSpec[+estimation] = chances;
    }

    return estimation => {
        const lookupTable = tablePerSpec[estimation];
        const index = Math.floor(Math.random() * (lookupTable?.length || estimation * DAYS_PER_POINT));

        return lookupTable ? lookupTable[index] : DAYS_PER_POINT;
    };
  }