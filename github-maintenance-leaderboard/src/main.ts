import { Octokit } from 'npm:octokit';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';

const octokit = new Octokit({
  auth: Deno.env.get('GH_TOKEN'),
});

const repo = 'nrwl/nx';

async function getIssues() {
  if (existsSync('issues.json')) {
    return JSON.parse(readFileSync('issues.json').toString());
  }
  const query = `is:issue+repo:${repo}+is:closed+closed:2023-04-01..2023-05-01 `;

  console.log(`Fetching Issues ${query} ...`);
  const issues = await octokit.paginate(
    octokit.rest.search.issuesAndPullRequests,
    {
      per_page: 100,
      q: query,
    }
  );

  writeFileSync('issues.json', JSON.stringify(issues));

  return issues;
}

async function getPRs() {
  if (existsSync('prs.json')) {
    return JSON.parse(readFileSync('prs.json').toString());
  }
  const query = `is:pr+repo:${repo}+is:merged+merged:2023-04-01..2023-05-01+-linked:issue+fix+in:title`;

  console.log(`Fetching PRs ${query} ...`);
  const issues = await octokit.paginate(
    octokit.rest.search.issuesAndPullRequests,
    {
      per_page: 100,
      q: query,
    }
  );

  writeFileSync('prs.json', JSON.stringify(issues));

  return issues;
}

async function getCloser(issue: any): Promise<string> {
  const cachedData = JSON.parse(readFileSync('closers.json').toString());
  if (cachedData[issue.events_url]) {
    return cachedData[issue.events_url];
  }
  await new Promise((res) => setTimeout(res, 1000));
  console.log('getting closer', issue.html_url);
  const events = await octokit.paginate(issue.events_url, {
    per_page: 100,
  });
  const closedEvent = events.find((e: any) => e.event === 'closed');
  const closer = closedEvent.actor.login;

  writeFileSync(
    'closers.json',
    JSON.stringify({
      ...cachedData,
      [issue.events_url]: closer,
    })
  );

  return closer;
}

(async () => {
  const counts: Record<string, number> = {};
  if (!existsSync('closers.json')) {
    console.log('returning from file');

    writeFileSync('closers.json', JSON.stringify({}));
  }
  const issues = await getIssues();
  for (const issue of issues) {
    const closer = await getCloser(issue);

    counts[closer] ??= 0;

    counts[closer]++;
  }

  console.table(
    Object.entries(counts).sort(([_, countA], [__, countB]) => {
      return countB - countA;
    })
  );

  // const prs = await getPRs();
  //
  // for (const pr of prs) {
  //   const author = pr.user.login;
  //
  //   counts[author] ??= 0;
  //
  //   counts[author]++;
  // }

  // console.table(
  //   Object.entries(counts).sort(([_, countA], [__, countB]) => {
  //     return countB - countA;
  //   })
  // );
})();
