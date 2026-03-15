# Agentic Loop Memory Server ♾️

**The industry-standard persistent memory and state manager for long-running agentic workflows.**

Enable any AI model—especially smaller ones with limited context windows—to function with the persistence of high-end models. This project works as a two-part ecosystem: an **MCP Server** for state management and an **Agent Skill** for orchestration.

## 🛠 Complete Setup (Required)

For the best experience, you must install **both** the orchestration skill and the MCP server.

### 1. Install the Skill
Install instructions into your AI agent (Claude Code, Cursor, etc.):
```bash
npx skills add meharajM/agent-loop-mcp --yes
```

### 2. Configure the MCP Server
Add the following to your \`mcp_config.json\`:
```json
{
  "mcpServers": {
    "agent-loop": {
      "command": "npx",
      "args": ["-y", "@mhrj/mcp-agent-loop"]
    }
  }
}
```

## 🌟 Why this approach is unique
Unlike passive memory tools, this is an **Active State Manager**. It monitors word counts to trigger compaction cycles and enforces a "Self-Healing Strategy" on every failure, preventing AI agents from getting stuck in mindless loops.

## 📂 Project Structure

- `src/`: TypeScript source for the MCP server.
- `skills/agentic-loop/SKILL.md`: The instruction manual for the AI.
- `build/`: JavaScript artifacts.

## 📄 License

ISC
