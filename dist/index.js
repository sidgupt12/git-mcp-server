import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/core";
import { z } from "zod";
// Initialize GitHub API client with your PAT
const octokit = new Octokit({ auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN });
// Create MCP server
const server = new McpServer({
    name: "Claude GitHub MCP Server",
    version: "1.0.0",
});
// Resource: List active pull requests for a repository
server.resource("pull-requests", new ResourceTemplate("github://{owner}/{repo}/pulls", { list: undefined }), async (uri, params) => {
    try {
        // Ensure owner and repo are strings
        const owner = Array.isArray(params.owner) ? params.owner[0] : params.owner;
        const repo = Array.isArray(params.repo) ? params.repo[0] : params.repo;
        // Debug logging to stderr
        console.error(`Parsed URI: ${uri.href}, owner: ${owner}, repo: ${repo}`);
        if (!owner || !repo) {
            throw new Error("Invalid owner or repo provided");
        }
        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
            owner,
            repo,
            state: "open",
        });
        const prs = response.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            created_at: pr.created_at,
        }));
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify(prs, null, 2),
                },
            ],
        };
    }
    catch (error) {
        console.error("Error in pull-requests resource:", error);
        return {
            contents: [
                {
                    uri: uri.href,
                    text: `Error fetching pull requests: ${error.message}`,
                },
            ],
        };
    }
});
// Tool: Discuss or get details about a specific pull request
server.tool("discuss-pr", {
    owner: z.string(),
    repo: z.string(),
    prNumber: z.number().optional(), // Make PR number optional
    query: z.string().optional(),
}, async ({ owner, repo, prNumber, query }) => {
    try {
        // If no PR number provided, list all open PRs
        if (prNumber === undefined) {
            const response = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
                owner,
                repo,
                state: "open",
            });
            const prs = response.data.map((pr) => ({
                number: pr.number,
                title: pr.title,
                url: pr.html_url,
                state: pr.state,
                created_at: pr.created_at,
                user: pr.user?.login,
            }));
            return {
                content: [
                    {
                        type: "text",
                        text: `Open PRs for ${owner}/${repo}:\n\n${JSON.stringify(prs, null, 2)}`,
                    },
                ],
            };
        }
        // Otherwise get specific PR details
        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner,
            repo,
            pull_number: prNumber,
        });
        const pr = response.data;
        const prDetails = {
            number: pr.number,
            title: pr.title,
            body: pr.body || "No description provided",
            url: pr.html_url,
            state: pr.state,
            created_at: pr.created_at,
            user: pr.user?.login,
        };
        const contentText = query
            ? `Discussion query for PR #${prNumber}: ${query}\n\nDetails:\n${JSON.stringify(prDetails, null, 2)}`
            : `Details for PR #${prNumber}:\n${JSON.stringify(prDetails, null, 2)}`;
        return {
            content: [
                {
                    type: "text",
                    text: contentText,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error in discuss-pr tool:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error fetching PR ${prNumber ? `#${prNumber}` : 's'}: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
//tool: List all PRs in a repository
server.tool("list-prs", {
    owner: z.string(),
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).default("open"),
}, async ({ owner, repo, state }) => {
    try {
        const response = await octokit.request("GET /repos/{owner}/{repo}/pulls", {
            owner,
            repo,
            state,
        });
        const prs = response.data.map((pr) => ({
            number: pr.number,
            title: pr.title,
            url: pr.html_url,
            state: pr.state,
            created_at: pr.created_at,
            user: pr.user?.login,
        }));
        return {
            content: [
                {
                    type: "text",
                    text: `${state.charAt(0).toUpperCase() + state.slice(1)} PRs for ${owner}/${repo}:\n\n${JSON.stringify(prs, null, 2)}`,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error in list-prs tool:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error fetching PRs: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
//Tool: To comment on a PR
server.tool("comment-on-pr", {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    comment: z.string().describe("Comment text to post"),
}, async ({ owner, repo, prNumber, comment }) => {
    try {
        const response = await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
            owner,
            repo,
            issue_number: prNumber, // PRs are issues in GitHub's API
            body: comment,
        });
        return {
            content: [
                {
                    type: "text",
                    text: `✅ Comment posted on PR #${prNumber}: "${comment.substring(0, 50)}${comment.length > 50 ? '...' : ''}"`,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error posting comment:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error posting comment: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool: Request reviewers for a PR
server.tool("request-reviewers", {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    reviewers: z.array(z.string()).describe("GitHub usernames to request as reviewers"),
}, async ({ owner, repo, prNumber, reviewers }) => {
    try {
        const response = await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers", {
            owner,
            repo,
            pull_number: prNumber,
            reviewers,
        });
        return {
            content: [
                {
                    type: "text",
                    text: `✅ Requested ${reviewers.length} reviewer(s) for PR #${prNumber}: ${reviewers.join(", ")}`,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error requesting reviewers:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error requesting reviewers: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool: Merge a PR
server.tool("merge-pr", {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    commitTitle: z.string().optional().describe("Optional title for the merge commit"),
    commitMessage: z.string().optional().describe("Optional message for the merge commit"),
}, async ({ owner, repo, prNumber, commitTitle, commitMessage }) => {
    try {
        // First, check if PR is mergeable
        const prResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner,
            repo,
            pull_number: prNumber,
        });
        if (!prResponse.data.mergeable) {
            return {
                content: [
                    {
                        type: "text",
                        text: `⚠️ PR #${prNumber} is not mergeable. It may have conflicts that need to be resolved.`,
                    },
                ],
            };
        }
        // If mergeable, perform the merge
        const mergeResponse = await octokit.request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge", {
            owner,
            repo,
            pull_number: prNumber,
            commit_title: commitTitle,
            commit_message: commitMessage,
            merge_method: "merge",
        });
        return {
            content: [
                {
                    type: "text",
                    text: `✅ Successfully merged PR #${prNumber}!`,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error merging PR:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error merging PR: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool: Summarize PR changes
server.tool("summarize-pr", {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
}, async ({ owner, repo, prNumber }) => {
    try {
        // Get PR details
        const prResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner,
            repo,
            pull_number: prNumber,
        });
        const pr = prResponse.data;
        // Get PR files
        const filesResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
            owner,
            repo,
            pull_number: prNumber,
        });
        const files = filesResponse.data;
        // Prepare a summary of the changes
        const fileChanges = files.map(file => ({
            filename: file.filename,
            status: file.status, // added, modified, removed
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch?.substring(0, 500) // Truncate patch for readability
        }));
        // Format a summary for Claude to explain
        const summary = {
            title: pr.title,
            description: pr.body || "No description provided",
            changedFiles: files.length,
            totalAdditions: files.reduce((sum, file) => sum + file.additions, 0),
            totalDeletions: files.reduce((sum, file) => sum + file.deletions, 0),
            files: fileChanges
        };
        return {
            content: [
                {
                    type: "text",
                    text: `# PR #${prNumber} Summary\n\n` +
                        `**Title**: ${summary.title}\n\n` +
                        `**Description**:\n${summary.description}\n\n` +
                        `**Changes**: ${summary.changedFiles} files changed, ` +
                        `${summary.totalAdditions} additions, ${summary.totalDeletions} deletions\n\n` +
                        `## Modified Files\n\n` +
                        files.map(file => `- **${file.filename}** (${file.status}): +${file.additions} -${file.deletions}\n` +
                            (file.patch ? `\`\`\`diff\n${file.patch.substring(0, 300)}${file.patch.length > 300 ? '...' : ''}\n\`\`\`\n` : '')).join('\n\n')
                },
            ],
        };
    }
    catch (error) {
        console.error("Error summarizing PR:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error summarizing PR: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Tool: Close a PR (reject without merging)
server.tool("close-pr", {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    reason: z.string().optional().describe("Optional reason for closing the PR"),
}, async ({ owner, repo, prNumber, reason }) => {
    try {
        // First, check the current PR state
        const prResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
            owner,
            repo,
            pull_number: prNumber,
        });
        if (prResponse.data.state !== "open") {
            return {
                content: [
                    {
                        type: "text",
                        text: `PR #${prNumber} is already ${prResponse.data.state}. No action taken.`,
                    },
                ],
            };
        }
        // Close the PR using the issues endpoint (PRs are issues in GitHub's API)
        await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
            owner,
            repo,
            issue_number: prNumber,
            state: "closed",
        });
        // If a reason is provided, add it as a comment
        if (reason) {
            await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
                owner,
                repo,
                issue_number: prNumber,
                body: `Closing this PR: ${reason}`,
            });
        }
        return {
            content: [
                {
                    type: "text",
                    text: `✅ PR #${prNumber} has been closed${reason ? ` with reason: ${reason}` : ""}.`,
                },
            ],
        };
    }
    catch (error) {
        console.error("Error closing PR:", error);
        return {
            content: [
                {
                    type: "text",
                    text: `Error closing PR: ${error.message}`,
                },
            ],
            isError: true,
        };
    }
});
// Start the server with stdio transport
async function startServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP server started. Ready to interact with Claude Desktop.");
}
startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
