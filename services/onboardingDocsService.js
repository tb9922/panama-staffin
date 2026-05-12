import * as onboardingRepo from '../repositories/onboardingRepo.js';
import * as onboardingAttachmentsRepo from '../repositories/onboardingAttachments.js';
import * as staffRepo from '../repositories/staffRepo.js';
import { visibleOnboardingSectionsForRole } from '../shared/staffPolicy.js';

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

export async function getOnboardingDocs(homeId, { roleId, isPlatformAdmin = false } = {}) {
  const [onboarding, attachments, staffResult] = await Promise.all([
    onboardingRepo.findByHome(homeId),
    onboardingAttachmentsRepo.findByHome(homeId),
    staffRepo.findByHome(homeId),
  ]);
  const staff = staffResult.rows.filter((member) => member.active !== false);
  const visibleSections = visibleOnboardingSectionsForRole(REQUIRED_SECTIONS, roleId, { isPlatformAdmin });
  const attachmentsByStaffSection = new Map();
  for (const attachment of attachments) {
    const key = `${attachment.staffId}:${attachment.section}`;
    const bucket = attachmentsByStaffSection.get(key) || [];
    bucket.push(attachment);
    attachmentsByStaffSection.set(key, bucket);
  }

  const byStaff = staff.map((member) => {
    const onboardingData = onboarding[member.id] || {};
    const sections = visibleSections.map((section) => {
      const docs = attachmentsByStaffSection.get(`${member.id}:${section}`) || [];
      const sectionData = onboardingData[section] || null;
      const status = sectionData?.status || 'not_started';
      const missingRequiredDocument = docs.length === 0;
      const statusIncomplete = status !== 'completed';
      const attentionReasons = [
        statusIncomplete ? 'status_not_completed' : null,
        missingRequiredDocument ? 'document_missing' : null,
      ].filter(Boolean);
      return {
        section,
        status,
        expiry: sectionData?.expiry || null,
        attachment_count: docs.length,
        missing_required_document: missingRequiredDocument,
        status_incomplete: statusIncomplete,
        needs_attention: attentionReasons.length > 0,
        attention_reasons: attentionReasons,
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

  const bySection = visibleSections.map((section) => {
    const staffEntries = byStaff.map((entry) => entry.sections.find((candidate) => candidate.section === section));
    return {
      section,
      attachment_count: staffEntries.reduce((sum, entry) => sum + (entry?.attachment_count || 0), 0),
      missing_required_count: staffEntries.filter((entry) => entry?.missing_required_document).length,
      needs_attention_count: staffEntries.filter((entry) => entry?.needs_attention).length,
    };
  });

  const outstandingMandatory = byStaff.flatMap((entry) =>
    entry.sections
      .filter((section) => section.needs_attention)
      .map((section) => ({
        staff_id: entry.staff_id,
        staff_name: entry.staff_name,
        section: section.section,
        status: section.status,
        attachment_count: section.attachment_count,
        missing_required_document: section.missing_required_document,
        status_incomplete: section.status_incomplete,
        attention_reasons: section.attention_reasons,
      }))
  );

  return {
    summary: {
      total_documents: byStaff.reduce((sum, entry) => sum + entry.attachment_count, 0),
      staff_with_docs: byStaff.filter((entry) => entry.attachment_count > 0).length,
      outstanding_required_sections: outstandingMandatory.length,
    },
    byStaff,
    bySection,
    outstandingMandatory,
  };
}
