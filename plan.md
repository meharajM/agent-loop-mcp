# agent-loop-mcp Plan & Analysis

## 1. Market Survey & Context

Based on recent developments in the Model Context Protocol (MCP) ecosystem and AI agent literature, the concept of mitigating context-window limits through loops and memory is highly relevant.
- **Context Rot & Limitations**: Smaller models struggle with long tasks because tool definitions, logs, and outputs quickly saturate their working memory (context window).
- **Existing Solutions**: Projects like *AgentCore Memory*, *OpenClaw Agent Loop*, and various "Context Mode" MCP servers exist. They mitigate limits via context trimming/compaction, external SQLite/Vector DB memories for long-term state, and specialized "sub-agent" routing.
- **OpenClaw Concept**: Inspired by OpenClaw, an effective agent loop handles run queues, streams events, and, most importantly, encompasses a "compaction pipeline." This means as the loop runs, older conversational/tool execution history is summarized and compacted to preserve context tokens for immediate, actionable space.

## 2. Critical Analysis of `agent-loop-mcp`

The premise is very sound but presents interesting architectural challenges. If an MCP server is to enable a small model to act like a large one by running "non-stop," there are two primary ways to architect this:

*   **Approach A: The State-Machine Toolkit (Client-driven)** 
    The MCP server provides tools like `start_task`, `log_step`, `compact_memory`, and `get_next_action`. The main client LLM calls these tools to persist its explicit thoughts and retrieve a summarized version of its past actions. *Challenge:* The client LLM is still running the loop and consuming tokens on its end.
*   **Approach B: The Sub-Agent Orchestrator (Server-driven)** *[Recommended]*
    The MCP server itself takes a high-level task from the client LLM via a tool like `delegate_long_task`. The MCP server then independently connects to a smaller/faster model (e.g., via Ollama, Groq, local APIs) and manages an internal autonomous loop. It handles tool execution, context compaction, and self-healing internally. Once the task completes or hits a hard blocker, it returns the result back to the main client LLM.

### Key Features Identified from Requirements
1. **Continuous Execution Loop**: Works non-stop until the designated objective is fulfilled.
2. **Context Compaction & Management**: Automatically prunes, summarizes, and compresses logs so context limits are never breached.
3. **Self-Healing**: If a tool fails or an error is encountered, the internal loop receives the error, updates its strategy, searches for alternate system tools, and tries again instead of immediately failing.
4. **Human-in-the-loop (Clarifications)**: When the loop detects ambiguity, dangerous actions, or unresolvable blockers, it pauses execution and explicitly requests human input.
5. **npx-based distribution**: Easily startable via a dynamic Node.js CLI script.

## 3. Architectural Clarifications

Based on user input, the architecture is finalized as follows:

1. **LLM Delegation**: The MCP server is purely an **intelligent memory/state-management wrapper**. The main AI client will call this server repeatedly. The server doesn't execute its own LLM calls; it tracks the loop, handles context compaction, and orchestrates the state.
2. **System Instructions & Self-Healing**: The server will provide explicit instructions back to the main LLM on how to iterate, how to explore tools, and how to perform self-healing when it encounters errors. The main LLM does the actual thinking and execution based on these instructions.
3. **User Clarifications**: When a blocker is detected, the server changes the state to a blocked state and returns an explicit `STATUS_BLOCKED` response to the main LLM, prompting the main LLM to ask the user.
4. **Memory Backend (.md files)**: The state and memory will be tracked using a `.md` file-based system.

### Critical Analysis of a `.md` File-Based Memory System

Using Markdown files (`.md`) as the persistence and memory layer for an agent loop is a fascinating and highly viable approach, especially for an MCP server focused on context management.

**Pros:**
*   **Ultimate Transparency & Hackability**: The developer (or user) can open the `.md` file in any editor to see exactly what the AI has done, what the current context is, and manually edit it to guide or correct the AI instantly ("human-in-the-loop" via text editing).
*   **LLM Native**: LLMs are exceptionally good at reading and generating Markdown. Passing a chunk of a `.md` file directly into the context window requires zero transformation or serialization/deserialization.
*   **No DB Dependencies**: No need for SQLite binaries or running servers. It keeps the open-source package incredibly lightweight and cross-platform.
*   **Version Control Ready**: Memory states can be committed to Git, allowing the AI to roll back or branching off different execution paths.

