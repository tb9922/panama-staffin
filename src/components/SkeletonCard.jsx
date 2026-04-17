export default function SkeletonCard({ lines = 3, className = '' }) {
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-4 ${className}`} aria-hidden="true">
      <div className="mb-3 h-4 w-1/3 animate-pulse rounded bg-gray-200" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <div key={index} className="h-3 animate-pulse rounded bg-gray-100" />
        ))}
      </div>
    </div>
  );
}
