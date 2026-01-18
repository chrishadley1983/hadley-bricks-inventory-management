/**
 * Cost Modelling Page Route
 * F1: Route /cost-modelling renders a page without errors
 * I4: Page title and meta description
 */

import { Metadata } from 'next';
import { CostModellingPage } from '@/components/features/cost-modelling';

export const metadata: Metadata = {
  title: 'Cost Modelling | Hadley Bricks',
  description: 'Create and compare financial scenarios for your LEGO resale business',
};

export default function CostModellingRoute() {
  return <CostModellingPage />;
}
