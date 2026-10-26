'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export default function SubmitButton({
  className,
  children,
  pendingLabel,
}: {
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button className={className} type="submit" disabled={pending}>
      {pending && <span className="spinner spinner--light" aria-hidden="true" />}
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
