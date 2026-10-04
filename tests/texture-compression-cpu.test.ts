import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { compressTextureVariant } from '../src/production/compression.js';
import { BASIS_COMMIT, BASIS_VERSION, requireBasis, runBasis } from '../src/production/basis.js';
import { encodePNG } from '../src/inspection/image.js';
import { inspectGltf } from '../src/inspection/gltf.js';
import { readAssetPackage } from '../src/packages/format.js';
import { compareRunVisuals } from '../src/harness/visual.js';
import { createAssetReview, decideAssetReview, packageReviewedAsset } from '../src/review/workspace.js';
import { previewGlb } from '../src/review/previews.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const verifierModule = await import(new URL('../scripts/verify-texture-compression.mjs', import.meta.url).href) as {
  assertRealBasisReport: (tests: unknown) => void;
  REQUIRED_BASIS_REVIEW_CASES: string[];
};
const { assertRealBasisReport, REQUIRED_BASIS_REVIEW_CASES } = verifierModule;

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('Basis CPU report verification', () => {
  it('requires both codec review cases to pass and rejects a skipped case', () => {
    const passed = {
      numTotalTests: 2,
      numPassedTests: 2,
      numPendingTests: 0,
      numFailedTests: 0,
      testResults: [{ assertionResults: REQUIRED_BASIS_REVIEW_CASES.map((title: string) => ({ title, status: 'passed' })) }],
    };
    expect(() => assertRealBasisReport(passed)).not.toThrow();
    expect(() => assertRealBasisReport({
      ...passed,
      numPassedTests: 1,
      numPendingTests: 1,
      testResults: [{ assertionResults: [
        { title: REQUIRED_BASIS_REVIEW_CASES[0], status: 'passed' },
        { title: REQUIRED_BASIS_REVIEW_CASES[1], status: 'pending' },
      ] }],
    })).toThrow(/without skips/);
    expect(() => assertRealBasisReport({
      ...passed,
      testResults: [{ assertionResults: [{ title: REQUIRED_BASIS_REVIEW_CASES[0], status: 'passed' }] }],
    })).toThrow(/did not pass exactly once/);
  });
});

