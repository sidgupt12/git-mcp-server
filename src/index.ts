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
server.resource(
  "pull-requests",
  new ResourceTemplate("github://{owner}/{repo}/pulls", { list: undefined }),
  async (uri, params: { [key: string]: string | string[] }) => {
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
    } catch (error) {
      console.error("Error in pull-requests resource:", error);
      return {
        contents: [
          {
            uri: uri.href,
            text: `Error fetching pull requests: ${(error as Error).message}`,
          },
        ],
      };
    }
  }
);

// Tool: Discuss or get details about a specific pull request
server.tool(
  "discuss-pr",
  {
    owner: z.string(),
    repo: z.string(),
    prNumber: z.number().optional(), // Make PR number optional
    query: z.string().optional(),
  },
  async ({ owner, repo, prNumber, query }) => {
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
    } catch (error) {
      console.error("Error in discuss-pr tool:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error fetching PR ${prNumber ? `#${prNumber}` : 's'}: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

//tool: List all PRs in a repository
server.tool(
  "list-prs",
  {
    owner: z.string(),
    repo: z.string(),
    state: z.enum(["open", "closed", "all"]).default("open"),
  },
  async ({ owner, repo, state }) => {
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
    } catch (error) {
      console.error("Error in list-prs tool:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error fetching PRs: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

//Tool: To comment on a PR
server.tool(
  "comment-on-pr",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    comment: z.string().describe("Comment text to post"),
  },
  async ({ owner, repo, prNumber, comment }) => {
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
    } catch (error) {
      console.error("Error posting comment:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error posting comment: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Request reviewers for a PR
server.tool(
  "request-reviewers",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    reviewers: z.array(z.string()).describe("GitHub usernames to request as reviewers"),
  },
  async ({ owner, repo, prNumber, reviewers }) => {
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
    } catch (error) {
      console.error("Error requesting reviewers:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error requesting reviewers: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Merge a PR
server.tool(
  "merge-pr",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    commitTitle: z.string().optional().describe("Optional title for the merge commit"),
    commitMessage: z.string().optional().describe("Optional message for the merge commit"),
  },
  async ({ owner, repo, prNumber, commitTitle, commitMessage }) => {
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
    } catch (error) {      
      console.error("Error merging PR:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error merging PR: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);          

// Tool: Summarize PR changes
server.tool(
  "summarize-pr",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
  },
  async ({ owner, repo, prNumber }) => {
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
                  files.map(file => 
                    `- **${file.filename}** (${file.status}): +${file.additions} -${file.deletions}\n` +
                    (file.patch ? `\`\`\`diff\n${file.patch.substring(0, 300)}${file.patch.length > 300 ? '...' : ''}\n\`\`\`\n` : '')
                  ).join('\n\n')
          },
        ],
      };
    } catch (error) {
      console.error("Error summarizing PR:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error summarizing PR: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Close a PR (reject without merging)
server.tool(
  "close-pr",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
    reason: z.string().optional().describe("Optional reason for closing the PR"),
  },
  async ({ owner, repo, prNumber, reason }) => {
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
    } catch (error) {
      console.error("Error closing PR:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error closing PR: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Create a new GitHub repository with initial files
server.tool(
  "create-repository",
  {
    owner: z.string().optional().describe("GitHub username (defaults to authenticated user)"),
    name: z.string().describe("Name of the repository to create"),
    description: z.string().optional().describe("Optional description for the repository"),
    private: z.boolean().default(false).describe("Whether the repository should be private"),
    files: z.array(
      z.object({
        path: z.string().describe("File path including name (e.g. 'README.md' or 'src/index.js')"),
        content: z.string().describe("Content of the file"),
      })
    ).optional().describe("Initial files to create in the repository"),
    initializeWithReadme: z.boolean().default(true).describe("Whether to initialize with a README")
  },
  async ({ owner, name, description, private: isPrivate, files, initializeWithReadme }) => {
    try {
      // First, create the repository
      const createParams: {
        name: string;
        description?: string;
        private: boolean;
        auto_init: boolean;
        owner?: string;
      } = {
        name,
        description: description || "",
        private: isPrivate,
        auto_init: initializeWithReadme,
      };
      
      // Use user endpoint if owner isn't specified, or org endpoint if it is
      let createRepoResponse;
      if (!owner) {
        createRepoResponse = await octokit.request("POST /user/repos", createParams);
      } else {
        createRepoResponse = await octokit.request("POST /orgs/{org}/repos", {
          org: owner,
          ...createParams
        });
      }
      
      const repoData = createRepoResponse.data;
      const repoOwner = repoData.owner.login;
      const repo = repoData.name;
      const defaultBranch = repoData.default_branch;
      
      // If no files provided and we initialized with README, we're done
      if ((!files || files.length === 0) && initializeWithReadme) {
        return {
          content: [
            {
              type: "text",
              text: `✅ Repository created successfully!\n\nName: ${name}\nOwner: ${repoOwner}\nVisibility: ${isPrivate ? 'Private' : 'Public'}\nURL: ${repoData.html_url}\n\nInitialized with README.md`
            },
          ],
        };
      }
      
      // If files were provided, we need to create them
      if (files && files.length > 0) {
        // First, we need to get the SHA of the latest commit on the default branch
        const refResponse = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
          owner: repoOwner,
          repo,
          ref: `heads/${defaultBranch}`,
        });
        
        const latestCommitSha = refResponse.data.object.sha;
        
        // Create blobs for all files
        const blobResults = await Promise.all(
          files.map(file => 
            octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
              owner: repoOwner,
              repo,
              content: Buffer.from(file.content).toString('base64'),
              encoding: "base64",
            })
          )
        );
        
        // Get the current tree
        const treeResponse = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
          owner: repoOwner,
          repo,
          tree_sha: latestCommitSha,
          recursive: "true",
        });
        
        // Create a new tree with the new files
        const treeItems = files.map((file, i) => ({
          path: file.path,
          mode: "100644" as const, // Regular file
          type: "blob" as const,
          sha: blobResults[i].data.sha,
        }));
        
        const newTree = await octokit.request("POST /repos/{owner}/{repo}/git/trees", {
          owner: repoOwner,
          repo,
          base_tree: treeResponse.data.sha,
          tree: treeItems,
        });
        
        // Create a new commit
        const commitResponse = await octokit.request("POST /repos/{owner}/{repo}/git/commits", {
          owner: repoOwner,
          repo,
          message: "Add initial files",
          tree: newTree.data.sha,
          parents: [latestCommitSha],
        });
        
        // Update the reference to point to the new commit
        await octokit.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
          owner: repoOwner,
          repo,
          ref: `heads/${defaultBranch}`,
          sha: commitResponse.data.sha,
        });
        
        const fileList = files.map(f => `- ${f.path}`).join('\n');
        
        return {
          content: [
            {
              type: "text",
              text: `✅ Repository created successfully!\n\nName: ${name}\nOwner: ${repoOwner}\nVisibility: ${isPrivate ? 'Private' : 'Public'}\nURL: ${repoData.html_url}\n\nAdded ${files.length} files:\n${fileList}`
            },
          ],
        };
      }
      
      // Default response if no files were added and no README
      return {
        content: [
          {
            type: "text",
            text: `✅ Repository created successfully!\n\nName: ${name}\nOwner: ${repoOwner}\nVisibility: ${isPrivate ? 'Private' : 'Public'}\nURL: ${repoData.html_url}`
          },
        ],
      };
      
    } catch (error) {
      console.error("Error creating repository:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error creating repository: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// Tool: Delete a GitHub repository
server.tool(
  "delete-repository",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    confirmation: z.boolean().describe("Confirmation to delete (must be true)")
  },
  async ({ owner, repo, confirmation }) => {
    try {
      // Safety check - require explicit confirmation
      if (!confirmation) {
        return {
          content: [
            {
              type: "text",
              text: "⚠️ Repository deletion aborted. The 'confirmation' parameter must be set to true to proceed with deletion."
            }
          ],
        };
      }
      
      // Check if repository exists first
      try {
        await octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo
        });
      } catch (error) {
        if ((error as any).status === 404) {
          return {
            content: [
              {
                type: "text",
                text: `⚠️ Repository ${owner}/${repo} does not exist or you don't have access to it.`
              }
            ],
            isError: true
          };
        }
        throw error;
      }
      
      // Perform the deletion
      await octokit.request("DELETE /repos/{owner}/{repo}", {
        owner,
        repo
      });
      
      return {
        content: [
          {
            type: "text",
            text: `🗑️ Repository ${owner}/${repo} has been successfully deleted.`
          }
        ]
      };
    } catch (error) {
      console.error("Error deleting repository:", error);
      
      // Provide more specific error messages for common issues
      let errorMessage = `Error deleting repository: ${(error as Error).message}`;
      
      if ((error as any).status === 403) {
        errorMessage = `You don't have permission to delete the repository ${owner}/${repo}. Make sure your GitHub token has the necessary permissions.`;
      } else if ((error as any).status === 404) {
        errorMessage = `Repository ${owner}/${repo} not found. It may have already been deleted or you might not have access to it.`;
      } else if ((error as any).status === 401) {
        errorMessage = "Authentication failed. Check your GitHub token.";
      }
      
      return {
        content: [
          {
            type: "text",
            text: errorMessage
          }
        ],
        isError: true
      };
    }
  }
);



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


