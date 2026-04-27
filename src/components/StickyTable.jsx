export default function StickyTable({ className = '', children }) {
  return (
    <div className={className}>
      <div className="max-w-full overflow-x-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10">
        {children}
      </div>
    </div>
  );
}
