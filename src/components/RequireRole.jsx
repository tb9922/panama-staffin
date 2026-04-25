import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useData } from '../contexts/DataContext.jsx';
import { isOwnDataOnly, ROLES } from '../../shared/roles.js';
import { canAccessEvidenceHub } from '../../shared/evidenceHub.js';

export function RequireModule({ module, allowOwn = false, children }) {
  const { isPlatformAdmin } = useAuth();
  const { canRead, homeRole } = useData();
  if (!canRead(module)) return <Navigate to="/" replace />;
  if (!isPlatformAdmin && !allowOwn && isOwnDataOnly(homeRole, module)) return <Navigate to="/" replace />;
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

export function RequireUserManagement({ children }) {
  const { isPlatformAdmin } = useAuth();
  const { homeRole } = useData();
  if (!isPlatformAdmin && !ROLES[homeRole]?.canManageUsers) return <Navigate to="/" replace />;
  return children;
}

export function RequireEvidenceHub({ children }) {
  const { isPlatformAdmin } = useAuth();
  const { homeRole, canRead } = useData();
  if (!canRead('reports')) return <Navigate to="/" replace />;
  if (!isPlatformAdmin && !canAccessEvidenceHub(homeRole)) return <Navigate to="/" replace />;
  return children;
}