**Cons / Challenges:**
*   **Unstructured Nature / Parsing Brittle-ness**: Unlike JSON or a SQL DB, extracting a specific variable (like `retry_count`) from a `.md` file requires parsing Markdown (e.g., extracting from a specific section or parsing YAML frontmatter).
*   **Concurrency**: If multiple agents or processes try to read/write the `.md` file simultaneously, race conditions and file corruption can occur.
*   **Compaction Complexity**: To prevent the file from growing infinitely (and defeating the purpose of context extension), the MCP server must support a `compact_memory` tool. The calling *LLM* will generate the summarized text and pass it to this tool, which the server then cleanly inserts into the `# Compacted History` block. This keeps the server LLM-free while allowing intelligent summarization.

**Verdict & Implementation Strategy:**
For this use case, a `.md` file system is **excellent**, provided we give it a strict structure and handle it robustly. We can use a format that combines YAML frontmatter (for structured state) and Markdown body (for logs/memory). 
To mitigate concurrency issues (e.g., in multi-agent environments), the server will use robust file locking (e.g., `proper-lockfile`) and atomic file writes, coupled with schema validation on every read.

Example structure:
```markdown
---
status: "IN_PROGRESS"
session_id: "chat_123_unique_title"
current_step: 4
self_heal_strategy: "Currently exploring alternative search APIs because the filesystem grep failed."
---
# Objective
[The original goal]

# System Instructions (Read Only)
[Instructions for the LLM on self-healing, updating self_heal_strategy on errors, and tool exploration]

# Active Context (Detailed)
- Step 3 output
- Step 4 input

# Compacted History (Summarized)
Steps 1-2 successfully executed auth and DB setup.
```

### Self-Healing & Guardrails
To force even weak LLMs to act intelligently:
1. **Mandatory Self-Heal Strategy**: The `log_step` tool will accept a `failed` boolean flag. If `failed` is true, the `self_heal_strategy` argument becomes logically mandatory. If it is omitted, the MCP server will *reject* the tool call with an explicit error: `"You marked this step as failed but did not provide a self_heal_strategy. You must think of a strategy and try again."` This improves UX because it forces the AI to break out of a mindless repetition loop.
2. **Context Size Warnings**: Even with an LLM-driven `compact_memory` tool, an agent might forget to use it. The `log_step` response will automatically calculate the approximate size of the `Active Context`. If it exceeds a threshold (e.g., 3000 words), the tool will return a success message appended with a critical warning: `"WARNING: Active Context is now very large. You MUST call 'compact_memory' on your next turn to prevent context window overflow."`

### Bootstrapping & Discovery
How does the main LLM know this loop exists? While modern MCP clients inject tool descriptions into the system prompt automatically, a comprehensive approach is to export a `SKILL.md` file alongside the `package.json`.
The user will be instructed to install the MCP server and provide the `SKILL.md` to their AI (e.g., by adding it to their custom instructions, Claude Project knowledge, or passing it directly). This document will contain the exact sequence of how the AI should invoke `init_loop`, handle `STATUS_BLOCKED`, and manage `compact_memory`.

## 4. Proposed High-Level Plan

### Phase 1: Setup & Scaffolding
- Initialize a Node.js project.
- Configure `@modelcontextprotocol/sdk`.
- Setup TypeScript and an executable `bin` for `npx agent-loop-mcp`.
- Install necessary dependencies like `gray-matter` (for frontmatter parsing), `proper-lockfile` (for concurrency), and `zod` (for schema validation).

### Phase 2: Memory & File Management Core
- Implement the `.md` file parser/writer (atomic writes + locks + `gray-matter` parsing + zod validation against the schema).
- Implement the `compact_memory` logic that takes the LLM's summary, clears the `Active Context`, and appends the summary to `Compacted History`.

### Phase 3: Exposing MCP Tools & Resources
- **Resources**: Expose the current state `.md` file for a given `session_id` as an easily readable MCP Resource (e.g., `loop://{session_id}`).
- **Tools**:
  - `init_loop(session_id: string, objective: string)`: Creates a new `.md` loop state file for the given session.
  - `log_step(session_id: string, action: string, result: string, failed: boolean, self_heal_strategy?: string)`: Appends to the Active Context. Rejects if `failed=true` and no strategy provided. Returns context size warnings.
  - `report_blocker(session_id: string, reason: string)`: Updates state to `STATUS_BLOCKED` and asks for human intervention.
  - `resume_loop(session_id: string, user_input: string)`: Removes the block and adds user context.
  - `compact_memory(session_id: string, context_summary: string)`: Empties `Active Context` and adds the AI-provided `context_summary` to `Compacted History`.
  - `get_tool_suggestions()`: Lists available MCP tools registered on the network (if queryable) or provides guidance on how the AI should list tools.

### Phase 4: Integration & Documentation
- Write sample scripts to emulate the main LLM client interacting with the memory loop.
- Author the `SKILL.md` file to act as the canonical operating manual for any LLM client combining with this server.
