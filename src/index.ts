import { montecarlo } from "./montecarlo";
import { DefaultJiraApi, sampleHistoryForProject, queryScope } from "./task";
import Chartscii, { ChartData } from 'chartscii';
import minimist from 'minimist';
import Table  from 'cli-table';

function formatDate(date: Date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toLocaleString('en-US', { minimumIntegerDigits: 2 })}-${(date.getDate()).toLocaleString('en-US', { minimumIntegerDigits: 2 })}`
}

const cliArgs = minimist(Bun.argv);
let maxDate = new Date("2100-01-01");

if (cliArgs.limit) {
    maxDate = new Date(cliArgs.limit);
}

if (!(cliArgs.url && cliArgs.token && cliArgs.projects && cliArgs.epic)) {
    console.error('Usage: ');
    process.exit(1);
}

const jiraApi = DefaultJiraApi.authorized(cliArgs.url, cliArgs.token);
const history = await sampleHistoryForProject(cliArgs.projects.split(','), jiraApi);
const scope = await queryScope(cliArgs.epic, cliArgs.milestone, jiraApi);

if (history.length === 0) {
    console.error('Could not get historical data for projects:', cliArgs.projects);
    process.exit(1);
}

if (scope.length === 0) {
    console.error('Could not get tasks in the sprint:', cliArgs.sprint);
    process.exit(1);
}


const totalPoints = scope.reduce((a, b) => a + b.estimation, 0);
const result = montecarlo(history, scope, 10000);
const chartData: ChartData[] = [];

for (const [label, value] of Object.entries(result)) {
    const color = value.finishBy > maxDate ? 'red' : 'green';
    chartData.push({ label: label + ` in ${value.days} days (by ${formatDate(value.finishBy)})`, value: value.days, color });
}

const chart = new Chartscii(chartData, {
    label: `📆 Probability of finishing the scope of ${totalPoints} story points:`,
    width: 80,
    char: '■',
    sort: true,
    reverse: false,
    colorLabels: true,
});

console.log(chart.create())

if (cliArgs.verbose) {
    console.log('📦 Scope: ')
    const table = new Table({
        head: ['Project', 'Task', 'Estimation'],
        rows: scope.map(task => [task.project, task.taskId, task.estimation])
    });

    console.log(table.toString());
}

if (cliArgs.stats) {
    console.log('TODO')
}