import { buildInfo } from './_build/build_info' assert { type: 'macro' };
import { montecarlo, quantile, weightSpecFromHistory } from "./montecarlo";
import {DefaultJiraApi, sampleHistoryForProject, queryScope, guessHistory} from "./task";
import Chartscii, { ChartData } from 'chartscii';
import minimist from 'minimist';
import Table from 'cli-table';

const DANGEROUS_DEVIATION_IN_DAYS = 10;
const WARN_DEVIATION_IN_DAYS = 5;

type BaseCliArgs = {
    help: boolean;
    version: boolean;
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
    "monthly-sp": number;
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

if (cliArgs.version) {
    console.log(buildInfo())
    process.exit(1);
}

if (!(cliArgs.url && cliArgs.token && cliArgs.projects) || cliArgs.help) {
    console.log(`Usage: ${Bun.argv[0]} --analyze | --estimate\n`);
    console.log('\tGlobal Options:')
    console.log('\t\t--url\tURL to the JIRA Server. For example: "https://jira.company.org/".')
    console.log('\t\t--token\tPersonal authentication token for JIRA.')
    console.log('\t\t--projects\tList of projects to parse, in a comma-separated list. For example: COMPASS,VSCODE,MONGOSH\n')
    console.log('\tCommands:')
    console.log('\t\t--analyze\tPrints a summary of the historical information retrieved.')
    console.log('\t\t--estimate\tExecutes a statistical estimation in time of a given epic and milestone to be finished.')
    console.log('\t\t\t--deadline Potential deadline of the deliver in YYYY-MM-DD format. For example: 2023-04-03')
    console.log('\t\t\t--epic Id of the epic to estimate. For example: COMPASS-0000')
    console.log('\t\t\t--milestone Optional: Name of the milestone to be estimated. Defaults to the entire epic.')
    console.log('\t\t\t--iterations Optional: Number of iterations for the simulation. Defaults to 1000.')
    console.log('\t\t\t--verbose Optional: If specified, will print the list of tasks in the scope.')
    console.log('\t\t\t--parallel Optional: Estimated number of tasks that can be done in parallel. Defaults to 1.')
    console.log('\t\t\t--monthly-sp Optional: Story points finished this month. If provided, it uses this number for the estimation of the scope. Defaults to empty.')
    console.log('\t\t\t  Before specifying --parallel to the number of developers in the team, please consider blocks and dependencies.')
    console.log("Examples:\n")
    console.log("Estimate if a given milestone in a project can be released before the 30th of October:")
    console.log(`$> ${Bun.argv[0]} --url='https://my-jira.org/ --token='' --projects=PROJECT --epic=PROJECT-0001 --milestone=milestone-1 --estimate --deadline=2023-10-30\n`)
    console.log("Analyse throughput of the team for the last 50 closed tasks.")
    console.log(`$> ${Bun.argv[0]} --url='https://my-jira.org/ --token='' --projects=PROJECT --analyse\n`)
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

        const actualHistory = cliArgs["monthly-sp"] !== undefined ? guessHistory(cliArgs["monthly-sp"]) : history;
        const totalPoints = scope.reduce((a, b) => a + b.estimation, 0);
        const result = montecarlo(actualHistory, scope, (+cliArgs.iterations) || 1000, (+cliArgs.parallel) || 1);
        const chartData: ChartData[] = [];

        for (const [label, value] of Object.entries(result)) {
            const color = value.finishBy > maxDate ? 'red' : 'green';
            const daysInParallel = value.days / (+cliArgs.parallel || 1);
            const effort = Math.ceil(daysInParallel / 5);

            chartData.push({ label: label + ` in ${value.days} days (${effort} weeks effort) by ${formatDate(value.finishBy)}`, value: value.days, color });
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

        const outlierData = [];

        for (const [ estimation, days ] of Object.entries(weightSpec)) {
            const outlierThreshold = quantile(days, 0.95);
            for (const task of history) {
                if (task.estimation === +estimation && task.duration > outlierThreshold) {
                    outlierData.push([ task.taskId, task.estimation, task.duration ])
                }
            }
        }

        const outlierTable = new Table({
            head: [ 'Task Id', 'Story Points', 'Duration'],
            rows: outlierData
        });

        console.log('📊 Outlier tasks:');
        console.log(outlierTable.toString());

        
    } break;
}
