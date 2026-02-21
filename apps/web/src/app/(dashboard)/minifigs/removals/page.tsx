import { redirect } from 'next/navigation';

export default function MinifigRemovalsPage() {
  redirect('/minifigs?tab=removals');
}
