import { render, screen } from '@testing-library/react';
import App from './App';

test('renders basic control buttons', () => {
  render(<App />);
  expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /next play/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
});
