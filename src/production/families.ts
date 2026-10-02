import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { digest, recipeSchema, RecipeStore, type Recipe } from './recipes.js';
import { invalidInput, invalidState } from '../util/errors.js';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/);
export const familySchema = z.object({
  schema: z.literal('game_dev.asset_family.v1'), id,
  style: z.string().min(1).max(400), palette: z.array(z.string().min(1).max(60)).min(1).max(8),
  scaleMeters: z.number().positive().max(10000), namingPrefix: id,
  members: z.array(z.object({ id, description: z.string().min(1).max(1000) })).min(2).max(64),
  template: recipeSchema,
}).strict();
type Family = z.infer<typeof familySchema>;
const recordSchema = z.object({ family: familySchema, sampleRecipeId: z.string(), approval: z.object({ digest: z.string(), reviewer: z.string(), reviewedAt: z.string() }).optional() });
export class FamilyStore {
  constructor(readonly root: string, readonly recipes: RecipeStore) {}
  private target(familyId: string) { return path.join(this.root, `${id.parse(familyId)}.json`); }
  async read(familyId: string) { return recordSchema.parse(JSON.parse(await fs.readFile(this.target(familyId), 'utf8'))); }
  private memberRecipe(family: Family, index: number, approvalDigest?: string): Recipe {
    const member = family.members[index]; if (!member) throw invalidInput('Missing family member');
    const name = `${family.namingPrefix}_${member.id}`;
    const values: Record<string, string> = { name, description: member.description, style: family.style, palette: family.palette.join(', '), scaleMeters: String(family.scaleMeters) };
    const substitute = (value: unknown): unknown => {
      if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
      if (Array.isArray(value)) return value.map(substitute);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
      return value;
    };
    const recipe = recipeSchema.parse(substitute(family.template));
    recipe.id = `${family.id}_${member.id}`; recipe.name = name;
    recipe.family = { id: family.id, member: member.id, sample: index === 0, approvalDigest };
    for (const step of recipe.steps) {
      if (['create_3d_asset', 'generate_asset_reference'].includes(step.operation)) {
        const supplied = step.arguments.spec && typeof step.arguments.spec === 'object' ? step.arguments.spec : {};
        step.arguments.spec = { ...supplied, name, description: member.description, dimensionsMeters: { width: family.scaleMeters, height: family.scaleMeters, depth: family.scaleMeters }, artDirection: { style: family.style, palette: family.palette } };
        if (typeof step.arguments.textPrompt === 'string') step.arguments.textPrompt += `; ${family.style}; palette: ${family.palette.join(', ')}; target size ${family.scaleMeters} meters`;
      }
      if (step.operation === 'build_asset_package') step.arguments.name = name;
    }
    return recipe;
  }
  async create(input: unknown) {
    const family = familySchema.parse(input);
    if (new Set(family.members.map(m => m.id)).size !== family.members.length) throw invalidInput('Duplicate family members');
    if (!family.template.steps.some(s => s.operation === 'validate_game_asset') || !family.template.steps.some(s => s.operation === 'build_asset_package')) throw invalidInput('Family template must validate and package the sample.');
    await fs.mkdir(this.root, { recursive: true });
    // Exclusive family creation prevents replacing an approved family under existing recipes.
    const record = { family, sampleRecipeId: `${family.id}_${family.members[0]?.id}` };
    await fs.writeFile(this.target(family.id), JSON.stringify(record, null, 2), { flag: 'wx' });
    try { await this.recipes.save(this.memberRecipe(family, 0)); } catch (error) { await fs.unlink(this.target(family.id)); throw error; }
    return record;
  }
  private async sampleDigest(record: z.infer<typeof recordSchema>) {
    const sample = await this.recipes.read(record.sampleRecipeId);
    if (digest(sample.recipe) !== digest(this.memberRecipe(record.family, 0))) throw invalidState('Sample recipe no longer matches its approved family template; create a new family revision.');
    const plan = await this.recipes.plan(record.sampleRecipeId);
    if (!plan.steps.every(s => s.status === 'complete')) throw invalidState('Sample must complete validation and packaging before visual approval and expansion.');
    return digest({ family: record.family, sample: await this.recipes.read(record.sampleRecipeId) });
  }
  async planApproval(familyId: string) {
    const record = await this.read(familyId);
    return { sampleRecipeId: record.sampleRecipeId, sample: await this.recipes.read(record.sampleRecipeId), approvalDigest: await this.sampleDigest(record) };
  }
  async approve(familyId: string, approvedDigest: string, reviewer: string) {
    const record = await this.read(familyId);
    if (await this.sampleDigest(record) !== approvedDigest) throw invalidState('Sample approval is stale; review the current sample.');
    record.approval = { digest: approvedDigest, reviewer, reviewedAt: new Date().toISOString() };
    // Immutable exclusive approval sidecar; avoids two writers clobbering decisions.
    await fs.writeFile(`${this.target(familyId)}.approval`, JSON.stringify(record.approval), { flag: 'wx' });
    return record.approval;
  }
  async assertApproved(familyId: string, expected?: string) {
    const record = await this.read(familyId);
    const approval = z.object({ digest: z.string(), reviewer: z.string(), reviewedAt: z.string() }).parse(JSON.parse(await fs.readFile(`${this.target(familyId)}.approval`, 'utf8')));
    if (approval.digest !== await this.sampleDigest(record) || (expected && expected !== approval.digest)) throw invalidState('Family sample or inputs changed; create a new family revision and approve its sample.');
    return { record, approval };
  }
  async expand(familyId: string) {
    const { record, approval } = await this.assertApproved(familyId);
    const recipes = [];
    for (let i = 1; i < record.family.members.length; i++) {
      const recipe = this.memberRecipe(record.family, i, approval.digest);
      let existing;
      try { existing = await this.recipes.read(recipe.id); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (existing) { if (digest(existing.recipe) !== digest(recipe)) throw invalidState('Expanded recipe conflicts with existing recipe'); }
      else await this.recipes.save(recipe);
      recipes.push(recipe);
    }
    return { familyId, recipes, note: 'Expansion creates recipes only. Each operation requires fresh authorization; no provider calls have run.' };
  }
}
