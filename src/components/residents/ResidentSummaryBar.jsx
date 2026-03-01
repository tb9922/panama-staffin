import { CARD, BADGE } from '../../lib/design.js';

export default function ResidentSummaryBar({ stats }) {
  const occupancyColor = stats.occupancyPct == null ? 'gray'
    : stats.occupancyPct >= 85 ? 'green'
    : stats.occupancyPct >= 70 ? 'amber' : 'red';

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className={CARD.padded}>
        <p className="text-sm text-gray-500">Active Residents</p>
        <p className="text-2xl font-semibold">{stats.activeCount}</p>
      </div>
      <div className={CARD.padded}>
        <p className="text-sm text-gray-500">Occupancy</p>
        <p className={`text-2xl font-semibold text-${occupancyColor}-600`}>
          {stats.occupancyPct != null ? `${stats.occupancyPct}%` : '\u2014'}
        </p>
        {stats.inHospital > 0 && (
          <p className="text-xs text-amber-600 mt-1">{stats.inHospital} in hospital</p>
        )}
      </div>
      <div className={CARD.padded}>
        <p className="text-sm text-gray-500">Beds Available</p>
        <p className={`text-2xl font-semibold ${stats.bedsAvailable === 0 ? 'text-red-600' : stats.bedsAvailable > 0 ? 'text-green-600' : 'text-gray-400'}`}>
          {stats.bedsAvailable != null ? stats.bedsAvailable : '\u2014'}
        </p>
      </div>
      <div className={CARD.padded}>
        <p className="text-sm text-gray-500">Fee Reviews Due</p>
        <p className={`text-2xl font-semibold ${stats.reviewsDue > 0 ? 'text-amber-600' : 'text-green-600'}`}>
          {stats.reviewsDue}
        </p>
      </div>
    </div>
  );
}
