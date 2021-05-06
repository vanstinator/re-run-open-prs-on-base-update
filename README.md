# Re-trigger Workflows on open PRs

GitHub Action to re-trigger Workflows on open PRs when a commit happens on these PRs' base branches.

### Motivation

When working on repositories where many PRs tend to be open at the same time, it's often difficult to keep track of which checks should be re-run or not. When a commit happens on a PR's target branch, it's a good practice to re-run the checks to prevent Semantic Conflicts from happening.

This GitHub Action simply identifies the open PRs targeting the branch where the action is running and will issue a workflow re-run to the Github API. If the workflow is currently running it will be canceled so it can be run again.

**NOTE:** The provided GitHub Token must be a Maintainer of the repository, otherwise it won't be able to push to PR branches. Also, the PRs to be updated must have "Allow edits from Maintainers" checked.

**NOTE:** The provided GitHub Token must have the `repo/public_repo` scope to be able to push commits.

### Usage

```yaml
name: "Re-trigger Workflows on open PRs"

on:
  push:
    # Here you can limit the branches where you want this action to be run
  
jobs:
  retrigger-workflows-on-open-prs:
    runs-on: ubuntu-latest

    steps:
      - uses: vanstinator/retrigger-workflows-on-open-prs@v1
        with:
          github_token: ${{ secrets.MY_TOKEN_WITH_MAINTAINER_PERMISSIONS }}
```
