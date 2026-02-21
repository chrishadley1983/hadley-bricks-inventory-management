import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Widget, StatWidget, ListWidget } from '../widget';

describe('Widget', () => {
  it('renders title and children', () => {
    render(
      <Widget title="Test Widget">
        <p>Widget content</p>
      </Widget>
    );

    expect(screen.getByText('Test Widget')).toBeInTheDocument();
    expect(screen.getByText('Widget content')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <Widget title="Test Widget" description="A helpful description">
        <p>Content</p>
      </Widget>
    );

    expect(screen.getByText('A helpful description')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(
      <Widget title="Loading Widget" isLoading>
        <p>Content</p>
      </Widget>
    );

    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    // Loader spinner should be present
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    const error = new Error('Something went wrong');
    render(
      <Widget title="Error Widget" error={error}>
        <p>Content</p>
      </Widget>
    );

    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });
});

describe('StatWidget', () => {
  it('renders value and subtitle', () => {
    render(<StatWidget title="Total Items" value={42} subtitle="items in stock" />);

    expect(screen.getByText('Total Items')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('items in stock')).toBeInTheDocument();
  });

  it('shows positive trend', () => {
    render(<StatWidget title="Sales" value="£100" trend={{ value: 15, isPositive: true }} />);

    expect(screen.getByText('+15% from last month')).toBeInTheDocument();
  });

  it('shows negative trend', () => {
    render(<StatWidget title="Sales" value="£100" trend={{ value: -10, isPositive: false }} />);

    expect(screen.getByText('-10% from last month')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<StatWidget title="Loading" value="0" isLoading />);

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

describe('ListWidget', () => {
  it('renders items', () => {
    const items = [<p key="1">Item 1</p>, <p key="2">Item 2</p>];

    render(<ListWidget title="Recent Items" items={items} />);

    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('shows empty message when no items', () => {
    render(<ListWidget title="Empty List" items={[]} emptyMessage="No data available" />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('uses default empty message', () => {
    render(<ListWidget title="Empty List" items={[]} />);

    expect(screen.getByText('No items')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    const items = [<p key="1">Item 1</p>];

    render(<ListWidget title="Loading List" items={items} isLoading />);

    expect(screen.queryByText('Item 1')).not.toBeInTheDocument();
  });
});
