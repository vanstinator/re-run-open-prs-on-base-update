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

        console.info(`Waiting for workflow to cancel (attempt #${count})... ${data.owner}/${data.repo}/${data.ref}`);

        await new Promise(resolve => setTimeout(resolve, 4000));
        let workflowRun = await getWorkflowRunForBranch(octokit, data);
    
        if (workflowRun && workflowRun.status === 'completed') {
            break;
        }
    }
}

async function dispatchWorkflowEvent(octokit, data) {
    console.info(`Dispatching "workflow_dispatch"... ${data.owner}/${data.repo}/${data.ref}`);

    let workflowRun = await getWorkflowRunForBranch(octokit, data);

    if (workflowRun) {
        if (workflowRun.status !== 'completed') {
            await octokit.actions.cancelWorkflowRun({
                owner: data.owner,
                repo: data.repo,
                run_id: workflowRun.id
            });

            await waitForCanceledRun(octokit, data);
        }

        return octokit.actions.reRunWorkflow({
            owner: data.owner,
            repo: data.repo,
            run_id: workflowRun.id
        });
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

async function dispatchWorkflowEventToGithub(opts) {

    if (!opts || !opts.owner || !opts.repo || !opts.ref || !opts.token) {
        return Promise.reject(new Error('Invalid parameters'))
    }

    const data = {
        owner: opts.owner,
        repo: opts.repo,
        ref: opts.ref || 'heads/main',
        message: opts.message
    }

    const octokit = new Octokit({ auth: opts.token });

    return dispatchWorkflowEvent(octokit, data);
}

async function run() {

    const githubToken = core.getInput("github_token");

    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    const branch = github.context.ref.split("/").pop();

    const githubApiDomain = `https://api.github.com`;
    const authHeaders = {
        headers: {
            Authorization: "token " + githubToken,
            Accept: "application/vnd.github.v3+json"
        }
    };

    const openPrs = await fetch(`${githubApiDomain}/repos/${owner}/${repo}/pulls?state=open&base=${branch}`, authHeaders)
        .then(c => c.json())
        .then(prs => prs.filter(pr => !pr.user.login.includes("dependabot")));

    console.log(`Found ${openPrs.length} open PR(s) targeting '${branch}'`);

    const dispatches = openPrs.map(async pr => {
        console.log(`Re-triggering workflows on #${pr.number}: ${pr.title}`);

        await dispatchWorkflowEventToGithub({
            owner: pr.head.user.login,
            repo: repo,
            ref: pr.head.ref,
            token: githubToken
        })

        console.log(`Dispatched workflow on #${pr.number}: ${pr.title}`)
    });

    return Promise.all(dispatches);
}

run()
    .then(() => console.log("Finished."))
    .catch(e => core.setFailed(e.message));
