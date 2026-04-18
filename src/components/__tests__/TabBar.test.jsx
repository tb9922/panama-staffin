import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabBar from '../TabBar.jsx';

const TABS = [
  { id: 'one', label: 'Tab One' },
  { id: 'two', label: 'Tab Two' },
  { id: 'three', label: 'Tab Three' },
];

function renderTabBar(activeTab = 'one', onChange = vi.fn()) {
  const result = render(
    <TabBar tabs={TABS} activeTab={activeTab} onTabChange={onChange} />
  );
  return { onChange, ...result };
}

describe('TabBar', () => {
  it('renders all tabs', () => {
    renderTabBar();
    expect(screen.getByText('Tab One')).toBeInTheDocument();
    expect(screen.getByText('Tab Two')).toBeInTheDocument();
    expect(screen.getByText('Tab Three')).toBeInTheDocument();
  });

  it('renders tablist role on container', () => {
    renderTabBar();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('renders tab role on each button', () => {
    renderTabBar();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('marks active tab with aria-selected=true', () => {
    renderTabBar('two');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('sets tabIndex=0 on active tab, -1 on others', () => {
    renderTabBar('two');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    expect(tabs[2]).toHaveAttribute('tabindex', '-1');
  });

  it('assigns an id to each tab button', () => {
    renderTabBar();
    const tabs = screen.getAllByRole('tab');
    tabs.forEach(tab => {
      expect(tab.getAttribute('id')).toBeTruthy();
    });
  });

  it('calls onTabChange on click', () => {
    const { onChange } = renderTabBar('one');
    fireEvent.click(screen.getByText('Tab Two'));
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('ArrowRight moves to next tab', () => {
    const { onChange } = renderTabBar('one');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('two');
  });

  it('ArrowLeft moves to previous tab', () => {
    const { onChange } = renderTabBar('two');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('ArrowRight wraps from last to first', () => {
    const { onChange } = renderTabBar('three');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('ArrowLeft wraps from first to last', () => {
    const { onChange } = renderTabBar('one');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('three');
  });

  it('Home jumps to first tab', () => {
    const { onChange } = renderTabBar('three');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('one');
  });

  it('End jumps to last tab', () => {
    const { onChange } = renderTabBar('one');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('three');
  });

  it('applies className prop', () => {
    render(
      <TabBar tabs={TABS} activeTab="one" onTabChange={vi.fn()} className="custom-class" />
    );
    expect(screen.getByRole('tablist').className).toContain('custom-class');
  });

  it('ignores irrelevant keys', () => {
    const onChange = vi.fn();
    renderTabBar('one', onChange);
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'Enter' });
    fireEvent.keyDown(tablist, { key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
