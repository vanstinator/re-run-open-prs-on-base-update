/*
 * Copyright 2020 Red Hat, Inc. and/or its affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const core = require("@actions/core");
const github = require("@actions/github");
const { Octokit } = require("@octokit/rest")
const fetch = require("node-fetch");


async function waitForCanceledRun(octokit, data) {

    // If we somehow get into a state where the status never updates we should bail eventually
    let count = 0;
    while (count < 20) {

        count++;

        console.info(`Waiting for workflow to cancel (attempt #${count})... #${data.number}: ${data.title}`);

        await new Promise(resolve => setTimeout(resolve, 4000));
        let workflowRun = await getWorkflowRunForBranch(octokit, data);

        if (workflowRun && workflowRun.status === 'completed') {
            break;
        }
    }
}

async function dispatchWorkflowEvent(octokit, data) {
    console.info(`Dispatching "workflow_dispatch"... #${data.number}: ${data.title}`);

    let workflowRun = await getWorkflowRunForBranch(octokit, data);

    if (workflowRun) {
        const skipFailedRuns = core.getInput("skip_failed_runs");
        const ignoreFailedJobs = core.getInput("ignore_failed_jobs_regex");

        if (workflowRun.conclusion === 'failure' && skipFailedRuns) {
            if (ignoreFailedJobs) {
                const ignoreFailedJobsRegex = new RegExp(ignoreFailedJobs, "i");

                const jobs = await getJobsForWorkflowRun(octokit, { ...data, run_id: workflowRun.id });

                for (const job of jobs) {
                    console.info(`  Job: ${job.name} - ${job.status} ${job.conclusion} ${ignoreFailedJobsRegex.test(job.name)}`);
                }
            }

            console.log(`Skipped: Failed run #${data.number}: ${data.title}`)
            return;
        }

        if (workflowRun.status !== 'completed') {
            console.info(`DRY RUN cancelWorkflowRun... #${data.number}: ${data.title}`);
            // await octokit.actions.cancelWorkflowRun({
            //     owner: data.owner,
            //     repo: data.repo,
            //     run_id: workflowRun.id
            // });

            // await waitForCanceledRun(octokit, data);
        }

        console.info(`DRY RUN reRunWorkflow... #${data.number}: ${data.title}`);
        // await octokit.actions.reRunWorkflow({
        //     owner: data.owner,
        //     repo: data.repo,
        //     run_id: workflowRun.id
        // });
    }
}

async function getWorkflowRunForBranch(octokit, data) {
    const response = await octokit.actions.listWorkflowRunsForRepo({
        owner: data.owner,
        repo: data.repo,
        branch: data.ref,
        event: 'pull_request'
    });

    try {
        return response.data.workflow_runs[0];
    } catch (e) {
        console.error(e)
    }
}

async function getJobsForWorkflowRun(octokit, data) {
    const response = await octokit.actions.listJobsForWorkflowRun({
        owner: data.owner,
        repo: data.repo,
        run_id: data.run_id
    });

    try {
        return response.data.jobs;
    } catch (e) {
        console.error(e)
    }
}

async function dispatchWorkflowEventToGithub(octokit, opts) {

    if (!opts || !opts.owner || !opts.repo || !opts.ref) {
        return Promise.reject(new Error('Invalid parameters'))
    }

    return dispatchWorkflowEvent(octokit, {
        ...opts,
        ref: opts.ref || 'heads/main',
    });
}

async function run() {

    const githubToken = core.getInput("github_token");

    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    // For testing only!!! REMOVE BEFORE MERGING PR
    const branch = 'main';
    // const branch = github.context.ref.replace("refs/heads/", "");

    const githubApiDomain = `https://api.github.com`;
    const authHeaders = {
        headers: {
            Authorization: "token " + githubToken,
            Accept: "application/vnd.github.v3+json"
        }
    };
    const octokit = new Octokit({ auth: githubToken });

    const openPrs = await fetch(`${githubApiDomain}/repos/${owner}/${repo}/pulls?state=open&base=${branch}`, authHeaders)
        .then(c => c.json())
        .then(prs => prs.filter(pr => !pr.user.login.includes("dependabot")).filter(pr => !pr.draft));

    console.log(`Found ${openPrs.length} open PR(s) targeting '${branch}'`);

    const labelRegexString = core.getInput("require_label_regex");
    const labelRegex = new RegExp(labelRegexString, "i");

    for (const pr of openPrs) {
        if (labelRegexString) {
            const matchingLabels = (pr.labels || []).filter(label => label && (label.name.match(labelRegex) || []).length);

            if (!matchingLabels || !matchingLabels.length) {
                console.log(`Skipped: PR does not have a required label #${pr.number}: ${pr.title}`);
                return Promise.resolve();
            }
        }

        console.log(`Dispatching workflow on #${pr.number}: ${pr.title}`);

        try {
            await dispatchWorkflowEventToGithub(octokit, {
                number: pr.number,
                owner: pr.head.user.login,
                repo,
                ref: pr.head.ref,
                title: pr.title
            })
        } catch (e) {
            console.warn(`Failed to dispatch workflow on #${pr.number}: ${pr.title}`);
            console.warn(e);
        }

        console.log(`Dispatched workflow on #${pr.number}: ${pr.title}`);
    }
}

run()
    .then(() => console.log("Finished."))
    .catch(e => core.setFailed(e.message));
