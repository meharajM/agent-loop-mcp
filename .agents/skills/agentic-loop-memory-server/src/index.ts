#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import * as memory from "./memory.js";

const server = new Server({
  name: "agent-loop-mcp",
  version: "1.0.0",
}, {
  capabilities: {
    resources: {},
    tools: {},
  },
});

// Helper function to approximate word count
function approximateWordCount(text: string): number {
  return text.split(/\\s+/).length;
}

const CONTEXT_WARNING_THRESHOLD = 3000; // Words

/**
 * Handle listing resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [{
      uri: "loop://{session_id}",
      name: "Agent Loop State",
      description: "Reads the current active state and context for the autonomous agent loop.",
      mimeType: "text/markdown",
    }],
  };
});

/**
 * Handle reading resources.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (!uri.startsWith("loop://")) {
    throw new McpError(ErrorCode.InvalidRequest, "Invalid resource URI");
  }

  const sessionId = uri.replace("loop://", "");
  if (!sessionId) {
    throw new McpError(ErrorCode.InvalidRequest, "Missing session_id in URI");
  }

  const loopMemory = await memory.readMemory(sessionId);
  if (!loopMemory) {
    throw new McpError(ErrorCode.InvalidRequest, `No active loop found for session_id: ${sessionId}`);
  }

  const markdownPath = memory.getSessionFilePath(sessionId);
  const fs = await import('fs/promises');
  const rawContent = await fs.readFile(markdownPath, 'utf-8');

  return {
    contents: [{
      uri,
      mimeType: "text/markdown",
      text: rawContent,
    }],
  };
});

/**
 * Handle listing tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "init_loop",
        description: "Creates a new .md loop state file for the given session to start a continuous, autonomous task.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string", description: "A unique identifier for this loop session" },
            objective: { type: "string", description: "The overarching objective for the agent to achieve" },
          },
          required: ["session_id", "objective"],
        },
      },
      {
        name: "log_step",
        description: "Appends to the Active Context. Rejects if failed=true but no self_heal_strategy is provided. Warns if context is too large.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            action: { type: "string", description: "A short description of what was just done" },
            result: { type: "string", description: "The output, success, or failure message of the action" },
            failed: { type: "boolean", description: "Set to true if this step encountered an error or failed to achieve its micro-goal." },
            self_heal_strategy: { type: "string", description: "MANDATORY if failed=true. How you plan to fix this failure or what alternative tool you will explore next." },
          },
          required: ["session_id", "action", "result", "failed"],
        },
      },
      {
        name: "compact_memory",
        description: "Empties the Active Context and appends the AI-provided summary to the Compacted History.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            context_summary: { type: "string", description: "A highly condensed summary of the current Active Context to preserve important facts and outcomes." },
          },
          required: ["session_id", "context_summary"],
        },
      },
      {
        name: "report_blocker",
        description: "Updates state to STATUS_BLOCKED and asks for human intervention when absolutely stuck.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            reason: { type: "string", description: "The reason the loop is blocked and needs human help" },
          },
          required: ["session_id", "reason"],
        },
      },
      {
        name: "resume_loop",
        description: "Removes the block and adds human input context back into the loop.",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
            user_input: { type: "string", description: "The clarify or credentials provided by the human" },
          },
          required: ["session_id", "user_input"],
        },
      },
      {
        name: "get_tool_suggestions",
        description: "Ask this tool if you are stuck and don't know what other tools to use.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

/**
 * Handle executing tools.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  if (name === "get_tool_suggestions") {
    return {
      content: [{ type: "text", text: "To find alternative tools, ask the host application (like Claude or the MCP Client) to list all available tools on the network. Or simply think out loud about other standard file/terminal tools you might use. You must explore alternatives instead of retrying exactly the same action." }],
    };
  }

  const { session_id } = args as any;
  if (!session_id || typeof session_id !== 'string') {
    throw new McpError(ErrorCode.InvalidParams, "session_id is required for this tool.");
  }

  if (name === "init_loop") {
    const { objective } = args as any;
    
    let loopMemory = await memory.readMemory(session_id);
    if (loopMemory) {
      return { content: [{ type: "text", text: `Session ${session_id} already exists. Please pick a new session_id or read resource loop://${session_id} to continue.` }] };
    }

    loopMemory = {
      state: {
        session_id,
        status: "IN_PROGRESS",
        current_step: 0,
      },
      objective: objective,
      system_instructions: memory.DEFAULT_INSTRUCTIONS,
      active_context: "Session started.",
      compacted_history: "",
    };

    await memory.writeMemory(session_id, loopMemory);

    return {
      content: [{ type: "text", text: `Successfully initialized loop session ${session_id}. Please read resource loop://${session_id} to view your mission.` }],
    };
  }

  const loopMemory = await memory.readMemory(session_id);
  if (!loopMemory) {
    throw new McpError(ErrorCode.InvalidParams, `Session ${session_id} not found. Use init_loop first.`);
  }

  if (name === "log_step") {
    const { action, result, failed, self_heal_strategy } = args as any;
    
    if (loopMemory.state.status === "BLOCKED") {
      return { content: [{ type: "text", text: "Session is BLOCKED. Cannot log steps until resume_loop is called." }] };
    }

    // Strict validation for failed steps
    if (failed === true && (!self_heal_strategy || self_heal_strategy.trim() === '')) {
      return { 
        isError: true,
        content: [{ type: "text", text: "ERROR: You marked this step as failed (failed: true) but did not provide a 'self_heal_strategy'. You must think of a strategy to fix this issue or explore an alternative tool, and try logging this step again with the strategy attached." }] 
      };
    }

    loopMemory.state.current_step += 1;
    if (self_heal_strategy) {
      loopMemory.state.self_heal_strategy = self_heal_strategy;
    } else {
      // Clear previous strategy if we succeeded
      delete loopMemory.state.self_heal_strategy;
    }

    const timestamp = new Date().toISOString();
    loopMemory.active_context += `\n\n---\n**Step ${loopMemory.state.current_step}** [${timestamp}]\n*Action:* ${action}\n*Result:* ${result}`;

    await memory.writeMemory(session_id, loopMemory);

    let responseMessage = `Logged step ${loopMemory.state.current_step}.`;
    
    const wordCount = approximateWordCount(loopMemory.active_context);
    if (wordCount > CONTEXT_WARNING_THRESHOLD) {
      responseMessage += `\n\nWARNING: Active Context is now very large (${wordCount} words). You MUST call 'compact_memory' on your next turn to prevent window overflow.`;
    } else {
      responseMessage += ` (Context size: ${wordCount} words). Read loop://${session_id} if you lost track of the state.`;
    }

    return {
      content: [{ type: "text", text: responseMessage }],
    };
  }

  if (name === "compact_memory") {
    const { context_summary } = args as any;

    if (loopMemory.state.status === "BLOCKED") {
      return { content: [{ type: "text", text: "Session is BLOCKED. Cannot compact memory until resume_loop is called." }] };
    }

    const timestamp = new Date().toISOString();
    loopMemory.compacted_history += `\n\n**Summary up to Step ${loopMemory.state.current_step}** [${timestamp}]\n${context_summary}`;
    loopMemory.active_context = "Context was compacted. Resuming from summary...";

    await memory.writeMemory(session_id, loopMemory);

    return {
      content: [{ type: "text", text: "Successfully compacted memory. Context window footprint reduced. Read loop://" + session_id + " to perceive the compacted state." }],
    };
  }

  if (name === "report_blocker") {
    const { reason } = args as any;
    
    loopMemory.state.status = "BLOCKED";
    loopMemory.active_context += `\n\n***\n**BLOCKER REPORTED:**\n${reason}\n***\n`;

    await memory.writeMemory(session_id, loopMemory);

    return {
      content: [{ type: "text", text: `STATUS_BLOCKED: ${reason}. You must now STOP interacting with tools and explicitly ask the human user for clarification or help using your chat interface.` }],
    };
  }

  if (name === "resume_loop") {
    const { user_input } = args as any;

    if (loopMemory.state.status !== "BLOCKED") {
      return { content: [{ type: "text", text: "Session is not blocked, so nothing to resume." }] };
    }

    loopMemory.state.status = "IN_PROGRESS";
    loopMemory.active_context += `\n\n***\n**BLOCK RESOLVED (HUMAN INPUT):**\n${user_input}\n***\n`;

    await memory.writeMemory(session_id, loopMemory);

    return {
      content: [{ type: "text", text: "Session resumed. Check loop state and continue your self-healing loop." }],
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, "Tool not found");
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agent Loop MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
