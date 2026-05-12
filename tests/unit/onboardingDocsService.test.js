import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/onboardingRepo.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/onboardingAttachments.js', () => ({
  findByHome: vi.fn(),
}));

vi.mock('../../repositories/staffRepo.js', () => ({
  findByHome: vi.fn(),
}));

import * as onboardingRepo from '../../repositories/onboardingRepo.js';
import * as onboardingAttachmentsRepo from '../../repositories/onboardingAttachments.js';
import * as staffRepo from '../../repositories/staffRepo.js';
import { getOnboardingDocs } from '../../services/onboardingDocsService.js';

describe('onboardingDocsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    staffRepo.findByHome.mockResolvedValue({
      rows: [
        { id: 'S001', name: 'Alice Smith', role: 'Carer', active: true },
        { id: 'S002', name: 'Inactive Leaver', role: 'Carer', active: false },
      ],
    });
  });

  it('flags required onboarding sections as outstanding until status and document are present', async () => {
    onboardingRepo.findByHome.mockResolvedValue({
      S001: {
        dbs_check: { status: 'completed' },
        right_to_work: { status: 'not_started' },
        references: { status: 'in_progress' },
      },
    });
    onboardingAttachmentsRepo.findByHome.mockResolvedValue([
      { id: 1, staffId: 'S001', section: 'dbs_check' },
      { id: 2, staffId: 'S001', section: 'right_to_work' },
    ]);

    const result = await getOnboardingDocs(10, { roleId: 'home_manager' });
    const alice = result.byStaff[0];

    expect(result.byStaff).toHaveLength(1);
    expect(alice.sections.find((section) => section.section === 'dbs_check')).toMatchObject({
      attachment_count: 1,
      status: 'completed',
      needs_attention: false,
    });
    expect(alice.sections.find((section) => section.section === 'right_to_work')).toMatchObject({
      attachment_count: 1,
      status: 'not_started',
      missing_required_document: false,
      status_incomplete: true,
      needs_attention: true,
    });
    expect(alice.sections.find((section) => section.section === 'references')).toMatchObject({
      attachment_count: 0,
      status: 'in_progress',
      missing_required_document: true,
      status_incomplete: true,
      needs_attention: true,
    });
    expect(result.summary.outstanding_required_sections).toBe(9);
    expect(result.bySection.find((section) => section.section === 'right_to_work')).toMatchObject({
      missing_required_count: 0,
      needs_attention_count: 1,
    });
  });
});
