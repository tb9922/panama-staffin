import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

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
