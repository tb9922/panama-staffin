import { BTN, CARD, TABLE, BADGE } from '../../lib/design.js';
import { FUNDING_TYPES, RESIDENT_STATUSES, getLabel, getStatusBadge, formatCurrency } from '../../lib/finance.js';

function renderBedCell(r) {
  if (!r.bed) {
    if (r.status === 'active') return <span className="text-amber-600 font-medium">No bed</span>;
    return <span className="text-gray-400">{'\u2014'}</span>;
  }
  if (r.bed.status === 'hospital_hold') {
    return <span>{r.bed.room_number} <span className="text-amber-600" title="In hospital">&#127973;</span></span>;
  }
  return <span>{r.bed.room_number}</span>;
}

function renderFeeReview(r) {
  if (!r.next_fee_review) return <span className="text-gray-400">{'\u2014'}</span>;
  const daysUntil = (new Date(r.next_fee_review) - new Date()) / 86400000;
  const color = daysUntil < 0 ? 'text-red-600 font-medium' : daysUntil <= 30 ? 'text-amber-600' : '';
  return <span className={color}>{r.next_fee_review}</span>;
}

export default function ResidentTable({ residents, isAdmin, onEdit, onDischarge, onAdmit }) {
  if (residents.length === 0) {
    return (
      <div className={CARD.padded + ' text-center py-12'}>
        <p className="text-gray-500 mb-4">No residents yet</p>
        {isAdmin && (
          <button className={BTN.primary} onClick={onAdmit}>Admit your first resident</button>
        )}
      </div>
    );
  }

  async function handleExport() {
    const { downloadXLSX } = await import('../../lib/excel.js');
    downloadXLSX('residents.xlsx', [{
      name: 'Residents',
      headers: ['Name', 'Room / Bed', 'Funding', 'Weekly Fee', 'Admitted', 'Fee Review', 'Outstanding', 'Last Paid', 'Status'],
      rows: residents.map(r => [
        r.resident_name,
        r.bed?.room_number || (r.status === 'active' ? 'No bed' : ''),
        getLabel(r.funding_type, FUNDING_TYPES),
        r.weekly_fee != null ? `£${parseFloat(r.weekly_fee).toFixed(2)}` : '',
        r.admission_date || '',
        r.next_fee_review || '',
        r.outstanding_balance != null ? `£${parseFloat(r.outstanding_balance).toFixed(2)}` : '',
        r.last_payment_date || '',
        getLabel(r.status, RESIDENT_STATUSES),
      ]),
    }]);
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        <button className={BTN.ghost + ' ' + BTN.sm} onClick={handleExport}>Export Excel</button>
      </div>
      <div className={CARD.flush}>
        <table className={TABLE.table}>
          <thead className={TABLE.thead}>
            <tr>
              <th className={TABLE.th}>Name</th>
              <th className={TABLE.th}>Room / Bed</th>
              <th className={TABLE.th}>Funding</th>
              <th className={TABLE.th + ' text-right'}>Weekly Fee</th>
              <th className={TABLE.th}>Admitted</th>
              <th className={TABLE.th}>Fee Review</th>
              <th className={TABLE.th + ' text-right'}>Balance</th>
              <th className={TABLE.th}>Last Paid</th>
              <th className={TABLE.th}>Status</th>
              {isAdmin && <th className={TABLE.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {residents.map(r => (
              <tr key={r.id} className={TABLE.tr + ' cursor-pointer'} onClick={() => onEdit(r)}>
                <td className={TABLE.td + ' font-medium'}>{r.resident_name}</td>
                <td className={TABLE.td}>{renderBedCell(r)}</td>
                <td className={TABLE.td}>{getLabel(r.funding_type, FUNDING_TYPES)}</td>
                <td className={TABLE.tdMono + ' text-right'}>{formatCurrency(r.weekly_fee)}</td>
                <td className={TABLE.td}>{r.admission_date || '\u2014'}</td>
                <td className={TABLE.td}>{renderFeeReview(r)}</td>
                <td className={TABLE.tdMono + ' text-right'}>
                  {r.outstanding_balance > 0
                    ? <span className="text-amber-600 font-medium">{formatCurrency(r.outstanding_balance)}</span>
                    : <span className="text-green-600">{formatCurrency(0)}</span>}
                </td>
                <td className={TABLE.td}>
                  {r.last_payment_date
                    ? <div><span>{r.last_payment_date}</span>{r.last_payment_amount != null && <span className="text-xs text-gray-400 ml-1">({formatCurrency(r.last_payment_amount)})</span>}</div>
                    : <span className="text-gray-400">{'\u2014'}</span>}
                </td>
                <td className={TABLE.td}>
                  <span className={BADGE[getStatusBadge(r.status, RESIDENT_STATUSES)]}>{getLabel(r.status, RESIDENT_STATUSES)}</span>
                </td>
                {isAdmin && (
                  <td className={TABLE.td} onClick={e => e.stopPropagation()}>
                    {r.status === 'active' && (
                      <button className={BTN.ghost + ' ' + BTN.xs} onClick={() => onDischarge(r)}>Discharge</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
