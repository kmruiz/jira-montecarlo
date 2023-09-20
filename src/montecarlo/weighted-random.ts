const DAYS_PER_POINT = 3;

export type WeightedRandomSpecification = {
    [estimation: number]: { 
        [daysSpent: number]: number
    }
}
export function weightedRandom(spec: WeightedRandomSpecification): (estimation: number) => number {
    let tablePerSpec: { [estimation: number]: number[] } = {};
    for (const [estimation, estimationSpec ] of Object.entries(spec)) {
        const chances = [];
        for (const [ daysSpent, times ] of Object.entries(estimationSpec)) {
            for (let i = 0; i < times; i++) {
                chances.push(+daysSpent);
            }
        }

        tablePerSpec[+estimation] = chances;
    }

    return estimation => {
        const lookupTable = tablePerSpec[estimation];
        const index = Math.floor(Math.random() * (lookupTable?.length || estimation * DAYS_PER_POINT));

        return lookupTable ? lookupTable[index] : DAYS_PER_POINT;
    };
  }