import { redirect } from 'next/navigation';

export default function MinifigItemsPage() {
  redirect('/minifigs?tab=items');
}
