# Claude GitHub MCP Server

A GitHub MCP Server for Claude Desktop that gives Claude the ability to interact with GitHub pull requests.

<details>
<summary>Here's the JSON to copy</summary>

```
{
  "mcpServers": {
    "github-pr": {
      "command": "claude-github-mcp", 
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}

```

</details>

#### Quick install
```bash
npm install -g claude-github-mcp
```

## Features

- List and view pull requests from any GitHub repository
- Get detailed information about specific PRs
- Comment on pull requests
- Request reviewers for PRs
- Merge pull requests
- Summarize PR changes with diff highlighting
- Close/reject PRs with optional comments
- View PR test/CI status

### Usage

- `"Show me open PRs for microsoft/vscode"`
- `"Get details for PR #123 in owner/repo"`
- `"Summarize the changes in PR #456 for owner/repo"`
- `"Comment 'LGTM! Approving this change.' on PR #789 in owner/repo"`
- `"Request alice and bob as reviewers for PR #42 in owner/repo"`
- `"Merge PR #101 in owner/repo"`
- `"Close PR #202 in owner/repo with reason 'This approach won't work'"`

**Available Commands**

- `list-prs`: Lists pull requests for a repository  
- `discuss-pr`: Gets details about a specific PR  
- `summarize-pr`: Summarizes changes in a PR with diffs  
- `comment-on-pr`: Posts a comment on a PR  
- `request-reviewers`: Requests reviewers for a PR  
- `merge-pr`: Merges a PR  
- `close-pr`: Closes/rejects a PR  
- `check-ci-status`: Checks CI/test status of a PR

### Requirements
- Node.js 16+
- A GitHub account with an appropriate personal access token
- Claude Desktop

Enjoy!!

