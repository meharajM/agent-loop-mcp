# Agentic Loop Memory Server ♾️

Enable any AI model—especially smaller ones with limited context windows—to function with the persistence of high-end models. This project consists of an **MCP Server** for state management and an **Agent Skill** for orchestration.

## 🚀 Quick Start (Skill Installation)

Install the orchestration instructions into your AI agent (Claude Code, Cursor, etc.):

```bash
npx skills add meharajM/agent-loop-mcp --yes
```

## 🛠 MCP Server Setup

The skill requires the MCP server to be running. Add this to your `mcp_config.json`:

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

## 🌟 Key Features

- **Active Context Management**: Not just a search tool. It monitors your token/word count and forces a "Summarize & Compact" loop when needed.
- **Mandatory Self-Healing**: Every tool failure requires the AI to provide a new `self_heal_strategy`, preventing mindless retries.
- **Transparent Markdown Storage**: Your "brain" is stored in `~/.agent-loop-mcp/` as standard Markdown. You can inspect or edit it anytime.
- **Small Model Optimized**: Designed specifically for models like `Gemini Flash` and `GPT-4o-mini`.

## 📂 Project Structure

- `src/`: TypeScript source for the MCP server.
- `skills/agentic-loop/SKILL.md`: The instruction manual for the AI.
- `build/`: JavaScript artifacts.

## 📄 License

ISC
