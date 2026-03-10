import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import RouteErrorBoundary from './RouteErrorBoundary.jsx';
import { RequireAdmin, RequirePlatformAdmin } from './RequireRole.jsx';

const Dashboard = lazy(() => import('../pages/Dashboard.jsx'));
const DailyStatus = lazy(() => import('../pages/DailyStatus.jsx'));
const RotationGrid = lazy(() => import('../pages/RotationGrid.jsx'));
const StaffRegister = lazy(() => import('../pages/StaffRegister.jsx'));
const CostTracker = lazy(() => import('../pages/CostTracker.jsx'));
const AnnualLeave = lazy(() => import('../pages/AnnualLeave.jsx'));
const ScenarioModel = lazy(() => import('../pages/ScenarioModel.jsx'));
const FatigueTracker = lazy(() => import('../pages/FatigueTracker.jsx'));
const SickTrends = lazy(() => import('../pages/SickTrends.jsx'));
const BudgetTracker = lazy(() => import('../pages/BudgetTracker.jsx'));
const TrainingMatrix = lazy(() => import('../pages/TrainingMatrix.jsx'));
const OnboardingTracker = lazy(() => import('../pages/OnboardingTracker.jsx'));
const CQCEvidence = lazy(() => import('../pages/CQCEvidence.jsx'));
const IncidentTracker = lazy(() => import('../pages/IncidentTracker.jsx'));
const ComplaintsTracker = lazy(() => import('../pages/ComplaintsTracker.jsx'));
const MaintenanceTracker = lazy(() => import('../pages/MaintenanceTracker.jsx'));
const IpcAuditTracker = lazy(() => import('../pages/IpcAuditTracker.jsx'));
const RiskRegister = lazy(() => import('../pages/RiskRegister.jsx'));
const PolicyReviewTracker = lazy(() => import('../pages/PolicyReviewTracker.jsx'));
const WhistleblowingTracker = lazy(() => import('../pages/WhistleblowingTracker.jsx'));
const DolsTracker = lazy(() => import('../pages/DolsTracker.jsx'));
const CareCertificateTracker = lazy(() => import('../pages/CareCertificateTracker.jsx'));
const Reports = lazy(() => import('../pages/Reports.jsx'));
const Config = lazy(() => import('../pages/Config.jsx'));
const HandoverNotes = lazy(() => import('../pages/HandoverNotes.jsx'));
const PayRatesConfig = lazy(() => import('../pages/PayRatesConfig.jsx'));
const TimesheetManager = lazy(() => import('../pages/TimesheetManager.jsx'));
const MonthlyTimesheet = lazy(() => import('../pages/MonthlyTimesheet.jsx'));
const PayrollDashboard = lazy(() => import('../pages/PayrollDashboard.jsx'));
const PayrollDetail = lazy(() => import('../pages/PayrollDetail.jsx'));
const AgencyTracker = lazy(() => import('../pages/AgencyTracker.jsx'));
const TaxCodeManager = lazy(() => import('../pages/TaxCodeManager.jsx'));
const PensionManager = lazy(() => import('../pages/PensionManager.jsx'));
const SickPayTracker = lazy(() => import('../pages/SickPayTracker.jsx'));
const HMRCDashboard = lazy(() => import('../pages/HMRCDashboard.jsx'));
const GdprDashboard = lazy(() => import('../pages/GdprDashboard.jsx'));
const HrDashboard = lazy(() => import('../pages/HrDashboard.jsx'));
const DisciplinaryTracker = lazy(() => import('../pages/DisciplinaryTracker.jsx'));
const GrievanceTracker = lazy(() => import('../pages/GrievanceTracker.jsx'));
const PerformanceTracker = lazy(() => import('../pages/PerformanceTracker.jsx'));
const AbsenceManager = lazy(() => import('../pages/AbsenceManager.jsx'));
const ContractManager = lazy(() => import('../pages/ContractManager.jsx'));
const FamilyLeaveTracker = lazy(() => import('../pages/FamilyLeaveTracker.jsx'));
const FlexWorkingTracker = lazy(() => import('../pages/FlexWorkingTracker.jsx'));
const EdiTracker = lazy(() => import('../pages/EdiTracker.jsx'));
const TupeManager = lazy(() => import('../pages/TupeManager.jsx'));
const RtwDbsRenewals = lazy(() => import('../pages/RtwDbsRenewals.jsx'));
const UserManagement = lazy(() => import('../pages/UserManagement.jsx'));
const FinanceDashboard = lazy(() => import('../pages/FinanceDashboard.jsx'));
const IncomeTracker = lazy(() => import('../pages/IncomeTracker.jsx'));
const ExpenseTracker = lazy(() => import('../pages/ExpenseTracker.jsx'));
const ReceivablesManager = lazy(() => import('../pages/ReceivablesManager.jsx'));
const PayablesManager = lazy(() => import('../pages/PayablesManager.jsx'));
const AuditLog = lazy(() => import('../pages/AuditLog.jsx'));
const BedManager = lazy(() => import('../pages/BedManager.jsx'));
const Residents = lazy(() => import('../pages/Residents.jsx'));
const PlatformHomes = lazy(() => import('../pages/PlatformHomes.jsx'));

