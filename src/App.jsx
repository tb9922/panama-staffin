import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { DataProvider } from './contexts/DataContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import { NotificationProvider } from './contexts/NotificationContext.jsx';
import { ConfirmProvider } from './contexts/ConfirmContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import StaffInviteSetup from './staff/StaffInviteSetup.jsx';
import StaffApp from './staff/StaffApp.jsx';

function AppInner() {
  const { user, login } = useAuth();
  if (!user) {
    return (
      <Routes>
        <Route path="/staff/setup" element={<StaffInviteSetup onLogin={login} />} />
        <Route path="*" element={<LoginScreen onLogin={login} />} />
      </Routes>
    );
  }
  return (
    <DataProvider>
      <ToastProvider>
        <ConfirmProvider>
          {user.role === 'staff_member' ? (
            <Routes>
              <Route path="/staff/setup" element={<Navigate to="/" replace />} />
              <Route path="*" element={<StaffApp />} />
            </Routes>
          ) : (
            <NotificationProvider>
              <AppLayout />
            </NotificationProvider>
          )}
        </ConfirmProvider>
      </ToastProvider>
    </DataProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
