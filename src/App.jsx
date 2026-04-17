import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { DataProvider } from './contexts/DataContext.jsx';
import { ToastProvider } from './contexts/ToastContext.jsx';
import { NotificationProvider } from './contexts/NotificationContext.jsx';
import { ConfirmProvider } from './contexts/ConfirmContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginScreen from './components/LoginScreen.jsx';

function AppInner() {
  const { user, login } = useAuth();
  if (!user) return <LoginScreen onLogin={login} />;
  return (
    <DataProvider>
      <ToastProvider>
        <ConfirmProvider>
          <NotificationProvider>
            <AppLayout />
          </NotificationProvider>
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
