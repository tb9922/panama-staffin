import { BrowserRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext.jsx';
import { DataProvider } from './contexts/DataContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import LoginScreen from './components/LoginScreen.jsx';

function AppInner() {
  const { user, login } = useAuth();
  if (!user) return <LoginScreen onLogin={login} />;
  return (
    <DataProvider>
      <AppLayout />
    </DataProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  );
}
