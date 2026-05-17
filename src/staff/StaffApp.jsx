import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import StaffLayout from './StaffLayout.jsx';
import LoadingState from '../components/LoadingState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import RouteErrorBoundary from '../components/RouteErrorBoundary.jsx';

const MyDashboard = lazy(() => import('./pages/MyDashboard.jsx'));
const MySchedule = lazy(() => import('./pages/MySchedule.jsx'));
const MyAnnualLeave = lazy(() => import('./pages/MyAnnualLeave.jsx'));
const MyPayslips = lazy(() => import('./pages/MyPayslips.jsx'));
const MyTraining = lazy(() => import('./pages/MyTraining.jsx'));
const ReportSick = lazy(() => import('./pages/ReportSick.jsx'));
const MyProfile = lazy(() => import('./pages/MyProfile.jsx'));

export default function StaffApp() {
  const location = useLocation();

  useEffect(() => {
    const segment = location.pathname.split('/').filter(Boolean).at(-1);
    const title = !segment
      ? 'Staff Portal'
      : segment.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    document.title = `${title} | Panama Staffing`;
  }, [location.pathname]);

  return (
    <Suspense fallback={<LoadingState message="Loading your portal..." className="py-10" card />}>
      <Routes>
        <Route path="/" element={<StaffLayout />}>
          <Route index element={<RouteErrorBoundary><MyDashboard /></RouteErrorBoundary>} />
          <Route path="schedule" element={<RouteErrorBoundary><MySchedule /></RouteErrorBoundary>} />
          <Route path="leave" element={<RouteErrorBoundary><MyAnnualLeave /></RouteErrorBoundary>} />
          <Route path="payslips" element={<RouteErrorBoundary><MyPayslips /></RouteErrorBoundary>} />
          <Route path="training" element={<RouteErrorBoundary><MyTraining /></RouteErrorBoundary>} />
          <Route path="report-sick" element={<RouteErrorBoundary><ReportSick /></RouteErrorBoundary>} />
          <Route path="profile" element={<RouteErrorBoundary><MyProfile /></RouteErrorBoundary>} />
          <Route path="*" element={<RouteErrorBoundary><ErrorState title="Staff page not found" message="Choose a staff portal section from the navigation." className="p-6" /></RouteErrorBoundary>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
