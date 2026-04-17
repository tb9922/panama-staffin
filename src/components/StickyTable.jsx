export default function StickyTable({ className = '', children }) {
  return (
    <div className={`overflow-x-auto [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 ${className}`}>
      {children}
    </div>
  );
}
