#!/usr/bin/env node

// Import and run the server
import('../dist/index.js').catch(error => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});