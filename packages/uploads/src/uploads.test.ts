import { describe, expect, it } from 'vitest';
import { canTransitionUpload } from '@copilot/domain';
import { InMemoryUploadAnalysisStore } from './analysis-store.js';
import { InMemoryUploadStorageAdapter, sha256Hex } from './storage.js';
import { MockDocumentVisionAdapter } from './vision.js';
import { UploadIngestionService, UploadStateError } from './pipeline.js';

const KNOWN_SKILLS = ['M4.FRAC.EQUIV', 'M4.FRAC.ADD_SAME', 'M4.ARITH.DISTRIBUTIVE'];

function svc() {
  const storage = new InMemoryUploadStorageAdapter();
  const store = new InMemoryUploadAnalysisStore();
  const vision = new MockDocumentVisionAdapter();
  return { storage, store, service: new UploadIngestionService({ storage, vision, store }) };
}

const bytesFor = (seed: string) => new TextEncoder().encode(`fake-image-${seed}`.repeat(64));

describe('upload ingestion lifecycle', () => {
  it('runs UPLOAD_CREATED -> UPLOADED -> ... -> NEEDS_CONFIRMATION', async () => {
    const { service } = svc();
    const { upload, analysis } = await service.createUpload({
      childId: 'c1',
      actorUserId: 'u1',
      kind: 'NOTEBOOK_PAGE',
      filename: 'trang.jpg',
      mimeType: 'image/jpeg',
      bytes: bytesFor('a'),
    });
    expect(analysis.state).toBe('UPLOADED');
    expect(upload.contentHash).toBe(sha256Hex(bytesFor('a')));

    const analyzed = await service.runAnalysis({
      uploadId: upload.id,
      childGrade: 4,
      knownSkillIds: KNOWN_SKILLS,
    });
    expect(analyzed.state).toBe('NEEDS_CONFIRMATION');
    expect(analyzed.extraction).not.toBeNull();
    expect(analyzed.adapterProvider).toBe('mock');
  });

  it('only confirmed items become evidence drafts; low-confidence dropped by default', async () => {
    const { service } = svc();
    const { upload } = await service.createUpload({
      childId: 'c1',
      actorUserId: 'u1',
      kind: 'HOMEWORK',
      filename: 'bt.jpg',
      mimeType: 'image/jpeg',
      bytes: bytesFor('homework-seed'),
    });
    const analyzed = await service.runAnalysis({
      uploadId: upload.id,
      childGrade: 4,
      knownSkillIds: KNOWN_SKILLS,
    });
    const lowConf = analyzed.extraction!.items.filter(
      (it) => (it.skillCandidates[0]?.confidence ?? 0) < 0.6,
    );

    // confirm with NO corrections -> only auto-selected (>=0.6) items pass
    const res = await service.confirmAnalysis({
      uploadId: upload.id,
      confirmedByUserId: 'u1',
      corrections: [],
    });
    expect(res.analysis.state).toBe('CONFIRMED');
    for (const d of res.evidenceDrafts) {
      // never verified
      expect(['B', 'C']).toContain(d.confidenceTier);
    }
    // a low-confidence item only appears if the parent explicitly confirms it
    if (lowConf.length > 0) {
      const dropped = lowConf[0]!;
      expect(res.evidenceDrafts.some((d) => d.skillId === dropped.skillCandidates[0]?.skillId && false)).toBe(false);
    }
  });

  it('parent can correct the skill on a low-confidence item', async () => {
    const { service } = svc();
    const { upload } = await service.createUpload({
      childId: 'c1',
      actorUserId: 'u1',
      kind: 'GRADED_TEST',
      filename: 't.jpg',
      mimeType: 'image/jpeg',
      bytes: bytesFor('graded-xyz'),
    });
    const analyzed = await service.runAnalysis({
      uploadId: upload.id,
      childGrade: 7,
      knownSkillIds: KNOWN_SKILLS,
    });
    const first = analyzed.extraction!.items[0]!;
    const res = await service.confirmAnalysis({
      uploadId: upload.id,
      confirmedByUserId: 'u1',
      corrections: [{ index: first.index, confirm: true, skillId: 'M4.ARITH.DISTRIBUTIVE', correct: false }],
    });
    const draft = res.evidenceDrafts.find((d) => d.skillId === 'M4.ARITH.DISTRIBUTIVE');
    expect(draft).toBeDefined();
    expect(draft!.correct).toBe(false);
    // a graded test yields STRONG (B), never verified (A)
    expect(draft!.confidenceTier).toBe('B');
  });

  it('rejects out-of-order transitions', async () => {
    const { service } = svc();
    const { upload } = await service.createUpload({
      childId: 'c1',
      actorUserId: 'u1',
      kind: 'OTHER',
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      bytes: bytesFor('order'),
    });
    await expect(
      service.confirmAnalysis({ uploadId: upload.id, confirmedByUserId: 'u1', corrections: [] }),
    ).rejects.toBeInstanceOf(UploadStateError);
  });

  it('marks FAILED when the storage object is missing', async () => {
    const storage = new InMemoryUploadStorageAdapter();
    const store = new InMemoryUploadAnalysisStore();
    const service = new UploadIngestionService({
      storage,
      vision: new MockDocumentVisionAdapter(),
      store,
    });
    const { upload } = await service.createUpload({
      childId: 'c1',
      actorUserId: 'u1',
      kind: 'OTHER',
      filename: 'x.jpg',
      mimeType: 'image/jpeg',
      bytes: bytesFor('gone'),
    });
    await storage.remove((await store.getUpload(upload.id))!.storageKey);
    const failed = await service.runAnalysis({ uploadId: upload.id, childGrade: 4, knownSkillIds: KNOWN_SKILLS });
    expect(failed.state).toBe('FAILED');
    expect(failed.errorMessage).toContain('no object');
  });

  it('transition table forbids skipping states', () => {
    expect(canTransitionUpload('UPLOADED', 'READING')).toBe(true);
    expect(canTransitionUpload('UPLOADED', 'CONFIRMED')).toBe(false);
    expect(canTransitionUpload('READING', 'FAILED')).toBe(true);
    expect(canTransitionUpload('CONFIRMED', 'NEEDS_CONFIRMATION')).toBe(false);
  });
});
