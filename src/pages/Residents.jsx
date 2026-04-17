import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BADGE, BTN, CARD, PAGE } from '../lib/design.js';
import { FUNDING_TYPES, RESIDENT_STATUSES } from '../lib/finance.js';
import {
  getCurrentHome, getResidentsWithBeds, getBeds,
} from '../lib/api.js';
import ResidentSummaryBar from '../components/residents/ResidentSummaryBar.jsx';
import ResidentTable from '../components/residents/ResidentTable.jsx';
import ResidentAdmitModal from '../components/residents/ResidentAdmitModal.jsx';
import ResidentEditModal from '../components/residents/ResidentEditModal.jsx';
import ResidentDischargeModal from '../components/residents/ResidentDischargeModal.jsx';
import { useData } from '../contexts/DataContext.jsx';
import useDirtyGuard from '../hooks/useDirtyGuard.js';
import ErrorState from '../components/ErrorState.jsx';
import InlineNotice from '../components/InlineNotice.jsx';
import LoadingState from '../components/LoadingState.jsx';
import useTransientNotice from '../hooks/useTransientNotice.js';

export default function Residents() {
  const [residents, setResidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterFunding, setFilterFunding] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [bedsAvailable, setBedsAvailable] = useState(null);
  const [showAdmit, setShowAdmit] = useState(false);
  const [editResident, setEditResident] = useState(null);
  const [dischargeResident, setDischargeResident] = useState(null);
  const { notice, showNotice, clearNotice } = useTransientNotice();

  const home = getCurrentHome();
  const { canWrite } = useData();
  const canEdit = canWrite('finance');
  useDirtyGuard(showAdmit || !!editResident || !!dischargeResident);

  const load = useCallback(async () => {
    if (!home) return;
    setLoading(true);
    try {
      const filters = {};
      if (filterStatus) filters.status = filterStatus;
      if (filterFunding) filters.funding_type = filterFunding;
      if (searchQuery) filters.search = searchQuery;
      const [data, bedsData] = await Promise.all([
        getResidentsWithBeds(home, filters),
        getBeds(home).catch(e => { console.warn('Failed to load beds:', e.message); return null; }),
      ]);
      setResidents(data.rows || []);
      setTotal(data.total || 0);
      if (bedsData) {
        const beds = bedsData.beds || bedsData || [];
        setBedsAvailable(beds.filter(b => b.status === 'available').length);
      }
      setError(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [home, filterStatus, filterFunding, searchQuery]);

  useEffect(() => { load(); }, [load]);

  function handleSearchKeyDown(e) {
    if (e.key === 'Enter') setSearchQuery(searchInput.trim());
  }
  function handleSearchClick() {
    setSearchQuery(searchInput.trim());
  }

  const stats = useMemo(() => {
    const active = residents.filter(r => r.status === 'active');
    const withBed = active.filter(r => r.bed != null);
    const inHospital = active.filter(r => r.bed?.status === 'hospital_hold');
    const reviewDue = active.filter(r => {
      if (!r.next_fee_review) return false;
      const now = new Date();
      const daysUntil = (new Date(r.next_fee_review + 'T00:00:00Z') - new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))) / 86400000;
      return daysUntil <= 30 && daysUntil >= 0;
    });
    const withBalance = active.filter(r => r.outstanding_balance > 0);
    const totalOutstanding = withBalance.reduce((sum, r) => sum + (parseFloat(r.outstanding_balance) || 0), 0);
    return {
      activeCount: active.length,
      occupancyPct: active.length > 0 ? Math.round((withBed.length / active.length) * 100) : null,
      inHospital: inHospital.length,
      bedsAvailable,
      reviewsDue: reviewDue.length,
      totalOutstanding,
      residentsWithBalance: withBalance.length,
    };
  }, [residents, bedsAvailable]);

  return (
    <div className={PAGE.container}>
      <div className={PAGE.header}>
        <div>
          <h1 className={PAGE.title}>Residents</h1>
          <p className="text-sm text-gray-500">Resident register and bed assignments</p>
        </div>
        {canEdit && (
          <button className={BTN.primary} onClick={() => setShowAdmit(true)}>Admit Resident</button>
        )}
      </div>

      {notice && (
        <InlineNotice variant={notice.variant} onDismiss={clearNotice} className="mb-4">
          {notice.content}
        </InlineNotice>
      )}

      {error && (
        <ErrorState title="Unable to load residents" message={error} onRetry={load} className="mb-4" />
      )}

      <ResidentSummaryBar stats={stats} />

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <select className="border rounded px-2 py-1.5 text-sm" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          {RESIDENT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="border rounded px-2 py-1.5 text-sm" value={filterFunding} onChange={e => setFilterFunding(e.target.value)}>
          <option value="">All Funding</option>
          {FUNDING_TYPES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <div className="relative">
          <input
            type="text" className="border rounded px-2 py-1.5 text-sm pr-8 w-56"
            placeholder="Search by name (Enter)"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            onClick={handleSearchClick}
            title="Search"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
        {total > 0 && <span className="text-sm text-gray-500">{total} resident{total !== 1 ? 's' : ''}</span>}
      </div>

      {loading ? (
        <LoadingState message="Loading resident register..." />
      ) : (
        <ResidentTable
          residents={residents}
          canEdit={canEdit}
          onEdit={setEditResident}
          onDischarge={setDischargeResident}
          onAdmit={() => setShowAdmit(true)}
        />
      )}

        {showAdmit && (
          <ResidentAdmitModal
            home={home}
            onClose={() => setShowAdmit(false)}
            onSaved={(resident) => {
              load();
              const bedUrl = resident?.id ? `/beds?residentId=${resident.id}` : '/beds';
              showNotice(<>Resident admitted. <Link to={bedUrl} className="underline font-medium">Assign a bed in Bed Manager &rarr;</Link></>, { duration: 10000 });
            }}
          />
        )}

      {editResident && (
        <ResidentEditModal
          home={home}
          resident={editResident}
          canEdit={canEdit}
          onClose={() => setEditResident(null)}
          onSaved={load}
        />
      )}

      {dischargeResident && (
        <ResidentDischargeModal
          home={home}
          resident={dischargeResident}
          onClose={() => setDischargeResident(null)}
            onSaved={(hadBed, roomNumber) => {
              load();
              if (hadBed) {
                const bedUrl = dischargeResident?.id ? `/beds?residentId=${dischargeResident.id}` : '/beds';
                showNotice(<>Resident discharged. Room {roomNumber} still occupied &mdash; <Link to={bedUrl} className="underline font-medium">update in Bed Manager &rarr;</Link></>, { duration: 10000, variant: 'warning' });
              } else {
                showNotice('Resident discharged.');
              }
          }}
        />
      )}
    </div>
  );
}
