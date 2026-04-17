import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as onboardingAttachmentsRepo from '../repositories/onboardingAttachments.js';
import * as staffRepo from '../repositories/staffRepo.js';

const REQUIRED_SECTIONS = [
  'dbs_check',
  'right_to_work',
  'references',
  'identity_check',
  'health_declaration',
  'qualifications',
  'contract',
  'employment_history',
  'day1_induction',
  'policy_acknowledgement',
];

export async function getOnboardingDocs(homeId) {
  const [onboarding, attachments, staffResult] = await Promise.all([
    onboardingRepo.findByHome(homeId),
    onboardingAttachmentsRepo.findByHome(homeId),
    staffRepo.findByHome(homeId),
  ]);
  const staff = staffResult.rows;
  const attachmentsByStaffSection = new Map();
  for (const attachment of attachments) {
    const key = `${attachment.staff_id}:${attachment.section}`;
    const bucket = attachmentsByStaffSection.get(key) || [];
    bucket.push(attachment);
    attachmentsByStaffSection.set(key, bucket);
  }

  const byStaff = staff.map((member) => {
    const onboardingData = onboarding[member.id] || {};
    const sections = REQUIRED_SECTIONS.map((section) => {
      const docs = attachmentsByStaffSection.get(`${member.id}:${section}`) || [];
      const sectionData = onboardingData[section] || null;
      return {
        section,
        status: sectionData?.status || 'not_started',
        expiry: sectionData?.expiry || null,
        attachment_count: docs.length,
        missing_required_document: docs.length === 0 && ['in_progress', 'completed'].includes(sectionData?.status),
      };
    });
    return {
      staff_id: member.id,
      staff_name: member.name,
      role: member.role,
      sections,
      attachment_count: sections.reduce((sum, section) => sum + section.attachment_count, 0),
    };
  });

  const bySection = REQUIRED_SECTIONS.map((section) => {
    const staffEntries = byStaff.map((entry) => entry.sections.find((candidate) => candidate.section === section));
    return {
      section,
      attachment_count: staffEntries.reduce((sum, entry) => sum + (entry?.attachment_count || 0), 0),
      missing_required_count: staffEntries.filter((entry) => entry?.missing_required_document).length,
    };
  });

  const outstandingMandatory = byStaff.flatMap((entry) =>
    entry.sections
      .filter((section) => section.missing_required_document)
      .map((section) => ({
        staff_id: entry.staff_id,
        staff_name: entry.staff_name,
        section: section.section,
        status: section.status,
      }))
  );

  return {
    summary: {
      total_documents: attachments.length,
      staff_with_docs: byStaff.filter((entry) => entry.attachment_count > 0).length,
      outstanding_required_sections: outstandingMandatory.length,
    },
    byStaff,
    bySection,
    outstandingMandatory,
  };
}
