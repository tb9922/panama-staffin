import { useCallback, useEffect, useState } from 'react';
import { PAGE, CARD, TABLE, BADGE } from '../lib/design.js';
import { getCurrentHome, getOnboardingDocs } from '../lib/api.js';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import ScanDocumentLink from '../components/ScanDocumentLink.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { canManageSensitiveStaffFields } from '../../shared/staffPolicy.js';
import { ONBOARDING_SECTIONS, STATUS_DISPLAY } from '../lib/onboarding.js';

const SECTION_LABELS = Object.fromEntries(ONBOARDING_SECTIONS.map((section) => [section.id, section.name]));

function sectionLabel(section) {
  return SECTION_LABELS[section] || String(section || '').replace(/_/g, ' ');
}

function statusLabel(status) {
  return STATUS_DISPLAY[status]?.label || String(status || '').replace(/_/g, ' ');
}

function needsAttention(section) {
  return section?.needs_attention ?? section?.missing_required_document;
}

function attentionReasonLabel(row) {
  const reasons = row?.attention_reasons || [];
  if (reasons.includes('status_not_completed') && reasons.includes('document_missing')) return 'Status and document missing';
  if (reasons.includes('status_not_completed')) return 'Status not completed';
  if (reasons.includes('document_missing')) return 'Document missing';
  return 'Needs review';
}

export default function OnboardingDocsTracker() {
  const home = getCurrentHome();
  const { homeRole, isPlatformAdmin, isScanTargetEnabled = () => false } = useData();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getOnboardingDocs(home));
    } catch (err) {
      setError(err.message || 'Failed to load onboarding documents');
    } finally {
      setLoading(false);
    }
  }, [home]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className={PAGE.container}><LoadingState message="Loading onboarding documents..." card /></div>;
  if (error) return <div className={PAGE.container}><ErrorState title="Onboarding documents need attention" message={error} onRetry={load} /></div>;

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Onboarding Docs Center</h1>
          <p className={PAGE.subtitle}>Track onboarding document coverage by person, section, and outstanding mandatory gaps.</p>
        </div>
        {canManageSensitiveStaffFields(homeRole, { isPlatformAdmin }) && isScanTargetEnabled('onboarding') && <ScanDocumentLink context={{ target: 'onboarding' }} label="Scan to Onboarding" />}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={CARD.padded}><div className="text-xs text-gray-500">Documents</div><div className="mt-1 text-2xl font-bold">{data.summary.total_documents}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Staff With Docs</div><div className="mt-1 text-2xl font-bold">{data.summary.staff_with_docs}</div></div>
        <div className={CARD.padded}><div className="text-xs text-gray-500">Outstanding Mandatory</div><div className="mt-1 text-2xl font-bold text-red-600">{data.summary.outstanding_required_sections}</div></div>
      </div>

      <div className={CARD.flush}>
        <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Staff</div>
        <div className={TABLE.wrapper}>
          <table className={TABLE.table}>
            <thead className={TABLE.thead}><tr><th className={TABLE.th}>Staff</th><th className={TABLE.th}>Role</th><th className={TABLE.th}>Documents</th><th className={TABLE.th}>Needs Attention</th></tr></thead>
            <tbody>
              {data.byStaff.map((row) => {
                const outstanding = row.sections.filter(needsAttention).length;
                return (
                  <tr key={row.staff_id} className={TABLE.tr}>
                    <td className={TABLE.td}>{row.staff_name}</td>
                    <td className={TABLE.td}>{row.role}</td>
                    <td className={TABLE.td}>{row.attachment_count}</td>
                    <td className={TABLE.td}>{outstanding > 0 ? <span className={BADGE.red}>{outstanding} gaps</span> : <span className={BADGE.green}>Covered</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">By Section</div>
          <div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Section</th><th className={TABLE.th}>Documents</th><th className={TABLE.th}>Needs Attention</th></tr></thead><tbody>{data.bySection.map((row) => {
            const needsAttentionCount = row.needs_attention_count ?? row.missing_required_count;
            return <tr key={row.section} className={TABLE.tr}><td className={TABLE.td}>{sectionLabel(row.section)}</td><td className={TABLE.td}>{row.attachment_count}</td><td className={TABLE.td}>{needsAttentionCount > 0 ? <span className={BADGE.red}>{needsAttentionCount}</span> : <span className={BADGE.green}>0</span>}</td></tr>;
          })}</tbody></table></div>
        </div>
        <div className={CARD.flush}>
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Outstanding Mandatory Sections</div>
          <div className={TABLE.wrapper}><table className={TABLE.table}><thead className={TABLE.thead}><tr><th className={TABLE.th}>Staff</th><th className={TABLE.th}>Section</th><th className={TABLE.th}>Status</th><th className={TABLE.th}>Reason</th></tr></thead><tbody>{data.outstandingMandatory.map((row, index) => <tr key={`${row.staff_id}:${row.section}:${index}`} className={TABLE.tr}><td className={TABLE.td}>{row.staff_name}</td><td className={TABLE.td}>{sectionLabel(row.section)}</td><td className={TABLE.td}><span className={BADGE.amber}>{statusLabel(row.status)}</span></td><td className={TABLE.td}>{attentionReasonLabel(row)}</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </div>
  );
}