export default function AppRoutes() {
  return (
    <Routes>
      {/* Open routes — viewers have legitimate read access */}
      <Route path="/" element={<RouteErrorBoundary><Dashboard /></RouteErrorBoundary>} />
      <Route path="/residents" element={<RouteErrorBoundary><Residents /></RouteErrorBoundary>} />
      <Route path="/beds" element={<RouteErrorBoundary><BedManager /></RouteErrorBoundary>} />
      <Route path="/day" element={<RouteErrorBoundary><DailyStatus /></RouteErrorBoundary>} />
      <Route path="/day/:date" element={<RouteErrorBoundary><DailyStatus /></RouteErrorBoundary>} />
      <Route path="/handover" element={<RouteErrorBoundary><HandoverNotes /></RouteErrorBoundary>} />
      <Route path="/rotation" element={<RouteErrorBoundary><RotationGrid /></RouteErrorBoundary>} />
      <Route path="/staff" element={<RouteErrorBoundary><StaffRegister /></RouteErrorBoundary>} />
      <Route path="/costs" element={<RouteErrorBoundary><CostTracker /></RouteErrorBoundary>} />
      <Route path="/leave" element={<RouteErrorBoundary><AnnualLeave /></RouteErrorBoundary>} />
      <Route path="/scenarios" element={<RouteErrorBoundary><ScenarioModel /></RouteErrorBoundary>} />
      <Route path="/fatigue" element={<RouteErrorBoundary><FatigueTracker /></RouteErrorBoundary>} />
      <Route path="/sick-trends" element={<RouteErrorBoundary><SickTrends /></RouteErrorBoundary>} />
      <Route path="/training" element={<RouteErrorBoundary><TrainingMatrix /></RouteErrorBoundary>} />
      <Route path="/onboarding" element={<RouteErrorBoundary><OnboardingTracker /></RouteErrorBoundary>} />
      <Route path="/cqc" element={<RouteErrorBoundary><CQCEvidence /></RouteErrorBoundary>} />
      <Route path="/incidents" element={<RouteErrorBoundary><IncidentTracker /></RouteErrorBoundary>} />
      <Route path="/complaints" element={<RouteErrorBoundary><ComplaintsTracker /></RouteErrorBoundary>} />
      <Route path="/maintenance" element={<RouteErrorBoundary><MaintenanceTracker /></RouteErrorBoundary>} />
      <Route path="/ipc" element={<RouteErrorBoundary><IpcAuditTracker /></RouteErrorBoundary>} />
      <Route path="/risks" element={<RouteErrorBoundary><RiskRegister /></RouteErrorBoundary>} />
      <Route path="/policies" element={<RouteErrorBoundary><PolicyReviewTracker /></RouteErrorBoundary>} />
      <Route path="/speak-up" element={<RouteErrorBoundary><WhistleblowingTracker /></RouteErrorBoundary>} />
      <Route path="/dols" element={<RouteErrorBoundary><DolsTracker /></RouteErrorBoundary>} />
      <Route path="/care-cert" element={<RouteErrorBoundary><CareCertificateTracker /></RouteErrorBoundary>} />
      <Route path="/reports" element={<RouteErrorBoundary><Reports /></RouteErrorBoundary>} />

      {/* Admin-only: HR */}
      <Route path="/hr"                element={<RouteErrorBoundary><RequireAdmin><HrDashboard /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/disciplinary"   element={<RouteErrorBoundary><RequireAdmin><DisciplinaryTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/grievance"      element={<RouteErrorBoundary><RequireAdmin><GrievanceTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/performance"    element={<RouteErrorBoundary><RequireAdmin><PerformanceTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/absence"        element={<RouteErrorBoundary><RequireAdmin><AbsenceManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/contracts"      element={<RouteErrorBoundary><RequireAdmin><ContractManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/family-leave"   element={<RouteErrorBoundary><RequireAdmin><FamilyLeaveTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/flex-working"   element={<RouteErrorBoundary><RequireAdmin><FlexWorkingTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/edi"            element={<RouteErrorBoundary><RequireAdmin><EdiTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/tupe"           element={<RouteErrorBoundary><RequireAdmin><TupeManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/hr/renewals"       element={<RouteErrorBoundary><RequireAdmin><RtwDbsRenewals /></RequireAdmin></RouteErrorBoundary>} />

      {/* Admin-only: Finance */}
      <Route path="/finance"             element={<RouteErrorBoundary><RequireAdmin><FinanceDashboard /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/finance/income"      element={<RouteErrorBoundary><RequireAdmin><IncomeTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/finance/expenses"    element={<RouteErrorBoundary><RequireAdmin><ExpenseTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/finance/receivables" element={<RouteErrorBoundary><RequireAdmin><ReceivablesManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/finance/payables"    element={<RouteErrorBoundary><RequireAdmin><PayablesManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/budget" element={<RouteErrorBoundary><RequireAdmin><BudgetTracker /></RequireAdmin></RouteErrorBoundary>} />

      {/* Admin-only: Payroll */}
      <Route path="/payroll/rates"      element={<RouteErrorBoundary><RequireAdmin><PayRatesConfig /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/timesheets" element={<RouteErrorBoundary><RequireAdmin><TimesheetManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/monthly-timesheet/:staffId?" element={<RouteErrorBoundary><RequireAdmin><MonthlyTimesheet /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/agency"     element={<RouteErrorBoundary><RequireAdmin><AgencyTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/tax-codes"  element={<RouteErrorBoundary><RequireAdmin><TaxCodeManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/pensions"   element={<RouteErrorBoundary><RequireAdmin><PensionManager /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/sick-pay"   element={<RouteErrorBoundary><RequireAdmin><SickPayTracker /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/hmrc"       element={<RouteErrorBoundary><RequireAdmin><HMRCDashboard /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll/:runId"     element={<RouteErrorBoundary><RequireAdmin><PayrollDetail /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/payroll"            element={<RouteErrorBoundary><RequireAdmin><PayrollDashboard /></RequireAdmin></RouteErrorBoundary>} />

      {/* Admin-only: GDPR, Audit, Users, Config */}
      <Route path="/gdpr"     element={<RouteErrorBoundary><RequireAdmin><GdprDashboard /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/audit"    element={<RouteErrorBoundary><RequireAdmin><AuditLog /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/users"    element={<RouteErrorBoundary><RequireAdmin><UserManagement /></RequireAdmin></RouteErrorBoundary>} />
      <Route path="/settings" element={<RouteErrorBoundary><RequireAdmin><Config /></RequireAdmin></RouteErrorBoundary>} />

      {/* Platform admin only */}
      <Route path="/platform/homes" element={<RouteErrorBoundary><RequirePlatformAdmin><PlatformHomes /></RequirePlatformAdmin></RouteErrorBoundary>} />
    </Routes>
  );
}
