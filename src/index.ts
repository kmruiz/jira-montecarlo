import { montecarlo, quantile, weightSpecFromHistory } from "./montecarlo";
import { DefaultJiraApi, sampleHistoryForProject, queryScope } from "./task";
import Chartscii, { ChartData } from 'chartscii';
import minimist from 'minimist';
import Table from 'cli-table';

const DANGEROUS_DEVIATION_IN_DAYS = 10;
const WARN_DEVIATION_IN_DAYS = 5;

type BaseCliArgs = {
    url: string;
    token: string;
    projects: string;
};

type CliArgs = ({
    action: 'estimate';
    deadline?: string;
    epic: string;
    milestone?: string;
    iterations: string;
    verbose: boolean;
    parallel: string;
} & BaseCliArgs) | ({
    action: 'analyse';
} & BaseCliArgs);

function formatDate(date: Date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toLocaleString('en-US', { minimumIntegerDigits: 2 })}-${(date.getDate()).toLocaleString('en-US', { minimumIntegerDigits: 2 })}`
}

const parsedCliArgs = minimist(Bun.argv);
const cliArgs: CliArgs = {
    action: parsedCliArgs.estimate ? 'estimate' : 'analyse',
    ...parsedCliArgs
} as unknown as CliArgs;

if (!(cliArgs.url && cliArgs.token && cliArgs.projects)) {
    console.error('Usage: ');
    process.exit(1);
}

const jiraApi = DefaultJiraApi.authorized(cliArgs.url, cliArgs.token);
const history = await sampleHistoryForProject(cliArgs.projects.split(','), jiraApi);

switch (cliArgs.action) {
    case 'estimate': {
        let maxDate = new Date("2100-01-01");

        if (cliArgs.deadline) {
            maxDate = new Date(cliArgs.deadline);
        }

        const scope = await queryScope(cliArgs.epic, cliArgs.milestone, jiraApi);
        if (history.length === 0) {
            console.error('Could not get historical data for projects:', cliArgs.projects);
            process.exit(1);
        }

        if (scope.length === 0) {
            console.error('Could not get tasks in the scope:', cliArgs.epic, cliArgs.milestone);
            process.exit(1);
        }


        const totalPoints = scope.reduce((a, b) => a + b.estimation, 0);
        const result = montecarlo(history, scope, (+cliArgs.iterations) || 1000, (+cliArgs.parallel) || 1);
        const chartData: ChartData[] = [];

        for (const [label, value] of Object.entries(result)) {
            const color = value.finishBy > maxDate ? 'red' : 'green';
            chartData.push({ label: label + ` in ${value.days} days (by ${formatDate(value.finishBy)})`, value: value.days, color });
        }

        const chart = new Chartscii(chartData, {
            label: `📆 Probability of finishing the scope of ${totalPoints} story points ${cliArgs.deadline ? `before ${cliArgs.deadline}` : ''}:`,
            width: 80,
            char: '■',
            sort: false,
            reverse: true,
            colorLabels: true,
        });

        console.log(chart.create())

        if (cliArgs.verbose) {
            console.log('📦 Scope: ')
            const table = new Table({
                head: ['Project', 'Task', 'Story Points'],
                rows: scope.map(task => [task.project, task.taskId, task.estimation])
            });

            console.log(table.toString());
        }

    } break;
    case 'analyse': {
        const weightSpec = weightSpecFromHistory(history);
        const dataTab: { [estimation: number]: number[] } = {};

        const dimensions = [... new Set(Object.values(weightSpec).map(spec => spec).reduce((a, b) => a.concat(b)))].map(e => +e);
        dimensions.sort((a, b) => a - b);

        for (const [ estimation, days ] of Object.entries(weightSpec)) {
            for (const day of days) {
                const indexOfDays = dimensions.indexOf(+day);

                dataTab[+estimation] = dataTab[+estimation] || Array(dimensions.length).fill(0);
                dataTab[+estimation][indexOfDays] = dataTab[+estimation][indexOfDays] || 0;
                dataTab[+estimation][indexOfDays]++;

            }
        }

        const data = Object.keys(dataTab).map(e => +e).toSorted().map(e => [ e ].concat(dataTab[e]))
        const table = new Table({
            head: [ 'Story Points', ... dimensions.map(e => `${e} days`) ],
            rows: data
        });

        console.log('📊 Task duration distribution based on story points estimation (lower distribution better): ');
        console.log(table.toString());

        const deviationByStoryPoints = Object.entries(weightSpec).map(([ estimation, sample ]) => {
            return { estimation, median: quantile(sample, .5), deviation: Math.abs(quantile(sample, .5) - quantile(sample, .99)) };
        });

        const deviationData = [];

        for (const { estimation, median, deviation } of deviationByStoryPoints) {
            if (deviation > DANGEROUS_DEVIATION_IN_DAYS) {
                deviationData.push(['🔴', estimation, median, deviation ]);
            } else if (deviation > WARN_DEVIATION_IN_DAYS) {
                deviationData.push(['🟠', estimation, median, deviation ]);
            } else {
                deviationData.push(['🟢', estimation, median, deviation ]);
            }
        }

        const deviationTable = new Table({
            head: [ '', 'Story Points', 'Median', 'Deviation' ],
            rows: deviationData
        });

        console.log('📊 Task deviation by story points (lower better):');
        console.log(deviationTable.toString());
        
    } break;
}
