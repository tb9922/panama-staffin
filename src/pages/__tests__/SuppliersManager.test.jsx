import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders.jsx';
import SuppliersManager from '../SuppliersManager.jsx';

vi.mock('../../lib/api.js', async () => {
  const actual = await vi.importActual('../../lib/api.js');
  return {
    ...actual,
    getCurrentHome: vi.fn(() => 'test-home'),
    getLoggedInUser: vi.fn(() => ({ username: 'admin', role: 'admin' })),
    getSuppliers: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    mergeSuppliers: vi.fn(),
    loadHomes: vi.fn().mockResolvedValue([{ id: 'test-home', name: 'Test Home' }]),
    setCurrentHome: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '../../lib/api.js';

const SUPPLIERS = [
  { id: 1, name: 'ABC Cleaning', vat_number: 'GB111', default_category: 'cleaning', aliases: ['ABC'], active: true, version: 2 },
  { id: 2, name: 'XYZ Utilities', vat_number: null, default_category: 'utilities', aliases: [], active: true, version: 1 },
];

function renderPage(options = {}) {
  api.getSuppliers.mockResolvedValue(SUPPLIERS);
  return renderWithProviders(<SuppliersManager />, {
    user: { username: 'admin', role: 'admin' },
    ...options,
  });
}

describe('SuppliersManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCurrentHome.mockReturnValue('test-home');
    api.getLoggedInUser.mockReturnValue({ username: 'admin', role: 'admin' });
    api.createSupplier.mockResolvedValue({ id: 3, name: 'Fresh Foods' });
    api.updateSupplier.mockResolvedValue({ id: 1, name: 'ABC Cleaning', version: 3 });
    api.mergeSuppliers.mockResolvedValue({ ok: true });
  });

  it('renders suppliers and wires safe controls', async () => {
    renderPage();

    await waitFor(() => expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1));
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Source supplier')).toBeInTheDocument();
    expect(screen.getByLabelText('Target supplier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('hides write controls for read-only users', async () => {
    renderPage({ user: { username: 'viewer', role: 'viewer' }, canWrite: false });

    await waitFor(() => expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByRole('button', { name: 'Add Supplier' })).not.toBeInTheDocument();
    expect(screen.queryByText('Merge duplicates')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('validates and submits create supplier from the modal', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add Supplier' }));
    expect(screen.getByRole('button', { name: 'Create Supplier' })).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), ' Fresh Foods ');
    await user.type(screen.getByLabelText('VAT Number'), ' gb 222 ');
    await user.type(screen.getByLabelText('Default Category'), ' food ');
    await user.type(screen.getByLabelText('Aliases'), 'Fresh Food Co\n');
    await user.click(screen.getByRole('button', { name: 'Create Supplier' }));

    await waitFor(() => expect(api.createSupplier).toHaveBeenCalledWith('test-home', {
      name: 'Fresh Foods',
      vat_number: 'gb 222',
      default_category: 'food',
      aliases: ['Fresh Food Co'],
      active: true,
    }));
  });

  it('blocks merging a supplier into itself before calling the API', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1));
    await user.selectOptions(screen.getByLabelText('Source supplier'), '1');
    await user.selectOptions(screen.getByLabelText('Target supplier'), '1');

    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
    expect(api.mergeSuppliers).not.toHaveBeenCalled();
  });

  it('submits a valid merge once', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => expect(screen.getAllByText('ABC Cleaning').length).toBeGreaterThanOrEqual(1));
    await user.selectOptions(screen.getByLabelText('Source supplier'), '1');
    await user.selectOptions(screen.getByLabelText('Target supplier'), '2');
    await user.click(screen.getByRole('button', { name: 'Merge' }));

    await waitFor(() => expect(api.mergeSuppliers).toHaveBeenCalledWith('test-home', 1, 2));
    expect(api.mergeSuppliers).toHaveBeenCalledTimes(1);
  });
});