// Real encoder/decoder integration is opt-in and runs only on the pinned hosted CPU matrix.
describe.skipIf(process.env.GAME_DEV_TEST_BASIS_CPU !== '1')('pinned real Basis CPU encoder and appearance decoder', () => {
  for (const colorCodec of ['etc1s', 'uastc'] as const) it(
    `encodes ${colorCodec} color plus UASTC normal/ORM and verifies Basis-decoded appearance review`,
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-real-review-'));
      try {
        const source = await writeGameReadyGlb(path.join(root, 'source.glb'));
        const io = new NodeIO();
        const doc = await io.read(source);
        const material = doc.getRoot().listMaterials()[0]!;
        const data = new Uint8Array(64 * 64 * 4), normals = new Uint8Array(data.length), orm = new Uint8Array(data.length);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          const at = (y * 64 + x) * 4;
          data.set([x * 4, y * 4, 160, (x + y) % 5 ? 255 : 128], at);
          normals.set([128, 128, 255, 255], at);
          orm.set([255, x * 4, 64, 255], at);
        }
        const add = (name: string, pixels: Uint8Array) => doc.createTexture(name)
          .setImage(encodePNG({ width: 64, height: 64, data: pixels })).setMimeType('image/png');
        material.setBaseColorTexture(add('color', data)).setNormalTexture(add('normal', normals)).setMetallicRoughnessTexture(add('orm', orm));
        // Tangents are required by the compression policy when a normal map is bound.
        const primitive = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
        primitive.setAttribute('TANGENT', doc.createAccessor().setBuffer(doc.getRoot().listBuffers()[0]!).setType('VEC4')
          .setArray(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1])));
        await io.write(source, doc);

        const plainBytes = new Uint8Array(await fs.readFile(source));
        const identity = await requireBasis();
        const compression = await compressTextureVariant({ modelPath: source, outputRoot: path.join(root, 'out'), colorCodec, timeoutSeconds: 180 });
        expect(compression.textures).toHaveLength(3);
        expect(compression.textures.every(texture => texture.cpuTranscoded && texture.levels === 7)).toBe(true);
        expect(compression.sourceUnchanged).toBe(true);
        expect(new Uint8Array(await fs.readFile(source))).toEqual(plainBytes);
        expect((await inspectGltf(compression.outputPath)).textureResolutions.every(texture => texture.mimeType === 'image/ktx2' && texture.width === 64)).toBe(true);
        const compressedBytes = new Uint8Array(await fs.readFile(compression.outputPath));
        let decodeCalls = 0;
        const dependencies = {
          identity,
          runner: async (executable: string, args: readonly string[], cwd: string, timeoutMs: number) => {
            decodeCalls++;
            return runBasis(executable, args, cwd, timeoutMs);
          },
        };
        const settings = {
          mode: 'appearance' as const,
          resolution: 128 as const,
          exposure: 1,
          decodeBasisTextures: true,
          framing: { center: [0, 0, 0] as [number, number, number], extent: 3 },
        };
        await expect(previewGlb(compressedBytes, { ...settings, decodeBasisTextures: false }))
          .rejects.toThrow(/Basis|compressed texture|decodeBasisTextures/i);

        const direct = await previewGlb(compressedBytes, settings, dependencies);
        expect(direct.appearance).toHaveLength(8);
        expect(direct.basisDecode).toMatchObject({
          decoder: {
            sha256: identity.sha256,
            supportedVersion: BASIS_VERSION,
            upstreamCommit: BASIS_COMMIT,
            output: 'rgba32-dx10-dds-v1',
          },
          processCount: expect.any(Number),
        });
        expect(direct.basisDecode!.processCount).toBeGreaterThanOrEqual(4); // version/profile plus one CPU decode for each of three maps
        expect(direct.basisDecode!.processCount).toBe(decodeCalls);
        expect(direct.basisDecode!.textures).toHaveLength(3);
        expect(direct.basisDecode!.textures.every(texture =>
          /^[0-9a-f]{64}$/.test(texture.sourceSha256)
          && /^[0-9a-f]{64}$/.test(texture.decodedSha256)
          && texture.width === 64 && texture.height === 64 && texture.levels === 7
          && texture.decodedBytes === [64, 32, 16, 8, 4, 2, 1].reduce((pixels, side) => pixels + side * side, 0) * 4
          && ['etc1s', 'uastc'].includes(texture.codec)
          && ['srgb', 'linear'].includes(texture.transfer),
        )).toBe(true);
        expect(direct.basisDecode!.textures.find(texture => texture.transfer === 'srgb')?.codec).toBe(colorCodec);

        // Both sources use identical explicit framing/settings and the same declared CPU decoder.
        const reviewRoot = path.join(root, 'review');
        const session = await createAssetReview(reviewRoot, [
          { name: 'PNG source', modelPath: source },
          { name: 'Basis source', modelPath: compression.outputPath },
        ], settings, dependencies);
        const pngCandidate = session.candidates[0]!;
        const basisCandidate = session.candidates[1]!;
        expect(basisCandidate.sha256).toBe(compression.outputSHA256);
        expect(sha256(new Uint8Array(await fs.readFile(basisCandidate.snapshotPath)))).toBe(compression.outputSHA256);

        const bindingPath = path.join(basisCandidate.previewRunPath!, 'source-binding.json');
        const binding = JSON.parse(await fs.readFile(bindingPath, 'utf8'));
        expect(binding.sourceSha256).toBe(compression.outputSHA256);
        expect(binding.settings).toMatchObject(settings);
        expect(JSON.stringify(binding)).toContain(identity.sha256);
        expect(JSON.stringify(binding)).toContain(BASIS_COMMIT);
        expect(binding.basisDecode?.processCount).toBeGreaterThanOrEqual(4);
        expect(binding.basisDecode?.textures).toHaveLength(3);

        const capture = JSON.parse(await fs.readFile(path.join(basisCandidate.previewRunPath!, 'capture.json'), 'utf8'));
        expect(capture.adapterEvidence.rendererClass).toBe('software');
        expect(capture.adapterEvidence.gpuExecutionReported).toBe(false);
        expect(capture.adapterEvidence.notes.join(' ')).toMatch(/Basis.*CPU.*decoder|CPU.*Basis.*decoder/i);
        expect(capture.adapterEvidence.notes.join(' ')).not.toMatch(/no subprocess/i);

        const comparison = await compareRunVisuals({
          baselineRunPath: pngCandidate.previewRunPath!,
          candidateRunPath: basisCandidate.previewRunPath!,
          threshold: 48,
          antialiasTolerancePixels: 1,
        });
        if(process.env.GDS_BASIS_REVIEW_EVIDENCE) {
          const evidence=path.join(process.env.GDS_BASIS_REVIEW_EVIDENCE,colorCodec);await fs.mkdir(evidence,{recursive:true});
          await fs.copyFile(source,path.join(evidence,'source.glb'));await fs.copyFile(compression.outputPath,path.join(evidence,'compressed.glb'));
          await fs.copyFile(bindingPath,path.join(evidence,'source-binding.json'));
          for(const [index,pair] of comparison.pairs.entries()) {
            await fs.copyFile(pair.baselinePath,path.join(evidence,`angle-${index}-plain.png`));
            await fs.copyFile(pair.candidatePath,path.join(evidence,`angle-${index}-basis.png`));
          }
          await fs.writeFile(path.join(evidence,'comparison.json'),JSON.stringify({kind:'hosted-real-basis-synthetic-fixture',codec:colorCodec,
            decoder:direct.basisDecode,sourceSha256:sha256(plainBytes),compressedSha256:compression.outputSHA256,settings,
            tolerance:{channelThreshold:48,maximumNormalizedMeanAbsoluteError:0.12,minimumMeanSSIM:0.85},
            pairs:comparison.pairs.map(pair=>({comparable:pair.comparable,width:pair.width,height:pair.height,meanAbsoluteError:pair.meanAbsoluteError,meanSSIM:pair.meanSSIM,changedPixelRatio:pair.changedPixelRatio})),
            limitations:'Authored codec fixtures and CPU appearance pixels; not target-engine correctness, artistic approval or human usability.'},null,2));
        }
        expect(comparison.pairs).toHaveLength(8);
        expect(comparison.pairs.every(pair => pair.comparable && pair.width === 128 && pair.height === 128)).toBe(true);
        // A 48/255 per-channel threshold and 12% mean-RGBA-error ceiling permit lossy texture quantization
        // while rejecting gross decoder, transfer-function, or framing mismatches.
        expect(comparison.pairs.every(pair => (pair.meanAbsoluteError ?? 1) <= 0.12)).toBe(true);
        expect(comparison.pairs.every(pair => (pair.meanSSIM ?? 0) >= 0.85)).toBe(true);

        const decision = await decideAssetReview(reviewRoot, {
          sessionId: session.id,
          candidateId: basisCandidate.id,
          decision: 'approve',
          reviewer: 'Basis CPU integration test',
          reason: 'Verify the compressed source remains the reviewed package payload',
        });
        const built = await packageReviewedAsset(reviewRoot, {
          decisionId: decision.id,
          packagesRoot: path.join(root, 'review-packages'),
          catalogPath: path.join(root, 'review-catalog.sqlite'),
          name: `Basis review ${colorCodec}`,
          license: 'CC0-1.0',
        });
        expect(built.package.validation.passed).toBe(true);
        expect(sha256(new Uint8Array(await fs.readFile(path.join(built.package.packagePath, 'model.glb'))))).toBe(compression.outputSHA256);
        expect((await readAssetPackage(built.package.packagePath)).validation.passed).toBe(true);
        const report = JSON.parse(await fs.readFile(path.join(built.package.packagePath, 'validation.json'), 'utf8'));
        expect(report.compressedTextures.cpuTranscoded).toBe(true);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    240_000,
  );
});
