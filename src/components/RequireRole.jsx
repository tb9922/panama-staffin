import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';

export function RequireModule({ module, children }) {
  const { canRead } = useData();
  if (!canRead(module)) return <Navigate to="/" replace />;
  return children;
}

export function RequireAdmin({ children }) {
  const { isViewer } = useAuth();
  if (isViewer) return <Navigate to="/" replace />;
  return children;
}

export function RequirePlatformAdmin({ children }) {
  const { isPlatformAdmin } = useAuth();
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return children;
}
