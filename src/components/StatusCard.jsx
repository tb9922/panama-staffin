export default function StatusCard({ title, value, subtitle, tone = 'slate', className = '' }) {
  const tones = {
    slate: 'border-slate-200 bg-white text-slate-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  };
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone] || tones.slate} ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
    </div>
  );
}
