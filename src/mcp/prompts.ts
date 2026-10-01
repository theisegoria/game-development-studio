/**
 * The shipped skills, served as MCP prompts.
 *
 * Five SKILL.md files already say how to sequence these tools -- generate,
 * look, select, reconstruct, validate; plan, run, verify, compare -- and Codex
 * gets them as a plugin. Every other MCP client got nothing, and reinvented
 * the sequence badly or asked. Serving the same files as prompts gives every
 * client the same guidance from one source of truth, and costs nothing until
 * a prompt is actually requested.
 *
 * Only files the bundle's closed roster names are read. No globbing: the
 * roster is what the installer copies and what the release check hashes, so
 * it is what a prompt may contain.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listSkillBundle, packagedSkillsRoot, type PackagedSkill } from '../skills/bundle.js';

function promptName(skillId: string): string {
  // MCP prompt names are free-form, but every client tokenises snake_case
  // cleanly and the tool names already use it.
  return skillId.replaceAll('-', '_');
}

async function skillText(skill: PackagedSkill): Promise<string> {
  const root = path.join(packagedSkillsRoot(), skill.relativePath);
  const markdown = skill.files
    .map((file) => file.path)
    .filter((relative) => relative === 'SKILL.md' || (relative.startsWith('references/') && relative.endsWith('.md')))
    .sort((left, right) => (left === 'SKILL.md' ? -1 : right === 'SKILL.md' ? 1 : left.localeCompare(right)));
  const sections: string[] = [];
  for (const relative of markdown) {
    const text = await fs.readFile(path.join(root, relative), 'utf8');
    sections.push(relative === 'SKILL.md' ? text : `\n\n---\n\n<!-- ${relative} -->\n\n${text}`);
  }
  return sections.join('');
}

export async function registerSkillPrompts(server: McpServer): Promise<string[]> {
  const bundle = await listSkillBundle();
  const names: string[] = [];
  for (const skill of bundle.skills) {
    const name = promptName(skill.id);
    names.push(name);
    server.registerPrompt(
      name,
      { title: skill.displayName, description: skill.description },
      async () => ({
        messages: [{
          role: 'user',
          content: { type: 'text', text: await skillText(skill) },
        }],
      }),
    );
  }
  return names;
}
