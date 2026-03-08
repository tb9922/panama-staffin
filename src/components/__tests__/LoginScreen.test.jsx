import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginScreen from '../LoginScreen.jsx';
import { login } from '../../lib/api.js';

vi.mock('../../lib/api.js', () => ({
  login: vi.fn(),
}));

vi.mock('../../lib/design.js', () => ({
  INPUT: { label: 'label', base: 'base' },
  BTN: { primary: 'primary' },
}));

describe('LoginScreen', () => {
  it('renders username and password fields', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByPlaceholderText('Enter username')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter password')).toBeInTheDocument();
  });

  it('renders the Panama Staffing heading', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Panama Staffing' })).toBeInTheDocument();
  });

  it('renders the Sign In submit button', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('password field has type="password"', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    const passwordInput = screen.getByPlaceholderText('Enter password');
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('calls login API with the entered username and password on submit', async () => {
    login.mockResolvedValueOnce({ username: 'admin', role: 'admin' });
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Enter username'), 'admin');
    await user.type(screen.getByPlaceholderText('Enter password'), 'admin123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(login).toHaveBeenCalledWith('admin', 'admin123');
  });

  it('calls onLogin with user data on successful login', async () => {
    const userData = { username: 'admin', role: 'admin' };
    login.mockResolvedValueOnce(userData);
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    await user.type(screen.getByPlaceholderText('Enter username'), 'admin');
    await user.type(screen.getByPlaceholderText('Enter password'), 'admin123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith(userData);
    });
  });

  it('shows an error message when login fails', async () => {
    login.mockRejectedValueOnce(new Error('Unauthorized'));
    const user = userEvent.setup();
    render(<LoginScreen onLogin={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('Enter username'), 'admin');
    await user.type(screen.getByPlaceholderText('Enter password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
    });
  });

  it('calls onLogin on a subsequent successful login even when a previous error is shown', async () => {
    // First attempt fails, second succeeds.
    // The component does not clear the error state on success — onLogin fires regardless.
    login.mockRejectedValueOnce(new Error('Unauthorized'));
    login.mockResolvedValueOnce({ username: 'admin', role: 'admin' });

    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen onLogin={onLogin} />);

    // Fail first
    await user.type(screen.getByPlaceholderText('Enter username'), 'admin');
    await user.type(screen.getByPlaceholderText('Enter password'), 'bad');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
    });

    // Retry with correct credentials
    const passwordInput = screen.getByPlaceholderText('Enter password');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'admin123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => {
      expect(onLogin).toHaveBeenCalledWith({ username: 'admin', role: 'admin' });
    });
  });

  it('does not show an error message on initial render', () => {
    render(<LoginScreen onLogin={vi.fn()} />);
    expect(screen.queryByText('Invalid username or password')).not.toBeInTheDocument();
  });
});
