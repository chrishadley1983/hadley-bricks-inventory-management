import { redirect } from 'next/navigation';

export default function SeededArbitrageRedirect() {
  redirect('/arbitrage?tab=seeded');
}
