type PaginatedJiraIssues = { issues: JiraIssue[] };

export const MAX_RESULTS_IN_JIRA = '25';

export interface JiraApi {
    searchJira(query: string): Promise<PaginatedJiraIssues>
}

export class DefaultJiraApi implements JiraApi {
    private constructor(
        private baseUrl: string,
        private token: string
    ) {
    }

    public static authorized(baseUrl: string, token: string) {
        return new DefaultJiraApi(baseUrl, token);
    }

    private get authorization(): string {
        return `Bearer ${this.token}`; 
    }

    async searchJira(query: string): Promise<PaginatedJiraIssues> {
        const queryParams = new URLSearchParams({ jql: query, maxResults: MAX_RESULTS_IN_JIRA, expand: 'project,changelog,customfield_10555', fields: 'key,project,customfield_10555' });
        const fullUrl = `${this.baseUrl}/rest/api/2/search?` + queryParams;

        const response = await fetch(fullUrl + queryParams, {
            method: 'GET',
            headers: {
                'Authorization': this.authorization,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            console.error('Could not access Jira Server at', fullUrl, ':', response.status);
            return { issues: [] };
        }

        return await response.json();
    }
}

type JiraIssue = {
    key: string,
    fields: {
        project: {
            key: string
        },
        customfield_10555: number, // thanks JIRA
    },
    changelog: {
        histories: [{
            created: string,
            items: [{
                field: string,
                toString: string
            }]
        }]
    },
};

export type Days = number;
export type Task = {
    taskId: string;
    project: string;
    estimation: number;
};

export type FinishedTask = Task & {
    duration: Days;
};

const FINISHED_STATUSES = ['closed'];

export async function sampleHistoryForProject(project: string[], api: JiraApi): Promise<FinishedTask[]> {
    const jiraSampleIssues = await api.searchJira(`project IN (${project.join(',')}) AND status IN ( Closed ) AND type = Task ORDER BY updated DESC`);
    const result = jiraSampleIssues.issues.map((issue: JiraIssue) => {
        const taskId = issue.key;
        const project = issue.fields.project.key;
        const estimation = issue.fields.customfield_10555 || 1;

        const startOfTaskHistory = issue.changelog.histories.find(history => history.items.some(change => change.field.toLowerCase() === 'status' && change.toString.toLowerCase() === 'in progress'));
        const endOfTaskHistory = issue.changelog.histories.find(history => history.items.some(change => change.field.toLowerCase() === 'status' && FINISHED_STATUSES.includes(change.toString.toLowerCase())));

        if (!startOfTaskHistory || !endOfTaskHistory) {
            return undefined;
        }

        const startOfTask = new Date(startOfTaskHistory.created);
        const endOfTask = new Date(endOfTaskHistory.created);

        const duration = Math.ceil((endOfTask.getTime() - startOfTask.getTime()) / 1000 / 60 / 60 / 24);

        return { taskId, project, duration, estimation };
    }).filter((maybeTask: FinishedTask | undefined) => maybeTask !== undefined && maybeTask.duration > 0) as FinishedTask[];

    return result
}

export async function queryScope(epic: string, milestone: string | undefined = undefined, api: JiraApi): Promise<Task[]> {
    const jiraSampleIssues = await api.searchJira(`"Epic Link" = '${epic}' ${milestone ? `AND labels = "${milestone}"` : ''} AND status NOT IN ( Closed ) ORDER BY updated DESC`);
    const allTaskParentTasksIds = jiraSampleIssues.issues.map((issue: JiraIssue) => issue.key).join(", ");
    const jiraSubTasks = await api.searchJira(`"Parent Link" IN (${allTaskParentTasksIds})`);

    const allIssues = jiraSampleIssues.issues.concat(jiraSubTasks.issues)
    return allIssues.map((issue: JiraIssue) => {
        const taskId = issue.key;
        const project = issue.fields.project.key;
        const estimation = issue.fields.customfield_10555 || 0;

        return { taskId, project, estimation };
    }).filter((maybeTask: Task | undefined) => maybeTask !== undefined)
        .filter((task: Task) => task.estimation != 0) as Task[];
}

function fakeTask(estimation: number, duration: number): FinishedTask {
    return {
        duration,
        estimation,
        project: "FAKE",
        taskId: `FAKE-${+new Date()}`
    }
}

const DISTRIBUTION_OF_SP = {
    1: 50/100,
    2: 25/100,
    3: 10/100,
    5: 10/100,
    8: 5 /100
}

const DAYS_IN_A_MONTH = 30

export function guessHistory(storyPointsInAMonth: number): FinishedTask[] {
    const result: FinishedTask[] = [];

    for (const [ sp, ratio ] of Object.entries(DISTRIBUTION_OF_SP)) {
        const numOfTasks = Math.max(1, storyPointsInAMonth * ratio);
        const numOfDays = DAYS_IN_A_MONTH * (1 - ratio);
        const daysForTask = numOfDays / numOfTasks

        for (let i = 0; i < numOfTasks; i++) {
            result.push(fakeTask(+sp, daysForTask));
        }
    }

    return result;
}
