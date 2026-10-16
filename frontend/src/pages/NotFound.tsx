import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui/EmptyState';

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="That address does not exist."
      action={
        <Link to="/" className="text-sm text-accent underline-offset-4 hover:underline">
          Back to the console
        </Link>
      }
    />
  );
}
