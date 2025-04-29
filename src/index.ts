import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Octokit } from "@octokit/core";
import { z } from "zod";

// Initialize GitHub API client with your PAT
const octokit = new Octokit({ auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN });

// Create MCP server
const server = new McpServer({
  name: "GitHub PR Server",
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

// New tool: List all PRs in a repository
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