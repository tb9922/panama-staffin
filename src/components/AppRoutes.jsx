import { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import RouteErrorBoundary from './RouteErrorBoundary.jsx';
import { RequireEvidenceHub, RequireModule, RequirePlatformAdmin, RequireUserManagement } from './RequireRole.jsx';

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
const EvidenceHub = lazy(() => import('../pages/EvidenceHub.jsx'));
const Config = lazy(() => import('../pages/Config.jsx'));
const HandoverNotes = lazy(() => import('../pages/HandoverNotes.jsx'));
const PayRatesConfig = lazy(() => import('../pages/PayRatesConfig.jsx'));
const TimesheetManager = lazy(() => import('../pages/TimesheetManager.jsx'));
const MonthlyTimesheet = lazy(() => import('../pages/MonthlyTimesheet.jsx'));
const PayrollDashboard = lazy(() => import('../pages/PayrollDashboard.jsx'));
const ClockInAudit = lazy(() => import('../pages/ClockInAudit.jsx'));
const PayrollDetail = lazy(() => import('../pages/PayrollDetail.jsx'));
const AgencyTracker = lazy(() => import('../pages/AgencyTracker.jsx'));
const TaxCodeManager = lazy(() => import('../pages/TaxCodeManager.jsx'));
const PensionManager = lazy(() => import('../pages/PensionManager.jsx'));
const SickPayTracker = lazy(() => import('../pages/SickPayTracker.jsx'));
const HMRCDashboard = lazy(() => import('../pages/HMRCDashboard.jsx'));
const GdprDashboard = lazy(() => import('../pages/GdprDashboard.jsx'));
const RopaManager = lazy(() => import('../pages/RopaManager.jsx'));
const DpiaManager = lazy(() => import('../pages/DpiaManager.jsx'));
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
const NotFound = lazy(() => import('../pages/NotFound.jsx'));

export default function AppRoutes() {
  return (
    <Routes>
      {/* Scheduling */}
      <Route path="/" element={<RouteErrorBoundary><RequireModule module="scheduling" allowOwn><Dashboard /></RequireModule></RouteErrorBoundary>} />
      <Route path="/day" element={<RouteErrorBoundary><RequireModule module="scheduling"><DailyStatus /></RequireModule></RouteErrorBoundary>} />
      <Route path="/day/:date" element={<RouteErrorBoundary><RequireModule module="scheduling"><DailyStatus /></RequireModule></RouteErrorBoundary>} />
      <Route path="/handover" element={<RouteErrorBoundary><RequireModule module="scheduling"><HandoverNotes /></RequireModule></RouteErrorBoundary>} />
      <Route path="/rotation" element={<RouteErrorBoundary><RequireModule module="scheduling" allowOwn><RotationGrid /></RequireModule></RouteErrorBoundary>} />
      <Route path="/scenarios" element={<RouteErrorBoundary><RequireModule module="scheduling"><ScenarioModel /></RequireModule></RouteErrorBoundary>} />
      <Route path="/leave" element={<RouteErrorBoundary><RequireModule module="scheduling" allowOwn><AnnualLeave /></RequireModule></RouteErrorBoundary>} />

      {/* Staff */}
      <Route path="/staff" element={<RouteErrorBoundary><RequireModule module="staff"><StaffRegister /></RequireModule></RouteErrorBoundary>} />
      <Route path="/onboarding" element={<RouteErrorBoundary><RequireModule module="compliance"><OnboardingTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/training" element={<RouteErrorBoundary><RequireModule module="compliance"><TrainingMatrix /></RequireModule></RouteErrorBoundary>} />
      <Route path="/sick-trends" element={<RouteErrorBoundary><RequireModule module="staff"><SickTrends /></RequireModule></RouteErrorBoundary>} />
      <Route path="/fatigue" element={<RouteErrorBoundary><RequireModule module="staff"><FatigueTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/care-cert" element={<RouteErrorBoundary><RequireModule module="compliance"><CareCertificateTracker /></RequireModule></RouteErrorBoundary>} />

      {/* Compliance */}
      <Route path="/cqc" element={<RouteErrorBoundary><RequireModule module="compliance"><CQCEvidence /></RequireModule></RouteErrorBoundary>} />
      <Route path="/incidents" element={<RouteErrorBoundary><RequireModule module="compliance"><IncidentTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/complaints" element={<RouteErrorBoundary><RequireModule module="compliance"><ComplaintsTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/dols" element={<RouteErrorBoundary><RequireModule module="compliance"><DolsTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/ipc" element={<RouteErrorBoundary><RequireModule module="compliance"><IpcAuditTracker /></RequireModule></RouteErrorBoundary>} />

      {/* Governance */}
      <Route path="/risks" element={<RouteErrorBoundary><RequireModule module="governance"><RiskRegister /></RequireModule></RouteErrorBoundary>} />
      <Route path="/policies" element={<RouteErrorBoundary><RequireModule module="governance"><PolicyReviewTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/speak-up" element={<RouteErrorBoundary><RequireModule module="governance"><WhistleblowingTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/maintenance" element={<RouteErrorBoundary><RequireModule module="compliance"><MaintenanceTracker /></RequireModule></RouteErrorBoundary>} />

      {/* HR */}
      <Route path="/hr"                element={<RouteErrorBoundary><RequireModule module="hr"><HrDashboard /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/disciplinary"   element={<RouteErrorBoundary><RequireModule module="hr"><DisciplinaryTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/grievance"      element={<RouteErrorBoundary><RequireModule module="hr"><GrievanceTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/performance"    element={<RouteErrorBoundary><RequireModule module="hr"><PerformanceTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/absence"        element={<RouteErrorBoundary><RequireModule module="hr"><AbsenceManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/contracts"      element={<RouteErrorBoundary><RequireModule module="hr"><ContractManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/family-leave"   element={<RouteErrorBoundary><RequireModule module="hr"><FamilyLeaveTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/flex-working"   element={<RouteErrorBoundary><RequireModule module="hr"><FlexWorkingTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/edi"            element={<RouteErrorBoundary><RequireModule module="hr"><EdiTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/tupe"           element={<RouteErrorBoundary><RequireModule module="hr"><TupeManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/hr/renewals"       element={<RouteErrorBoundary><RequireModule module="hr"><RtwDbsRenewals /></RequireModule></RouteErrorBoundary>} />

      {/* Finance */}
      <Route path="/residents" element={<RouteErrorBoundary><RequireModule module="finance"><Residents /></RequireModule></RouteErrorBoundary>} />
      <Route path="/beds" element={<RouteErrorBoundary><RequireModule module="finance"><BedManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/finance"             element={<RouteErrorBoundary><RequireModule module="finance"><FinanceDashboard /></RequireModule></RouteErrorBoundary>} />
      <Route path="/finance/income"      element={<RouteErrorBoundary><RequireModule module="finance"><IncomeTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/finance/expenses"    element={<RouteErrorBoundary><RequireModule module="finance"><ExpenseTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/finance/receivables" element={<RouteErrorBoundary><RequireModule module="finance"><ReceivablesManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/finance/payables"    element={<RouteErrorBoundary><RequireModule module="finance"><PayablesManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/costs" element={<RouteErrorBoundary><RequireModule module="finance"><CostTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/budget" element={<RouteErrorBoundary><RequireModule module="finance"><BudgetTracker /></RequireModule></RouteErrorBoundary>} />

      {/* Payroll */}
      <Route path="/payroll/rates"      element={<RouteErrorBoundary><RequireModule module="payroll"><PayRatesConfig /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/clock-ins"  element={<RouteErrorBoundary><RequireModule module="payroll"><ClockInAudit /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/timesheets" element={<RouteErrorBoundary><RequireModule module="payroll"><TimesheetManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/monthly-timesheet/:staffId?" element={<RouteErrorBoundary><RequireModule module="payroll"><MonthlyTimesheet /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/agency"     element={<RouteErrorBoundary><RequireModule module="payroll"><AgencyTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/tax-codes"  element={<RouteErrorBoundary><RequireModule module="payroll"><TaxCodeManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/pensions"   element={<RouteErrorBoundary><RequireModule module="payroll"><PensionManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/sick-pay"   element={<RouteErrorBoundary><RequireModule module="payroll"><SickPayTracker /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/hmrc"       element={<RouteErrorBoundary><RequireModule module="payroll"><HMRCDashboard /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll/:runId"     element={<RouteErrorBoundary><RequireModule module="payroll"><PayrollDetail /></RequireModule></RouteErrorBoundary>} />
      <Route path="/payroll"            element={<RouteErrorBoundary><RequireModule module="payroll" allowOwn><PayrollDashboard /></RequireModule></RouteErrorBoundary>} />

      {/* GDPR */}
      <Route path="/gdpr" element={<RouteErrorBoundary><RequireModule module="gdpr"><GdprDashboard /></RequireModule></RouteErrorBoundary>} />
      <Route path="/ropa" element={<RouteErrorBoundary><RequireModule module="gdpr"><RopaManager /></RequireModule></RouteErrorBoundary>} />
      <Route path="/dpia" element={<RouteErrorBoundary><RequireModule module="gdpr"><DpiaManager /></RequireModule></RouteErrorBoundary>} />

      {/* Reports & System */}
      <Route path="/reports" element={<RouteErrorBoundary><RequireModule module="reports"><Reports /></RequireModule></RouteErrorBoundary>} />
      <Route path="/evidence" element={<RouteErrorBoundary><RequireEvidenceHub><EvidenceHub /></RequireEvidenceHub></RouteErrorBoundary>} />
      <Route path="/audit" element={<RouteErrorBoundary><RequirePlatformAdmin><AuditLog /></RequirePlatformAdmin></RouteErrorBoundary>} />
      <Route path="/users" element={<RouteErrorBoundary><RequireModule module="config"><RequireUserManagement><UserManagement /></RequireUserManagement></RequireModule></RouteErrorBoundary>} />
      <Route path="/settings" element={<RouteErrorBoundary><RequireModule module="config"><Config /></RequireModule></RouteErrorBoundary>} />

      {/* Platform admin only */}
      <Route path="/platform/homes" element={<RouteErrorBoundary><RequirePlatformAdmin><PlatformHomes /></RequirePlatformAdmin></RouteErrorBoundary>} />

      {/* 404 catch-all */}
      <Route path="*" element={<RouteErrorBoundary><NotFound /></RouteErrorBoundary>} />
    </Routes>
  );
}
