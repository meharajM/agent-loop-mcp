---
name: Agentic Loop Memory Server
description: A powerful persistent memory and state-management system serving to allow any AI to execute autonomous agent loops, self-heal, and prevent context window exhaustion.
---

# Agentic Loop Memory Server Skill ♾️

This skill connects you to the \`@mhrj/mcp-agent-loop\` server. This server provides you with persistent memory, preventing you from forgetting your overarching goal or crashing due to context window limits when working on complex, multi-step tasks.

## How it Works

When you are asked to perform a complex, autonomous, or long-running task, you must rely on this MCP server instead of trying to hold the entire history in your immediate memory window.

**1. Start the Session**
Run the \`init_loop\` tool with a unique \`session_id\` (e.g. \`debug_auth_bug\`) and the \`objective\`.

**2. Read the State**
Read the MCP resource \`loop://{session_id}\`. This Markdown file is your "brain". It contains the Objective, your System Instructions, the Active Context (recent steps), and your Compacted History (what you completed hours/days ago).

**3. Act and Log**
Perform your normal tasks (running bash commands, editing files, searching). After *every significant action*, you MUST call the \`log_step\` tool:
- \`session_id\`: Your chosen ID.
- \`action\`: What you tried to do.
- \`result\`: The command output or file edit result.
- \`failed\`: A boolean. \`true\` if the command threw an error or didn't do what you expected. \`false\` if it succeeded.

**4. The Self-Healing Requirement (CRITICAL)**
If you set \`failed: true\` in \`log_step\`, you **MUST** provide a \`self_heal_strategy\`. 
This is because you are not allowed to mindlessly retry the same failing tool. If a grep search fails to find a variable, your \`self_heal_strategy\` might be: *"The variable isn't in \`src\`. I will search in the \`lib\` directory or look for tool suggestions."*
If you forget the \`self_heal_strategy\`, the \`log_step\` tool will explicitly reject your call and make you try again.

**5. The Compaction Requirement (CRITICAL)**
If you run for a long time, the \`Active Context\` in your state file will grow too large, causing you to crash or hallucinate. 
When \`log_step\` returns a warning that the context is too large (e.g., >3000 words), you **MUST** immediately stop working on the task and call the \`compact_memory\` tool.
- \`context_summary\`: You must look at the Active Context and write a dense, 2-3 paragraph summary of what was achieved and what the current state is. The server will wipe the Active Context and permanently store your summary.

**6. Asking the Human**
If you hit an absolute dead end (e.g., missing API keys, ambiguous requirements, infinite error loops), do NOT guess. Call the \`report_blocker\` tool. Doing this will pause the loop, allowing you to ask the human user for help via standard chat. Once the human replies, use the \`resume_loop\` tool to inject their input back into the state file.

## Expected Behavior

You are expected to act like a senior engineer. Do not give up easily. If an action fails, use your reasoning to devise a new \`self_heal_strategy\`. If you exhaust all local tools, call \`get_tool_suggestions\` to remind yourself how to break out of the box.
