import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('component test infrastructure', () => {
  it('can render a DOM node and query it', () => {
    render(<div>hello</div>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
