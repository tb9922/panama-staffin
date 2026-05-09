import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext.jsx';
import { mockDataContext } from '../../test/setup.js';
import StaffApp from '../StaffApp.jsx';

function renderStaffApp(route) {
  localStorage.setItem('user', JSON.stringify({
    username: 'staff',
    role: 'staff_member',
    displayName: 'Staff User',
  }));

  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <StaffApp />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('StaffApp', () => {
  beforeEach(() => {
    mockDataContext({
      loading: false,
      staffId: 'S001',
      activeHomeObj: { id: 'test-home', name: 'Test Home', staffId: 'S001', roleId: 'staff_member' },
      homeRole: 'staff_member',
    });
  });

  it('shows a staff portal not-found state for unknown routes', async () => {
    renderStaffApp('/not-a-real-staff-page');

    expect(await screen.findByText('Staff page not found')).toBeInTheDocument();
    expect(screen.getByText('Choose a staff portal section from the navigation.')).toBeInTheDocument();
  });
});
