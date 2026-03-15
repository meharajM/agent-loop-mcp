import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { z } from 'zod';
import * as lockfile from 'proper-lockfile';
import * as os from 'os';

export const AgentStateSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'FAILED']).default('IN_PROGRESS'),
  session_id: z.string(),
  current_step: z.number().default(0),
  self_heal_strategy: z.string().optional(),
  last_updated: z.string().optional(),
});

export type AgentState = z.infer<typeof AgentStateSchema>;

export interface LoopMemory {
  state: AgentState;
  objective: string;
  system_instructions: string;
  active_context: string;
  compacted_history: string;
}

const MEMORY_DIR = path.join(os.homedir(), '.agent-loop-mcp');

// Ensure memory directory exists
if (!fsSync.existsSync(MEMORY_DIR)) {
  fsSync.mkdirSync(MEMORY_DIR, { recursive: true });
}

export function getSessionFilePath(sessionId: string): string {
  // Sanitize session id to avoid path traversal
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(MEMORY_DIR, `${sanitized}.md`);
}

/**
 * Parses the Markdown file into structured LoopMemory.
 * Uses gray-matter to separate frontmatter and markdown body.
 */
export async function readMemory(sessionId: string): Promise<LoopMemory | null> {
  const filePath = getSessionFilePath(sessionId);
  try {
    const rawContent = await fs.readFile(filePath, 'utf-8');
    const { data, content } = matter(rawContent);

    // Validate frontmatter
    const state = AgentStateSchema.parse(data);

    // Naive parsing of sections
    const objectiveMatch = content.match(/# Objective\n([\s\S]*?)(?=\n# System Instructions \(Read Only\)|\n# Active Context \(Detailed\)|\n# Compacted History \(Summarized\)|$)/);
    const instructionsMatch = content.match(/# System Instructions \(Read Only\)\n([\s\S]*?)(?=\n# Active Context \(Detailed\)|\n# Compacted History \(Summarized\)|$)/);
    const contextMatch = content.match(/# Active Context \(Detailed\)\n([\s\S]*?)(?=\n# Compacted History \(Summarized\)|$)/);
    const historyMatch = content.match(/# Compacted History \(Summarized\)\n([\s\S]*?)$/);

    return {
      state,
      objective: objectiveMatch ? objectiveMatch[1].trim() : '',
      system_instructions: instructionsMatch ? instructionsMatch[1].trim() : '',
      active_context: contextMatch ? contextMatch[1].trim() : '',
      compacted_history: historyMatch ? historyMatch[1].trim() : ''
    };
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Writes the structured LoopMemory back to the Markdown file atomically with a file lock.
 */
export async function writeMemory(sessionId: string, memory: LoopMemory): Promise<void> {
  const filePath = getSessionFilePath(sessionId);
  
  // Ensure the file exists before locking
  let fileExisted = true;
  if (!fsSync.existsSync(filePath)) {
    await fs.writeFile(filePath, '', 'utf-8');
    fileExisted = false;
  }

  let release;
  try {
    release = await lockfile.lock(filePath, { retries: 5 });
    
    // Update timestamp
    memory.state.last_updated = new Date().toISOString();
    
    const markdownContent = `
# Objective
${memory.objective}

# System Instructions (Read Only)
${memory.system_instructions}

# Active Context (Detailed)
${memory.active_context}

# Compacted History (Summarized)
${memory.compacted_history}
`.trim();

    const fileContent = matter.stringify(markdownContent, memory.state as any);
    
    // Write atomically (write to temp then rename)
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, fileContent, 'utf-8');
    await fs.rename(tempPath, filePath);
  } finally {
    if (release) {
      await release();
    }
  }
}

export const DEFAULT_INSTRUCTIONS = `
You are in a continuous self-healing loop. Your goal is to achieve the Objective. 
1. Use \`log_step\` to report actions you take and their results.
2. If an action fails or you encounter an error, do NOT give up. You MUST analyze the failure, set \`failed: true\` in \`log_step\`, and provide a \`self_heal_strategy\`.
3. If the \`active_context\` gets too long, \`log_step\` will warn you. You MUST immediately use \`compact_memory\` to summarize older context and free up space.
4. If you hit an absolute dead end that requires human permissions, credentials, or fundamentally ambiguous clarification, use \`report_blocker\`.
`.trim();
