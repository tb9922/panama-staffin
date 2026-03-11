import { Link } from 'react-router-dom';
import { PAGE, BTN } from '../lib/design.js';

export default function NotFound() {
  return (
    <div className={PAGE.container}>
      <h1 className={PAGE.title}>Page Not Found</h1>
      <p className="text-gray-600 mb-4">The page you are looking for does not exist.</p>
      <Link to="/" className={BTN.primary}>Back to Dashboard</Link>
    </div>
  );
}
